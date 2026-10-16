package com.dsharnessmobile.shell

import android.util.Log
import java.io.File
import java.io.InputStream
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.xz.XZCompressorInputStream

/**
 * Shared snapshot extraction: xz tar → dest with owner-only permissions
 * (dsh's credentials provider fails loud on world-readable secrets) and
 * symlink preservation. Used by both the bundled snapshot (assets) and the
 * online update path (downloaded file).
 *
 * After extraction, every executable file gets the Android exec attribute
 * (security.android.exec): Android 15+ apps targeting SDK 35+ may only exec
 * app-data ELF binaries that carry it. The tar does not preserve xattrs
 * through the Java path, so it is stamped via the system setfattr (best
 * effort — kernels that do not enforce it accept the no-op).
 */
object SnapshotExtractor {

  /** 归档里被剥掉的用户数据名（相对 `home/.dsh`）：重抽要靠备份把它们带回来。 */
  val USER_DATA_NAMES = listOf(
    "sessions", "storages", "attachments",
    ".credentials.yaml", "settings.yaml", ".anonymous-user-id", ".private-layout",
  )

  /**
   * 现场用户数据（相对 `filesDir/home/.dsh`）：归档重建/在线升级都不许覆盖掉现场已有的那一份。
   *
   * 坑 80（真机 2026-10-16 定位到机制）：归档里带的正是 `settings.yaml` 出厂 seed 模板
   * （scripts/build-snapshot-013.mjs:88 writeFileSync），而 `dsh-settings` 读它的语义是
   * **一次性导入**：`rename(path, path + ".imported")` 再把各段写进 profile
   * （node_modules/@deepseek-ai/dsh-settings/lib/index.js:350-362）。于是每落一次模板 =
   * 下一轮启动就把「`llm-deepseek: {}` / `llm-pi-ai.providers: {}`」当成用户配置导入一遍，
   * 把用户自己配好的供应商/模型 route 冲掉——用户侧就是「消息发出去没回复」。
   * 所以判定不看「现场有没有 settings.yaml」，而是「现场有没有导入过的痕迹」：
   * settings.yaml 或 settings.yaml.imported 任一存在，模板一律不许落盘。
   */
  fun liveUserDataGuard(filesDir: File): (File) -> Boolean {
    val dsh = File(File(filesDir, "home"), ".dsh")
    return { target ->
      if (target.parentFile?.absolutePath != dsh.absolutePath) false
      else if (target.name == "settings.yaml")
        target.isFile || File(dsh, "settings.yaml.imported").isFile
      else target.isFile && target.name in USER_DATA_NAMES
    }
  }

  /**
   * Extract an xz-compressed tar stream.
   * @param input raw xz stream.
   * @param totalBytes expected stream size (for progress; 0 = unknown).
   * @param dest destination root (filesDir; the archive holds usr/ + home/).
   * @param onProgress bytesDone, bytesTotal.
   * @param protect live paths the archive must never overwrite — see [isProtected] below.
   */
  fun extract(
    input: InputStream,
    totalBytes: Long,
    dest: File,
    onProgress: (Long, Long) -> Unit = { _, _ -> },
    protect: (File) -> Boolean = { false },
  ) {
    val xz = XZCompressorInputStream(input)
    val tar = TarArchiveInputStream(xz)
    val execFiles = mutableListOf<String>()
    val destCanon = dest.canonicalPath
    var done = 0L
    var entry: TarArchiveEntry? = tar.nextEntry
    while (entry != null) {
      // 路径穿越防护（2026-08-23 安全审计 CRITICAL 修复）：拒绝绝对路径/../ 越界 /
      // 符号链接逃逸——在线更新快照由明文 HTTP（可篡改）路径提供，此层是沙盒边界。
      val target = resolveEntry(dest, destCanon, entry)
      if (target == null) {
        Log.w("dsh-snap", "skipping unsafe tar entry: " + entry.name)
        entry = tar.nextEntry
        continue
      }
      // 坑 80：归档里的 home/.dsh/settings.yaml 是构建期写死的出厂 seed 模板
      // （scripts/build-snapshot-013.mjs 的 writeFileSync）。叠加式重抽对它是「删了重写」，
      // 于是每次升级/运行时重建都把用户自己的 settings.yaml 换成空模板——自定义供应商、
      // 模型 pin 全没，用户侧就是「消息发出去没回复」。现场已存在受保护的路径时，
      // 归档里那一份一律不落盘（progress 少计一个文件，无关紧要）。
      if (protect(target)) {
        Log.i("dsh-snap", "live file protected from archive overwrite: " + entry.name)
        entry = tar.nextEntry
        continue
      }
      when {
        entry.isDirectory -> target.mkdirs()
        entry.isSymbolicLink -> {
          target.parentFile?.mkdirs()
          // 符号链接目标必须也落在解压根内（不解析绝对链接/越界相对链接）。
          val linkCanon = java.io.File(target.parentFile, entry.linkName).canonicalPath
          if (!linkCanon.startsWith(destCanon + File.separator)) {
            Log.w("dsh-snap", "skipping unsafe symlink: " + entry.name + " -> " + entry.linkName)
            entry = tar.nextEntry
            continue
          }
          // 覆盖写前清理：旧快照的「目录」与新快照的「软链」同路径时（实测 usr/lib/terminfo、
          // usr/lib/icu/current、node_modules 下条目在快照重建中从目录改为软链），deleteIfExists 对
          // 非空目录抛 DirectoryNotEmptyException → 升级重解压整体失败、指纹永远更新不了。
          // deleteForOverwrite 递归删非空目录，文件/dangling 软链直接删（不跟随软链）。
          deleteForOverwrite(target)
          java.nio.file.Files.createSymbolicLink(target.toPath(), java.nio.file.Paths.get(entry.linkName))
        }
        else -> {
          target.parentFile?.mkdirs()
          // Overwrite-safety: a previous extraction can leave a read-only regular file
          // (measured: termux-am/am.apk with 0400 on some emulator ROMs — FileOutputStream
          // would fail EACCES on the upgrade re-extract), or a directory where the new
          // snapshot has a regular file (same conflict class as the symlink branch above).
          deleteForOverwrite(target)
          target.outputStream().use { out ->
            val buf = ByteArray(64 * 1024)
            var n = tar.read(buf)
            while (n >= 0) {
              out.write(buf, 0, n)
              n = tar.read(buf)
            }
          }
          target.setReadable(false, false)
          target.setReadable(true, true)
          target.setWritable(true, true)
          target.setExecutable(entry.mode and 0x40 != 0, true)
          if (entry.mode and 0x40 != 0) execFiles.add(target.absolutePath)
        }
      }
      done += entry.size
      if (done % (1024 * 1024) < entry.size) onProgress(done, totalBytes)
      entry = tar.nextEntry
    }
    tar.close()
    stampExecAttribute(execFiles)
  }

  /** 解析 tar 条目到解压根内目标：拒绝绝对路径、../ 越界；返回 null 表示应跳过该条目。 */
  private fun resolveEntry(dest: File, destCanon: String, entry: TarArchiveEntry): File? {
    val name = entry.name.replace('\\', '/').trimStart('/')
    if (name.isEmpty() || name.contains("..")) return null
    val target = File(dest, name)
    return try {
      // canonicalPath 解析存在的父目录段；目标本身尚未创建时用父目录判定。
      val parentCanon = (target.parentFile?.canonicalPath ?: destCanon)
      if (parentCanon.startsWith(destCanon + File.separator) || parentCanon == destCanon) target else null
    } catch (_: Exception) {
      null
    }
  }

  /**
   * 覆盖写前清理：deleteIfExists 无法删非空目录（DirectoryNotEmptyException），而升级重解压时
   * 旧快照的「目录」与新快照的「软链/文件」同路径会冲突（实测 usr/lib/terminfo、icu/current、
   * node_modules 下条目）。软链/文件直接删（不跟随）；真实目录逆序递归删。
   */
  private fun deleteForOverwrite(target: File) {
    val p = target.toPath()
    if (java.nio.file.Files.isSymbolicLink(p) || !java.nio.file.Files.isDirectory(p)) {
      java.nio.file.Files.deleteIfExists(p)
    } else {
      java.nio.file.Files.walk(p).use { stream ->
        stream.sorted { a, b -> b.compareTo(a) }
          .forEach { java.nio.file.Files.deleteIfExists(it) }
      }
    }
  }

  /** Stamp the Android exec attribute on all extracted executables. */
  private fun stampExecAttribute(files: List<String>) {
    if (files.isEmpty()) return
    try {
      // Args pass straight through (no shell), so quotes/metacharacters in filenames are not interpreted.
      val base = listOf("/system/bin/setfattr", "-n", "security.android.exec", "-v", "1")
      // Concurrent batches (max 64 per batch) avoid spawning too many processes at once.
      files.chunked(64).forEach { batch ->
        val procs = batch.map { f -> ProcessBuilder(base + f).redirectErrorStream(true).start() }
        for (p in procs) {
          val finished = p.waitFor(30, java.util.concurrent.TimeUnit.SECONDS)
          if (!finished) p.destroyForcibly()
        }
      }
    } catch (_: Throwable) {
      // Kernels without the exec-attribute check (emulators, older Android)
      // do not need it; ignore failures here.
    }
  }
}
