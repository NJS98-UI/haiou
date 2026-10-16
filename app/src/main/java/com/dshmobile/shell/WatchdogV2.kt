package com.dsharnessmobile.shell

import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import android.util.Log
import java.io.File

/**
 * 看门狗升级（0.13.0 PRD F2/M3.4）：
 * - 深度探活：HTTP 状态码 + 引擎日志增量异常扫描 + **引擎内部服务探活**（0.13.5 坑 79：
 *   `/api/android/file-incoming` 可答才说明插件树真的装配到位——HTTP 健康但服务缺席时
 *   进程不崩、界面能开，用户侧却是「工作区加载中 + 无临时工作区 + 发消息没回复」）。
 *   内部失活只计数不进探活失败语义，处置交给 [EngineRepair] 阶梯（EngineService tick 驱动）。
 * - 熔断与指数退避：连续失败 → 指数退避（5s→10s→20s→40s→80s 封顶），超过熔断阈值（12 次连续失败）
 *   暂停看门狗并记录（界面提示由 GuideChrome 状态区显示），用户交互或探活成功自动复位。
 * - 开机自启：BOOT_COMPLETED 接收器恢复用户上次同意的运行状态（EngineService.userShutdown 持久化）。
 * - 前台唤醒锁：引擎前台运行期间持有（PARTIAL_WAKE_LOCK，标准档位；获取失败降级尽力模式并记录）。
 * - 授权状态探活：ADB 配对断线时记录（F2.9，桥引导重新配对由桥层返回）。
 */
object WatchdogV2 {

  private const val TAG = "dsh-watchdog"
  const val MAX_CONSEC_FAILURES = 12

  /** half-open 恢复窗（2026-10 修复）：熔断持续该时长后自动降级重试一次。 */
  private const val HALF_OPEN_MS = 5 * 60_000L

  @Volatile
  var consecutiveFailures = 0
    private set

  /** 熔断进入时间（half-open 恢复基线）。 */
  @Volatile
  private var trippedAt = 0L

  /** 引擎日志增量扫描游标（上次已读到的文件长度；rotate/截断时自动重置）。 */
  @Volatile
  private var lastLogOffset = 0L

  /** 指数退避：5s * 2^n，封顶 80s。返回下次探测延迟（ms）。 */
  fun nextDelayMs(): Long {
    val n = consecutiveFailures.coerceAtMost(4)
    return (5_000L shl n).coerceAtMost(80_000L)
  }

  fun recordProbe(healthy: Boolean) {
    consecutiveFailures = if (healthy) 0 else consecutiveFailures + 1
    if (consecutiveFailures >= MAX_CONSEC_FAILURES) trippedAt = System.currentTimeMillis()
  }

  /**
   * 熔断判定。half-open（2026-10 修复）：熔断 5 分钟后自动降级放行一轮探活——
   * 熔断期间 recordProbe 停摆，旧实现 consecutiveFailures 永远 >= 阈值且无人复位，
   * 看门狗永久瘫痪（只能等 MainActivity 用户交互路径 reset）。降级后探活失败会
   * 在 recordProbe 里重新进入熔断（重开 5 分钟窗口），成功则归零恢复正常。
   */
  fun tripped(): Boolean {
    if (consecutiveFailures < MAX_CONSEC_FAILURES) return false
    if (System.currentTimeMillis() - trippedAt > HALF_OPEN_MS) {
      consecutiveFailures = MAX_CONSEC_FAILURES - 6
      trippedAt = System.currentTimeMillis()
      LogCollector.log(TAG, "watchdog half-open: retry after circuit-break window")
      return false
    }
    return true
  }

  fun reset() {
    consecutiveFailures = 0
    trippedAt = 0L
  }

  /**
   * 深度探活：EngineProbe + 引擎**内部**服务健康 + 引擎日志异常。
   *
   * 坑 79（2026-10-16）：HTTP 应答正常不等于引擎可用。插件框架（dsh-app-boot）按服务注入 gating：
   * 一个插件在 [cordis.init] 抛错或 import 失败时，进程照跑、web 照答，但它提供的服务永不出现，
   * 依赖它的插件全挂 pending（waiting for service: workspaceRegistry）——而工作区面板、
   * 「临时工作区」条目、会话控制器（dsh-api-session-controller 同样注入 workspaceRegistry）
   * 全在这条依赖链上，用户侧就是「没有临时工作区 + 发消息没回复」。旧实现只看 HTTP 与
   * 两行日志关键字，对这个状态永远判健康，既不重启也不修复——这才是「同一个 APK，
   * 测试机好用、我自己的机器不能用」的判定盲区。
   *
   * 判据用我们自己插件注册的路由 `/api/android/file-incoming`：dsh-android-file-open 的
   * inject 含 workspaceRegistry，它没激活（404）就等于注册表缺席。该路由是引擎白名单只读面
   * （另两个是 `/api/session.cancel` 与 `/api/session.export`；`/api/workspace.list` 这类
   * 插件 RPC 不对外暴露，一律 404，不能用作探针）。
   */
  fun deepProbe(context: Context): Boolean {
    val base = EngineProbe.check().optBoolean("running", false)
    if (!base) {
      internalUnhealthyStreak = 0
      internalHealthy = false // 引擎都不在，谈不上内部健康——病灶窗口未结束
      return false
    }
    // 插件树/桥端点（bridge 插件注册；未注册时 404=false 但引擎健康仍算通过——以 base 为准）
    // 2026-08-23 修复：旧代码 (pluginHealth || true) 恒真 —— 白跑一次 HTTP 且死代码。
    val logDelta = readEngineLogDelta(context)
    // 坑 78：引擎 HTTP 应答正常，但日志里的 StorageError 会让 workspaceRegistry 缺席
    // （工作区一直加载中、发消息没回复）。这里认签名交给存储自愈，改过磁盘就置重启标记。
    val rot = takeRotationTail()
    if (StorageHeal.fromLogDelta(context, if (rot == null) logDelta else logDelta + "\n" + rot)) storageHealApplied = true
    val logOk = !logDelta.contains("UncaughtException") && !logDelta.contains("plugin tree failed to load")
    // 坑 80：凭据文件带 group/other 位 → credentials 插件不激活 → required 链全灭、端口不开。
    // 处置不需要看门狗做额外动作（startEngine 前置的 enforceOwnerOnlySecrets 会在下一次 spawn 前
    // 收敛成 0600），但要在日志里留一行指名病灶，否则「引擎起不来」只能靠翻 startup 诊断文件。
    if (logDelta.contains("readable beyond its owner")) {
      LogCollector.log("dsh-watchdog", "credential store is group/other-readable (pitfall 80); next start will chmod 600 it before spawn")
    }
    // F0.3 事件桥消费（2026-08-24）：引擎任务完成标记 → 系统通知（探活成功才消费，避免引擎
    // 挂死时误弹；消费幂等——读完即清）。
    if (logOk) consumeTaskDoneMarkers(context)
    val internalOk = internalServiceHealth()
    internalHealthy = internalOk
    if (internalOk) {
      internalUnhealthyStreak = 0
    } else if (System.currentTimeMillis() - EngineManager.lastStartAttemptAt > INTERNAL_GRACE_MS) {
      internalUnhealthyStreak++
    }
    // 内部失活**不并入返回值**：引擎进程活着、HTTP 也好，走「探活失败」那条路会把重启/熔断/
    // 自动回撤那套崩溃语义搅进来（熔断后看门狗停摆，升级处置反而永远轮不到出手）。
    // 这里只计数，处置由 EngineService tick 交给 [EngineRepair] 的阶梯。
    return base && logOk
  }

  /** 内部失活宽限：引擎刚起来这段时间插件树可能仍在装配，不计失活。 */
  private const val INTERNAL_GRACE_MS = 60_000L

  /** 坑 79 的内部服务探针路由（dsh-android-file-open 注入 workspaceRegistry，它活着=注册表到位）。 */
  private const val INTERNAL_PROBE_PATH = "/api/android/file-incoming"

  /**
   * 引擎内部服务健康：file-open 路由可答 = 插件树装配到位。
   * 连不上/401（会话换代）一律按「无从判定」放行——外部探活与下一轮 tick 会再判。
   */
  private fun internalServiceHealth(): Boolean {
    val (code, _) = EngineProbe.get(INTERNAL_PROBE_PATH)
    if (code == -1 || code == 401) return true
    return code in 200..299
  }

  /** HTTP 正常但插件树内部失活的连续轮数（升级阶梯的触发计数）。 */
  @Volatile var internalUnhealthyStreak = 0
    private set

  /**
   * 最近一轮内部探活的结果。**病灶是否结束只能看它，不能看计数是否为 0**——
   * 阶梯出手后计数被 `consumeInternalUnhealthy` 归零，而引擎此刻仍在装配（宽限期）或
   * 依旧失活，此时若按「计数 0」判病灶结束，就会把本轮重启预算清零，阶梯永远升不到
   * 真正治本的那一档（运行环境重建）。
   */
  @Volatile var internalHealthy: Boolean = false
    private set

  /** 取走「该出手了」信号：达到阈值即归零计数，由处置方（EngineRepair）决定动作。 */
  fun consumeInternalUnhealthy(threshold: Int = 3): Boolean {
    if (internalUnhealthyStreak < threshold) return false
    internalUnhealthyStreak = 0
    return true
  }

  /**
   * 存储自愈已落地的标记（EngineService 每个 tick 用 [consumeStorageHeal] 取一次）：
   * 单元文件被隔离/改写必须重启引擎才生效，而引擎此刻 HTTP 健康、看门狗自己不会重启它。
   */
  @Volatile var storageHealApplied: Boolean = false
    private set

  /** 取走并清除自愈标记（一次自愈只换一次重启）。 */
  fun consumeStorageHeal(): Boolean {
    val v = storageHealApplied
    storageHealApplied = false
    return v
  }

  /** 引擎事件桥标记文件（dsh-android-bridge 写入 home/.dsh/.task-done.ndjson；经 context 推导）。 */
  private fun taskMarkerFile(context: Context): java.io.File =
    java.io.File(File(context.filesDir, "home/.dsh"), ".task-done.ndjson")

  /** 消费任务完成标记：逐行解析 → NotifyCenter 通知 → 清空标记（幂等；通知权限未授静默降级）。 */
  private fun consumeTaskDoneMarkers(context: Context) {
    val debugLog = java.io.File(context.filesDir, "notify-debug.log")
    fun dbg(msg: String) {
      try {
        debugLog.appendText(System.currentTimeMillis().toString() + " " + msg + "\n")
        // 滚动截断：>1MB 保留尾部 500 行（2026-10-08 真机报告 B5：诊断日志无上限匀速增长）
        if (debugLog.length() > 1024L * 1024) {
          val lines = debugLog.readLines()
          debugLog.writeText(lines.takeLast(500).joinToString("\n") + "\n")
        }
      } catch (_: Exception) {}
    }
    try {
      val f = taskMarkerFile(context)
      if (!f.exists() || f.length() == 0L) return
      dbg("marker found, len=" + f.length())
      val lines = f.readLines()
      var notified = 0
      for (line in lines) {
        if (line.isBlank()) continue
        dbg("line: " + line)
        try {
          val j = org.json.JSONObject(line)
          val title = j.optString("title").ifBlank { "任务完成" }
          val snippet = j.optString("text").ifBlank { "引擎已完成一轮任务处理" }
          dbg("parsed title=" + title)
          NotifyCenter.notify(context, "task", title, snippet)
          notified++
          dbg("notify returned ok")
        } catch (e: Exception) {
          dbg("notify threw: " + (e.message ?: e.javaClass.simpleName))
        }
      }
      dbg("done notified=" + notified)
      f.writeText("")
    } catch (e: Exception) {
      dbg("consume outer threw: " + (e.message ?: e.javaClass.simpleName))
    }
  }

  /**
   * 轮转件补读（坑 79）：`engine.log` 被轮转后，致命签名可能整个留在 `engine.log.1` 里，
   * 增量游标从此再也看不见它。轮转发生的那一轮把旧件尾部取回来，**只喂给存储自愈**——
   * 不并入 logOk 判据，免得历史错误行把「循环重启」的老坑再制造一遍。
   */
  @Volatile
  private var pendingRotationTail: String? = null

  fun takeRotationTail(): String? {
    val v = pendingRotationTail
    pendingRotationTail = null
    return v
  }

  /** 引擎日志增量读取（2026-10 修复原 engineLogShowsFailure 的固定尾部扫描；坑 78 把它
   * 拆成「读」与「判」两步，判据之外还要给存储自愈认签名）。
   *
   * 只返回上次读取之后**新写入**的内容（上限尾部 64KB），文件变短（rotate/截断）时重置游标。
   * 旧实现固定扫尾部 4KB，历史错误行（UncaughtException / plugin tree failed to load）在日志
   * 安静期恒驻尾部 → 引擎明明健康也恒判失败 → 看门狗循环重启（「用久了老是重启」根因之二）。
   */
  private fun readEngineLogDelta(context: Context): String {
    return try {
      val f = java.io.File(context.filesDir, "engine.log")
      if (!f.exists()) {
        lastLogOffset = 0L
        return ""
      }
      val len = f.length()
      if (len < lastLogOffset) {
        lastLogOffset = 0L // rotate/截断：内容已换代
        pendingRotationTail = readTail(java.io.File(context.filesDir, "engine.log.1"))
      }
      val start = maxOf(lastLogOffset, len - 65_536)
      var tail = ""
      if (len > start) {
        tail = readTail(f)
      }
      lastLogOffset = len
      tail
    } catch (_: Exception) {
      ""
    }
  }

  /** 文件尾部 64KB（读不动就返回空串——自愈宁可不出手，也不误动数据）。 */
  private fun readTail(f: java.io.File): String {
    return try {
      if (!f.exists()) return ""
      val len = f.length()
      val start = maxOf(0L, len - 65_536)
      if (len <= start) return ""
      java.io.RandomAccessFile(f, "r").use { raf ->
        raf.seek(start)
        val buf = ByteArray((len - start).toInt())
        val n = raf.read(buf)
        String(buf, 0, n.coerceAtLeast(0), Charsets.UTF_8)
      }
    } catch (_: Exception) {
      ""
    }
  }

  /** 前台唤醒锁（标准档位；获取失败降级尽力模式并记录审计日志）。 */
  private var wakeLock: PowerManager.WakeLock? = null

  fun acquireWakeLock(context: Context) {
    if (wakeLock?.isHeld == true) return
    try {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dsh:engine").also {
        it.setReferenceCounted(false)
        it.acquire(30 * 60 * 1000L)
      }
      LogCollector.log(TAG, "wake lock acquired (30min standard)")
    } catch (t: Throwable) {
      Log.e(TAG, "wake lock acquire failed (degraded best-effort)", t)
      LogCollector.log(TAG, "wake lock FAILED: ${t.message}")
    }
  }

  /**
   * 唤醒锁续期（2026-08-23 修复：acquire(30min) 是一次性定时释放——引擎常驻超过 30 分钟
   * 后段无锁；releaseWakeLock 从未被调用，服务销毁时也漏释放）。watchdog tick 调用：
   * 持有即重设 30 分钟窗口（setReferenceCounted=false 下 acquire 幂等续窗）。
   */
  fun refreshWakeLock(context: Context) {
    try {
      val held = wakeLock?.isHeld == true
      if (held) {
        wakeLock?.acquire(30 * 60 * 1000L)
      } else {
        acquireWakeLock(context)
      }
    } catch (_: Throwable) {
    }
  }

  fun releaseWakeLock() {
    try {
      wakeLock?.let { if (it.isHeld) it.release() }
      wakeLock = null
    } catch (_: Throwable) {
    }
  }
}

/** 开机自启（零改动原则：仅恢复用户上次同意状态；白名单/厂商跳转引导由设置面承托）。 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
    val enabled = context.getSharedPreferences("dsh-engine", Context.MODE_PRIVATE).getBoolean("bootAllowsStart", true)
    if (!enabled) {
      LogCollector.log("dsh-watchdog", "boot completed; auto-start disabled by user preference")
      return
    }
    LogCollector.log("dsh-watchdog", "boot completed; starting engine service (user-consented state)")
    try {
      context.startForegroundService(Intent(context, EngineService::class.java))
    } catch (t: Throwable) {
      Log.e("dsh-watchdog", "boot start failed: " + t.message)
    }
  }
}

object BatteryWhitelist {
  /** 引导跳转忽略电池优化设置页（Android 6+）；写入由授权调试档（appops/deviceidle）完成，未授权时仅引导。 */
  fun isIgnoring(context: Context): Boolean {
    val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
    return if (Build.VERSION.SDK_INT >= 23) pm.isIgnoringBatteryOptimizations(context.packageName) else true
  }

  private const val ACTION = "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"

  fun requestIntent(context: Context): Intent? {
    return try {
      if (Build.VERSION.SDK_INT >= 23 && !isIgnoring(context)) {
        Intent(ACTION, android.net.Uri.parse("package:" + context.packageName))
      } else null
    } catch (_: Exception) {
      null
    }
  }
}
