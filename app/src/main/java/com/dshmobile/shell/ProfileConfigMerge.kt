package com.dsharnessmobile.shell

import android.util.Log
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * 坑 87（2026-10-17 真机实锤）：`profiles/{web,headless}/cordis*.yml` 里**工厂基线和用户配置是同
 * 一份文件**——用户在设置界面加的自定义供应商（`- id: llm-pi-ai` 的 `providers:` 段）与默认模型
 * （`- id: agent-default-model-mobile` 的 `provider:`/`model:`）都以 root-level 列表项追加在工厂内容
 * 之后。而换 APK / 运行时重建必然重抽快照（`refreshSnapshotLocked` 的既定策略是「工厂 profile 随快照
 * 走」），于是那几项被整片冲走：`.credentials.yaml` 里的 `J_API_KEY` 引用（属用户数据、刻意保留）
 * 变成悬空引用，持久化会话里的模型串 `j/glm-…` 再无对应 adapter → 界面照常、发消息只回一张
 * `no adapter registered for provider "j"`（NO_ADAPTER）。用户视角=「升个级，聊天就废了」。
 *
 * 这里做的是**逐块三方合并**，不是整文件保护：整文件保护会让工厂升级永远进不来（插件装配、
 * shell-termux 路径这些是我们随 APK 发的），整文件覆盖则是现在这个吃配置的 bug。判据：
 *  · 用户块 == 上一轮工厂基线 → 用户没动过 → 随新基线走（升级照常生效，基线里删掉的项也真的删掉）；
 *  · 用户块 != 基线 → 用户改过 → 用户赢（基线没有的追加、基线有的覆盖），冲突只在日志点名；
 *  · 没有基线（本修复上线后的第一轮）→ 无法区分「用户改过」与「工厂改过」，只做保守的**追加**：
 *    基线里缺席的用户块补回去，基线里同 id 的块仍用新基线。
 * 合并本身是 best-effort：任何异常都记日志并让重抽继续（宁可少留一个用户块，也不能因为合并失败
 * 把整轮重抽卡死——那才是真的让设备更糟）。
 */
object ProfileConfigMerge {
  private const val TAG = "dsh-engine"
  private val PROFILES = listOf("web", "headless")
  private val NAMES = listOf("cordis.yml", "cordis.patch.yml")

  /** key = "<profile>/<name>"，value = [现场用户内容, 上一轮工厂基线]（任一可为 null） */
  class Captured(private val entries: MutableMap<String, Array<String?>> = mutableMapOf()) {
    operator fun get(key: String): Array<String?>? = entries[key]

    internal fun put(key: String, user: String?, baseline: String?) {
      entries[key] = arrayOf(user, baseline)
    }
  }

  private class Doc(val preamble: String, val blocks: List<Block>)
  private class Block(val id: String, val label: String, val text: String)

  private fun key(profile: String, name: String) = profile + "/" + name

  private fun configFile(dsh: File, profile: String, name: String) =
    File(File(dsh, "profiles/$profile"), name)

  private fun baselineFile(dsh: File, profile: String, name: String) =
    File(File(dsh, ".profile-factory-baseline/$profile"), name)

  /** 重抽**之前**调用：把现场内容与上一轮基线一起读进内存（读不动按缺席处理，不动盘）。 */
  fun capture(dsh: File): Captured {
    val out = Captured()
    for (profile in PROFILES) {
      for (name in NAMES) {
        try {
          out.put(key(profile, name), read(configFile(dsh, profile, name)), read(baselineFile(dsh, profile, name)))
        } catch (t: Throwable) {
          Log.w(TAG, "profile config capture failed for $profile/$name (non-fatal)", t)
        }
      }
    }
    return out
  }

  /** 重抽**之后**调用：逐块合并回用户配置，并把本轮工厂内容记为新基线。返回被保住的块数。 */
  fun mergeBack(dsh: File, captured: Captured): Int {
    var preserved = 0
    for (profile in PROFILES) {
      for (name in NAMES) {
        try {
          preserved += mergeOne(dsh, profile, name, captured[key(profile, name)])
        } catch (t: Throwable) {
          Log.w(TAG, "profile config merge failed for $profile/$name (non-fatal, extraction kept)", t)
        }
      }
    }
    if (preserved > 0) {
      Log.i(TAG, "profile user config preserved across snapshot re-extract: $preserved block(s)")
      LogCollector.log(TAG, "升级重抽保住了 $preserved 段用户 profile 配置（自定义供应商/默认模型），见坑 87")
    }
    return preserved
  }

  private fun mergeOne(dsh: File, profile: String, name: String, held: Array<String?>?): Int {
    val target = configFile(dsh, profile, name)
    val factory = read(target) ?: return 0 // 新快照里没有这个文件：没有基线可合，什么也不写
    val factoryDoc = parse(factory)
    // 基线永远记「本轮工厂内容」，与合并结果无关：下一轮才分得清用户改动与工厂升级。
    writeAtomic(baselineFile(dsh, profile, name), factory)

    val user = held?.get(0) ?: return 0
    val base = held.get(1)
    val userDoc = parse(user)
    val baseBlocks = base?.let { parse(it).blocks }
    val merged = LinkedHashMap<String, String>()
    for (b in factoryDoc.blocks) merged[b.id] = b.text

    var kept = 0
    for (ub in userDoc.blocks) {
      val bb = baseBlocks?.firstOrNull { it.id == ub.id }
      if (baseBlocks == null) {
        // 无基线：只补工厂里缺席的块，同 id 的仍随工厂（无法证明是用户改的）
        if (!merged.containsKey(ub.id)) {
          merged[ub.id] = ub.text
          kept++
          Log.i(TAG, "profile config append (no baseline) $profile/$name: " + ub.label)
        }
        continue
      }
      if (same(ub.text, bb?.text)) continue // 用户没动过：随新基线
      val factoryBlock = factoryDoc.blocks.firstOrNull { it.id == ub.id }
      if (factoryBlock != null && !same(factoryBlock.text, ub.text)) {
        Log.i(TAG, "profile config conflict, user wins $profile/$name: " + ub.label)
      }
      merged[ub.id] = ub.text
      kept++
      Log.i(TAG, "profile config kept $profile/$name: " + ub.label)
    }
    if (kept == 0) return 0

    // 输出 = 工厂块序（内容换成合并结果）+ 工厂里没有的用户块（按现场顺序追加在尾部）
    val sb = StringBuilder(factoryDoc.preamble)
    for (b in factoryDoc.blocks) sb.append(merged[b.id])
    for (ub in userDoc.blocks) if (factoryDoc.blocks.none { it.id == ub.id }) sb.append(ub.text)
    // 尾行收敛成恰好一个换行：否则每轮重抽多攒一个空行，合并结果不幂等（第二轮起逐字节漂移）
    val outText = sb.toString().trimEnd('\n', '\r') + "\n"
    if (outText == factory) return 0
    writeAtomic(target, outText)
    return kept
  }

  /**
   * 按 root-level 列表项切块：`- ` 顶格起块，直到下一个顶格 `- `。块身份：`- id: X` 用 X；
   * `- insert:` 这类用内层 `name:` 集合（工厂升级仍对得上号）；都对不上则用规范化全文。
   * 顶格注释只可能写在项与项之间（列表项续行必须缩进），所以它归**后一块**；首个块之前的
   * 部分留作 preamble。比较一律走 normalize（注释漂移不算用户编辑）。
   */
  private fun parse(text: String): Doc {
    val blocks = ArrayList<Block>()
    var lead = StringBuilder()
    var cur: StringBuilder? = null
    var preamble = ""
    for (raw in text.split("\n")) {
      val line = raw.trimEnd()
      val starts = line.startsWith("- ") || line == "-"
      if (starts) {
        if (cur == null) preamble = lead.toString()
        if (cur != null) blocks.add(build(cur.toString()))
        cur = StringBuilder(lead.toString()).append(line).append("\n")
        lead = StringBuilder()
      } else if (cur == null || line.startsWith("#")) {
        lead.append(line).append("\n")
      } else {
        cur.append(line).append("\n")
      }
    }
    if (cur != null) blocks.add(build(cur.toString()))
    return Doc(preamble, blocks.filter { it.text.isNotBlank() })
  }

  private fun build(body: String): Block {
    // 块尾的空行不算内容：否则每轮重抽都会多攒一个换行，合并结果不幂等
    val trimmed = body.trimEnd('\n', '\r') + "\n"
    val lines = trimmed.split("\n").filter { it.isNotBlank() && !it.trimStart().startsWith("#") }
    val first = lines.firstOrNull() ?: "-"
    var id: String? = Regex("^-\\s+id:\\s*[\"']?([^\"'\\s]+)[\"']?\\s*$").find(first)?.groupValues?.get(1)
    if (id == null) {
      val names = lines.mapNotNull { Regex("^\\s*name:\\s*[\"']?([^\"'\\s]+)[\"']?\\s*$").find(it)?.groupValues?.get(1) }
      id = if (names.isNotEmpty()) "insert:" + names.sorted().joinToString(",") else "text:" + normalize(trimmed)
    }
    val head = first.removePrefix("-").trim()
    return Block(id, head.ifBlank { first }, trimmed)
  }

  /**
   * 比较用：忽略注释、空行、行尾空白、引号风格（`"` 与 `'`）与行内多空格。
   * 必要性：设置界面用 js-yaml 回写块时是它自己的风格（双引号 `name: "@deepseek-ai/…"`），
   * 与工厂手写的单引号逐字节不同；不忽略这些就会被误判成「用户改过」，从此那个块的工厂升级
   * 永远进不来。缩进长度保留（YAML 里它是有语义的）。
   */
  private fun normalize(body: String): String =
    body.split("\n").map { it.trimEnd() }
      .filter { it.isNotBlank() && !it.trimStart().startsWith("#") }
      .joinToString("\n") { line ->
        val indent = line.takeWhile { it == ' ' }
        indent + line.trim().replace('"', '\'').replace(Regex("\\s+"), " ")
      }

  private fun same(a: String?, b: String?): Boolean = normalizeOrEmpty(a) == normalizeOrEmpty(b)

  private fun normalizeOrEmpty(body: String?): String = body?.let { normalize(it) } ?: ""

  private fun read(f: File): String? = try {
    if (f.isFile && f.length() in 1..4194304) String(Files.readAllBytes(f.toPath()), Charsets.UTF_8) else null
  } catch (t: Throwable) {
    Log.w(TAG, "profile config read failed for " + f.name, t)
    null
  }

  private fun writeAtomic(f: File, content: String) {
    val bytes = content.toByteArray(Charsets.UTF_8)
    val tmp = File(f.parentFile, "." + f.name + ".tmp-" + System.nanoTime())
    try {
      f.parentFile?.mkdirs()
      Files.write(tmp.toPath(), bytes)
      Files.move(tmp.toPath(), f.toPath(), StandardCopyOption.REPLACE_EXISTING)
    } catch (t: Throwable) {
      Log.w(TAG, "profile config write failed for " + f.absolutePath, t)
      runCatching { tmp.delete() }
    }
  }
}
