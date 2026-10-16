package com.dsharnessmobile.shell

import android.content.Context
import android.util.Log
import java.io.File
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import org.json.JSONObject

/**
 * 存储单元自愈（0.13.5 坑 78，2026-10-16 真机实锤）。
 *
 * 故障面：`home/.dsh/storages/<unit>.json` 是引擎 dsh-storage-json 的「whole-unit」单文件
 * 快照，parse() 对它零容忍——非 JSON、非对象、单元头缺失/外来名、tables 不是对象，
 * 以及 `stored version X != expected Y`，一律抛 StorageError。抛错点在 [cordis.init]：
 * 进程照跑、HTTP 照答，但插件不激活——
 *
 *   workspace (@deepseek-ai/dsh-workspace): StorageError: unit 'workspace': ...
 *   session-controller / workspace-controller / ui-deliverables /
 *   android-file-open: pending (waiting for service: workspaceRegistry)
 *
 * 用户侧就是三个症状一个根：工作区面板永远「正在加载工作区…」、发消息没回复、
 * 「临时工作区」条目整个消失。看门狗按 HTTP 判活，永远看不见这个信号，所以既不重启
 * 也不报错（真机复现：把 storages/workspace.json 置 0 字节，或把 unit.version 改回 1，
 * 冷启完整复现用户截图；删掉该文件后冷启，引擎自动重建并恢复服务）。
 *
 * 为什么只有老设备中招：USER_DATA_NAMES 里含 storages（升级刻意保留用户数据），
 * 而 whole-unit 的版本落后即被硬拒。干净安装的机器（现场测试机）写的是当前版本，
 * 覆盖升级的机器带着上一个引擎线写的版本——这正是「同一个 APK，测试机好用、
 * 我自己的机器不能用」的差集。
 *
 * 自愈分级（每一级都留原始文件，绝不静默吃用户数据）：
 *  1) 启动前预检 [preflight]：结构性坏文件改名隔离，引擎随后按空单元重建；
 *  2) 启动后按引擎日志增量 [fromLogDelta]：版本不符 → 只改写 unit.version 为引擎期望值
 *     （保住工作区标题、会话归属等存量数据）；其它致命形态 → 隔离。改动需重启引擎才生效，
 *     返回 true 由调用方（看门狗）重启一次；
 *  3) 同一单元 24h 窗口内最多出手 2 次，杜绝「改写→仍致命→再改写」的循环重启。
 */
object StorageHeal {

  private const val TAG = "dsh-storage-heal"

  /** 同一单元在窗口期内最多自愈次数（第 2 次通常是改写后仍致命 → 隔离兜底）。 */
  private const val MAX_ATTEMPTS = 2
  private const val WINDOW_MS = 24L * 60 * 60 * 1000

  /** 单个单元文件的读取上限：真实单元文件是 KB 级，异常膨胀（写歪的重复体）不碰。 */
  private const val MAX_UNIT_BYTES = 2L * 1024 * 1024

  /** 引擎致命错：`unit '<name>': stored version 1 != expected 2`。 */
  private val VERSION_MISMATCH = Regex("unit '([A-Za-z0-9_-]+)': stored version (\\d+) != expected (\\d+)")

  /** 引擎致命错：结构性坏（预检漏网时兜底，例如某张表内部形态不对）。 */
  private val MALFORMED = Regex(
    "unit '([A-Za-z0-9_-]+)': (?:file is not valid JSON|file is not a JSON object|" +
      "missing or foreign unit header|tables is not an object|table '[A-Za-z0-9_-]+' is not an object)",
  )

  /** whole-unit 头里的版本号（改写只碰这个数字，其余字节原样保留）。 */
  private val UNIT_VERSION_FIELD = Regex("(\"unit\"\\s*:\\s*\\{[^}]*?\"version\"\\s*:\\s*)\\d+")

  /** whole-unit 快照目录。per-record 分片目录（如 session_projcache）由引擎逐条丢弃、本身容错，不在面上。 */
  private fun storagesDir(context: Context): File =
    File(File(context.filesDir, "home/.dsh"), "storages")

  private fun stateFile(context: Context): File = File(context.filesDir, ".storage-heal.json")

  /**
   * 启动前预检（EngineManager.startEngine 里、引擎读盘之前调用）。
   * 只处理「引擎必定拒收」的文件；版本是否符合引擎期望在此无从判定——交给 [fromLogDelta]。
   */
  fun preflight(context: Context) {
    try {
      val dir = storagesDir(context)
      val units = dir.listFiles { f -> f.isFile && f.name.endsWith(".json") } ?: return
      for (f in units) {
        val reason = structuralDefect(f) ?: continue
        quarantine(context, f.nameWithoutExtension, reason)
      }
    } catch (t: Throwable) {
      Log.w(TAG, "storage unit preflight failed (non-fatal)", t)
    }
  }

  /**
   * 看门狗日志增量钩子：认出本轮启动里的致命 StorageError 并就地修复。
   * @return true = 磁盘已改动，必须重启引擎才生效（调用方负责重启一次）。
   */
  fun fromLogDelta(context: Context, delta: String): Boolean {
    // 预筛只认「带引号的单元名」这一必要形态：坑 78 里曾按 `StorageError: unit '` 全前缀过滤，
    // 可引擎的激活诊断把错误摊成 `phase: message` 或多行 stack，前缀不一定原样出现
    // （真机见过 `StorageError: unit 'workspace': ...` 与 `unit 'workspace': ...` 两种）。
    // 正则本身才是判据，前缀闸只会漏判。
    if (!delta.contains("unit '")) return false
    var healed = false
    for (m in VERSION_MISMATCH.findAll(delta)) {
      val unit = m.groupValues[1]
      val expected = m.groupValues[3]
      val f = File(storagesDir(context), "$unit.json")
      val defect = structuralDefect(f)
      if (defect != null) {
        if (quarantine(context, unit, defect)) healed = true
        continue
      }
      if (!allowAttempt(context, unit, "restamp->$expected")) continue
      try {
        val src = f.readText(Charsets.UTF_8)
        val old = Regex("(\"unit\"\\s*:\\s*\\{[^}]*?\"version\"\\s*:\\s*)(\\d+)").find(src)
          ?.groupValues?.get(2)
        if (old == null || old == expected) {
          // 头里没有可定位的版本号 → 改写无从下手，退回隔离。
          if (quarantine(context, unit, "version field not locatable")) healed = true
          continue
        }
        val backup = File(f.parentFile, "${f.name}.v$old.bak")
        runCatching { Files.copy(f.toPath(), backup.toPath(), StandardCopyOption.REPLACE_EXISTING) }
        writeAtomic(f, UNIT_VERSION_FIELD.replace(src) { m2 -> m2.groupValues[1] + expected })
        LogCollector.log(TAG, "storage unit '$unit' version restamped $old -> $expected (backup: ${backup.name}); engine restarting to take it")
        Log.i(TAG, "restamped unit $unit version $old -> $expected")
        healed = true
      } catch (t: Throwable) {
        Log.w(TAG, "restamp failed for $unit", t)
        if (quarantine(context, unit, "restamp threw: " + (t.message ?: t.javaClass.simpleName))) healed = true
      }
    }
    for (m in MALFORMED.findAll(delta)) {
      if (quarantine(context, m.groupValues[1], "engine rejected the document")) healed = true
    }
    return healed
  }

  /** 结构校验，镜像引擎 parse() 的判定；返回 null 表示形态可被引擎接受，否则返回拒收原因。 */
  private fun structuralDefect(f: File): String? {
    if (!f.exists()) return null
    val len = f.length()
    if (len == 0L) return "empty file"
    if (len > MAX_UNIT_BYTES) return "unit file too large ($len bytes)"
    val text = try { f.readText(Charsets.UTF_8) } catch (t: Throwable) {
      // 读不动（IO/权限）不等于坏——绝不能因为读失败就动用户数据。
      Log.w(TAG, "preflight read failed for " + f.name, t)
      return null
    }
    val doc = try { JSONObject(text) } catch (_: Exception) { return "not valid JSON" }
    val unit = doc.optJSONObject("unit") ?: return "missing unit header"
    if (unit.optString("name") != f.nameWithoutExtension) return "foreign unit header"
    if (unit.opt("version") !is Number) return "unit version is not a number"
    if (doc.optJSONObject("tables") == null) return "tables is not an object"
    return null
  }

  /**
   * 隔离一个单元文件（改名而非删除——引擎随后按空单元重建，原件留作取证/回滚）。
   * @return true = 本次真的动了文件。
   */
  private fun quarantine(context: Context, unit: String, reason: String): Boolean {
    val f = File(storagesDir(context), "$unit.json")
    if (!f.exists()) return false
    if (!allowAttempt(context, unit, "quarantine")) return false
    val moved = File(f.parentFile, "${f.name}.corrupt-${System.currentTimeMillis()}")
    return try {
      if (!f.renameTo(moved)) {
        Log.w(TAG, "quarantine rename failed for " + f.absolutePath)
        false
      } else {
        pruneBackups(f.parentFile, f.name)
        LogCollector.log(TAG, "storage unit '$unit' quarantined ($reason) -> ${moved.name}; engine rebuilds it empty")
        Log.i(TAG, "quarantined ${f.name} ($reason)")
        true
      }
    } catch (t: Throwable) {
      Log.w(TAG, "quarantine failed for ${f.name}", t)
      false
    }
  }

  /** 每个单元最多留 3 份隔离件，避免历史积压把 storages 目录越撑越大。 */
  private fun pruneBackups(dir: File, unitFileName: String) {
    try {
      val olds = dir.listFiles { f -> f.isFile && f.name.startsWith("$unitFileName.corrupt-") }
        ?.sortedByDescending { it.lastModified() } ?: return
      for (old in olds.drop(3)) old.delete()
    } catch (_: Throwable) {
    }
  }

  /** 出手次数闸门：同一单元 24h 窗口内最多 MAX_ATTEMPTS 次，防止循环重启。 */
  private fun allowAttempt(context: Context, unit: String, action: String): Boolean {
    val st = stateFile(context)
    return try {
      val doc = try { JSONObject(st.readText(Charsets.UTF_8)) } catch (_: Exception) { JSONObject() }
      val entry = doc.optJSONObject(unit)
      val now = System.currentTimeMillis()
      val count = if (entry != null && now - entry.optLong("t") < WINDOW_MS) entry.optInt("n") else 0
      if (count >= MAX_ATTEMPTS) {
        LogCollector.log(TAG, "storage unit '$unit' already self-healed $count times within 24h ($action skipped; needs manual cleanup)")
        return false
      }
      doc.put(unit, JSONObject().put("n", count + 1).put("t", now).put("last", action))
      writeAtomic(st, doc.toString())
      true
    } catch (_: Throwable) {
      // 闸门写不进去时宁可不出手，也不冒循环重启的险。
      false
    }
  }

  /** 落盘一律 tmp + rename：自愈本身不能制造新的半截文件（坑 78 的病灶正是半截/坏文件）。 */
  private fun writeAtomic(f: File, text: String) {
    val tmp = File(f.parentFile, "${f.name}.tmp-${System.nanoTime()}")
    tmp.writeText(text, Charsets.UTF_8)
    try {
      Files.move(tmp.toPath(), f.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    } catch (_: AtomicMoveNotSupportedException) {
      Files.move(tmp.toPath(), f.toPath(), StandardCopyOption.REPLACE_EXISTING)
    }
  }
}
