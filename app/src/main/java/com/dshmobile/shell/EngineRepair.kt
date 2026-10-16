package com.dsharnessmobile.shell

import android.content.Context
import android.util.Log
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * 引擎内部失活的升级处置阶梯（0.13.5 坑 79，2026-10-16）。
 *
 * 病灶（真机对照实验 + 源码定位）：插件框架按服务注入 gating，任何一个插件在初始化期抛错
 * 或被旧树拖累 import 失败，它提供的服务就永不出现，下游插件全挂 pending
 * （engine.log 里 `pending (waiting for service: workspaceRegistry)`）。工作区面板、
 * 「临时工作区」条目和会话控制器都挂在 workspaceRegistry 这条链上，于是用户看到
 * 「工作区一直加载中 + 临时工作区没了 + 发消息没回复」，而引擎 HTTP 照常应答。
 *
 * 为什么只有覆盖升级多年的机器会留残渣：[EngineManager.extractSnapshot] 是叠加式解压，
 * 从不删除旧文件。新快照里同路径的条目会被覆盖写（软链/文件分支先 `deleteForOverwrite` 清掉
 * 旧目录），所以「旧包占位」本身可被重抽纠正；纠正不了的是新快照里**没有**对应条目的残留，
 * 典型是旧快照留下的、指向已消失 store 目录的悬空软链——解析到它的 import 直接失败。
 * 干净安装没有旧树可混，所以同一个 APK 在测试机好用。
 * （真机实证一：把 usr 里 dsh-workspace 包改名 → file-incoming 路由 404、面板卡加载中、
 *   发消息无回复；重抽补回该包 → 全部恢复。
 *   真机实证二：并发重抽留下的残树（扁平依赖只剩 29 个、js-yaml 缺失）用「清指纹 + 叠加
 *   重抽」补回 230 个扁平依赖、路由恢复 200 —— 本阶梯第 2 档用的就是这条路。）
 *
 * 阶梯（每档出手都记时间戳，24h 预算，绝不循环重启）：
 *   1) 重启引擎（本轮病灶窗口内最多 2 次）——覆盖「存储改写后没重载」这类一次性状态；
 *   2) 运行环境重建 [EngineManager.rebuildRuntime]（24h 1 次）——**非销毁式**：清指纹 +
 *      叠加重抽内嵌快照 + 清 `usr/lib/node_modules` 下的悬空软链，用户数据一律保留。
 *      （曾改成「先把 usr rename 让位再解压」，真机两轮实测把测试设备做成无运行时的砖
 *       ——解压要 10+ 分钟、中断即无可回滚基线、还留 1GB+ 让位树吃空间，已回退，见坑 79。）
 *   3) 引擎用户数据让位（24h 1 次）——把 storages/sessions 改名让位（不删），
 *      治「数据本身毒到插件初始化」这一最后变量，等价干净安装的数据面；
 *   4) 预算用尽仍失活：停止自动出手，落诊断包并通知用户（此时需要人来判断）。
 */
object EngineRepair {

  private const val TAG = "dsh-engine-repair"
  private const val DAY_MS = 24L * 60 * 60 * 1000
  private const val MAX_ACTIONS_PER_DAY = 4
  private const val RESTARTS_PER_EPISODE = 2
  private const val EPISODE_MS = 30L * 60 * 1000

  private fun stateFile(context: Context): File = File(context.filesDir, ".engine-repair.json")

  /** 探活恢复健康：本轮病灶结束，重启次数归零（重建/让位的 24h 预算不清）。 */
  fun noteHealthy(context: Context) {
    val st = read(context) ?: return
    if (st.optJSONObject("episode")?.optInt("restarts", 0) != 0) {
      st.put("episode", JSONObject())
      write(context, st)
    }
  }

  /**
   * 病灶确认一次，出手一档（看门狗 tick 线程调用，可能阻塞分钟级——后续 tick 顺延即可）。
   * @return 本次执行的动作名，null = 预算用尽/无从处置。
   */
  fun advance(context: Context, engineManager: EngineManager): String? {
    val st = read(context) ?: JSONObject()
    val now = System.currentTimeMillis()
    val actions = prune(st.optJSONArray("actions"), now)
    st.put("actions", actions)
    if (actions.length() >= MAX_ACTIONS_PER_DAY) {
      if (st.optLong("gaveUpAt") == 0L || now - st.optLong("gaveUpAt") > DAY_MS) {
        st.put("gaveUpAt", now)
        LogCollector.log(TAG, "escalation budget exhausted ($MAX_ACTIONS_PER_DAY/day); giving up, diagnostics mirrored")
        safe { engineManager.mirrorDiagnosticsToShared("engine-internally-unhealthy") }
        // 文案只讲机器真实存在的位置：mirrorDiagnosticsToShared 落 <dshdata>/diagnostics/<ts>-<reason>/
        safe { NotifyCenter.notify(context, "engine", "引擎内部异常，自动修复已到预算上限", "诊断包已存到 dshdata/diagnostics（引擎日志 + 信息包），请附该目录反馈") }
      }
      write(context, st)
      return null
    }
    val episode = st.optJSONObject("episode") ?: JSONObject()
    val episodeAge = now - episode.optLong("t", 0)
    val restarts = if (episodeAge > EPISODE_MS) 0 else episode.optInt("restarts", 0)
    if (restarts < RESTARTS_PER_EPISODE) {
      val action = "restart#" + (restarts + 1)
      st.put("episode", JSONObject().put("t", if (episodeAge > EPISODE_MS) now else episode.optLong("t")).put("restarts", restarts + 1))
      record(actions, action, now)
      write(context, st)
      LogCollector.log(TAG, "engine internally unhealthy; escalation step 1: restart engine ($action)")
      safe {
        engineManager.stopEngine()
        engineManager.resetCooldown()
        engineManager.startEngine()
      }
      return action
    }
    if (spend(st, "runtimeRebuild", now, 1)) {
      record(actions, "runtime-rebuild", now)
      st.put("episode", JSONObject()) // 重建后重新给一轮重启预算
      write(context, st)
      LogCollector.log(TAG, "escalation step 2: rebuild runtime from embedded snapshot (user data kept)")
      // 重抽要几分钟（真机实测 108s 完整过一遍 1.19GB 归档），其间引擎是按设计停着的——
      // 不吭声用户只会看到「启动不了」。
      safe { NotifyCenter.notify(context, "engine", "正在重建运行环境", "需要几分钟，其间引擎会暂停；会话、工作区、凭据都会保留") }
      safe { engineManager.stopEngine() }
      val ok = safeR { engineManager.rebuildRuntime() } == true
      LogCollector.log(TAG, "runtime rebuild " + (if (ok) "ok" else "FAILED; old runtime kept"))
      safe { engineManager.resetCooldown(); engineManager.startEngine() }
      safe { engineManager.mirrorDiagnosticsToShared("runtime-rebuild") }
      return "runtime-rebuild"
    }
    if (spend(st, "userDataReset", now, 1)) {
      record(actions, "userdata-reset", now)
      write(context, st)
      LogCollector.log(TAG, "escalation step 3: move engine user data aside (storages/sessions kept as *-stale-<ts>)")
      safe { engineManager.stopEngine() }
      val moved = quarantineUserData(context)
      LogCollector.log(TAG, "user data moved aside: " + moved.joinToString(","))
      safe { engineManager.resetCooldown(); engineManager.startEngine() }
      if (moved.isNotEmpty()) {
        safe { NotifyCenter.notify(context, "engine", "已让位可疑引擎数据", "原数据未删除，保留在 files/home/.dsh/" + moved.joinToString("、") + "（内置终端可取回）") }
      }
      safe { engineManager.mirrorDiagnosticsToShared("userdata-reset") }
      return "userdata-reset"
    }
    write(context, st)
    return null
  }

  /**
   * 把引擎用户数据面让位（改名，不删除）：storages（whole-unit 快照）与 sessions（会话正文）。
   * 让位件就放在 .dsh 里（`storages-stale-<ts>`），引擎按名字取单元、不会误读它；
   * 凭据、设置、附件、工作区目录一律原地保留。
   */
  private fun quarantineUserData(context: Context): List<String> {
    val dsh = File(context.filesDir, "home/.dsh")
    val ts = System.currentTimeMillis()
    val out = ArrayList<String>()
    for (name in listOf("storages", "sessions")) {
      val src = File(dsh, name)
      if (!src.exists()) continue
      val aside = File(dsh, "$name-stale-$ts")
      if (src.renameTo(aside)) out.add(aside.name) else Log.w(TAG, "user data quarantine failed: " + src.absolutePath)
    }
    return out
  }

  /** 24h 预算闸门：同档一天最多 [limit] 次。 */
  private fun spend(st: JSONObject, key: String, now: Long, limit: Int): Boolean {
    val e = st.optJSONObject(key)
    val withinDay = e != null && now - e.optLong("t", 0) < DAY_MS
    if (withinDay && e.optInt("n", 0) >= limit) {
      LogCollector.log(TAG, "$key already spent within 24h; waiting for the budget window")
      return false
    }
    st.put(key, JSONObject().put("t", now).put("n", if (withinDay) e.optInt("n", 0) + 1 else 1))
    return true
  }

  private fun prune(arr: JSONArray?, now: Long): JSONArray {
    val out = JSONArray()
    if (arr != null) {
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        if (now - o.optLong("t", 0) < DAY_MS) out.put(o)
      }
    }
    return out
  }

  private fun record(actions: JSONArray, type: String, now: Long) {
    actions.put(JSONObject().put("type", type).put("t", now))
  }

  private fun read(context: Context): JSONObject? = try {
    val f = stateFile(context)
    if (!f.exists()) JSONObject() else JSONObject(f.readText(Charsets.UTF_8))
  } catch (_: Exception) {
    JSONObject()
  }

  private fun write(context: Context, st: JSONObject) {
    try {
      val f = stateFile(context)
      val tmp = File(f.parentFile, ".engine-repair.tmp")
      tmp.writeText(st.toString(), Charsets.UTF_8)
      if (!tmp.renameTo(f)) tmp.delete()
    } catch (t: Throwable) {
      Log.w(TAG, "repair state write failed (non-fatal)", t)
    }
  }

  /** 自愈本身绝不允许把看门狗线程带崩：所有处置动作统一吞异常并记录。 */
  private fun safe(block: () -> Unit) {
    try {
      block()
    } catch (t: Throwable) {
      Log.w(TAG, "repair action threw (swallowed)", t)
    }
  }

  /** 需要返回值的处置档（重建结果决定后续日志/重启是否值得）。 */
  private fun <T> safeR(block: () -> T): T? = try {
    block()
  } catch (t: Throwable) {
    Log.w(TAG, "repair action threw (swallowed)", t)
    null
  }
}
