package com.dsharnessmobile.shell

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Foreground service owning the embedded engine lifecycle: keeps the app
 * process alive while backgrounded (user-visible notification) and restarts
 * the engine process when it dies (watchdog). M2 keep-alive, no root needed.
 */
class EngineService : Service() {

  private lateinit var engineManager: EngineManager
  private var watchdog: ScheduledExecutorService? = null

  /** 坑 79 升级处置在跑（重建是分钟级）：挡住下一轮 tick 再次出手。 */
  @Volatile
  private var repairRunning = false

  @Volatile
  private var repairStartedAt = 0L

  /**
   * 处置是否「仍在有效进行中」。**必须带上时限**：重建解压没有超时，线程万一卡死，
   * repairRunning 就永久为真，看门狗会永远走「让路」分支而不重启引擎——
   * 瘫痪的自愈等于没有自愈（同坑 78 的 half-open 教训）。超过 20 分钟不再让路。
   */
  private val repairActive: Boolean
    get() = repairRunning && System.currentTimeMillis() - repairStartedAt < REPAIR_MAX_MS

  override fun onCreate() {
    super.onCreate()
    // C1: reuse the process-level pick token (auth survives watchdog engine restarts, never blank-allow).
    engineManager = EngineManager(this, EngineManager.ensurePickToken())
    instance = this
    startForeground(NOTIFICATION_ID, buildNotification())
    // Dev log toggle on: persistent collection (logcat + engine.log → dshdata/log/, daily).
    if (MainActivity.DevLogPrefs.isEnabled(this)) LogCollector.start(this)
    // 坑 81：服务侧也要注册 OTG 广播——设置页可能从未打开过，引擎环境的 DSH_USB_* 仍要跟着插拔更新。
    UsbState.ensureReceiver(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!userShutdown) ensureEngine() else { watchdog?.shutdownNow(); watchdog = null }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  /** 任务移除（生命周期礼仪 F5.3）：允许进程结束，尽力清理本次文件直达临时会话/工作区，
   *  不启动任何隐藏复活（不反弹）；后台阶段保活不受影响（见 F2 主题）。 */
  override fun onTaskRemoved(rootIntent: Intent?) {
    try {
      FileIncoming.cleanupTmp(this)
      LogCollector.log("dsh-file-open", "onTaskRemoved: temp cleanup done (no resurrection)")
    } catch (_: Exception) {
    }
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    watchdog?.shutdownNow()
    watchdog = null
    WatchdogV2.releaseWakeLock()
    if (instance === this) instance = null
    // Log collection stops when the service exits (in-process idempotent singleton; also stopped when the toggle is off).
    LogCollector.stop()
    super.onDestroy()
  }

  /** User-requested shutdown: stop the watchdog + engine (no auto-restart). */
  fun requestShutdown() {
    userShutdown = true
    watchdog?.shutdownNow()
    watchdog = null
    try { engineManager.stopEngine() } catch (_: Exception) {
    }
  }

  /**
   * Start the engine if not running, then arm the watchdog. v2 (PRD F2-4):
   * the watchdog is installed in EVERY state — the previous early return for a
   * running engine left no watcher, so a later process death went unnoticed
   * until the user interacted. The tick also feeds the update-v2 confirmation/
   * rollback state machine (PRD F3.2/F1.10).
   */
  private fun ensureEngine() {
    if (!engineManager.engineReady) return
    if (watchdog == null) {
      WatchdogV2.acquireWakeLock(this)
      watchdog = Executors.newSingleThreadScheduledExecutor().also { exec ->
        exec.scheduleWithFixedDelay({
          // 深度探活（PRD F2-5）：HTTP + 插件端点 + 引擎日志异常；熔断退避（F2-6/7）。
          if (WatchdogV2.tripped()) {
            // 熔断：暂停重启尝试（界面提示由 GuideChrome 状态区显示）；用户交互复位。
            LogCollector.log("dsh-watchdog", "watchdog tripped: consecutive failure burst; paused")
            return@scheduleWithFixedDelay
          }
          val healthy = WatchdogV2.deepProbe(this)
          if (repairActive) {
            // 升级处置阶梯正在驱动引擎生命周期（重启/运行环境重建是分钟级）：这一轮不记账、
            // 不重启、不回撤——否则看门狗会在树解到一半时把引擎拉起来（半棵树冷启），
            // 或让 UndoGate 把「重建期间连不上」当成崩溃去回滚刚让位的旧树。
            WatchdogV2.refreshWakeLock(this)
            return@scheduleWithFixedDelay
          }
          engineManager.onEngineProbe(healthy)
          WatchdogV2.recordProbe(healthy)
          // 坑 78：存储单元自愈改了磁盘（隔离坏单元 / 改写版本号），必须重启引擎才生效——
          // 此刻 HTTP 探活是健康的，看门狗自己不会重启，所以显式要一次重启（一次自愈一次重启）。
          if (WatchdogV2.consumeStorageHeal() && engineManager.engineReady) {
            LogCollector.log("dsh-watchdog", "storage unit healed; restarting engine to reload registry")
            engineManager.resetCooldown()
            engineManager.startEngine()
          }
          // 坑 79：HTTP 健康但插件树内部失活（工作区/会话控制器全挂 pending）——用户侧就是
          // 「没有临时工作区 + 发消息没回复」。累计到阈值交给升级处置阶梯（重启→运行环境重建→
          // 引擎数据让位），处置可能耗时分钟级，另起线程并挡住重入。
          if (healthy && WatchdogV2.internalHealthy) EngineRepair.noteHealthy(this)
          if (WatchdogV2.consumeInternalUnhealthy() && engineManager.engineReady && !repairRunning) {
            repairRunning = true
            repairStartedAt = System.currentTimeMillis()
            Thread {
              try {
                val action = EngineRepair.advance(this@EngineService, engineManager)
                LogCollector.log("dsh-watchdog", "internal-unhealthy escalation action: " + (action ?: "none (budget exhausted)"))
              } catch (e: Throwable) {
                LogCollector.log("dsh-watchdog", "escalation thread died: " + (e.message ?: e.javaClass.simpleName))
              } finally {
                repairRunning = false
                // 处置期间引擎必然连不上（重建分钟级），那是自己制造的失败，不该让熔断
                // 把看门狗停摆掉——重建完的引擎正等着下一轮探活确认。
                WatchdogV2.reset()
              }
            }.apply { isDaemon = true; name = "dsh-engine-repair"; start() }
          }
          // 唤醒锁续期：engine 常驻超过 30min 后半段无锁（acquire 定时释放）
          WatchdogV2.refreshWakeLock(this)
          if (!healthy && engineManager.engineReady) {
            // 抖动保护（2026-10）：单次探活失败（HTTP 瞬时超时/日志增量误命中）不杀引擎；
            // 连续 >=2 次失败（10s）才触发壳侧重启。startEngine 内部另有冷启动保护与崩溃限速。
            if (WatchdogV2.consecutiveFailures < 2) {
              LogCollector.log("dsh-watchdog", "probe failed once (#" + WatchdogV2.consecutiveFailures + "); waiting before restart")
              return@scheduleWithFixedDelay
            }
            engineManager.startEngine()
            // F3 自动回撤（D6 方案 a）：看门狗连续失败达到阈值（熔断前）时，
            // 触发急救 CLI 恢复最后良好快照；UndoGate 幂等 + 防循环。
            if (UndoGate.onProbeFailure(this, WatchdogV2.consecutiveFailures)) {
              LogCollector.log("dsh-watchdog", "auto-undo trigger: cons_fail=" + WatchdogV2.consecutiveFailures)
              Thread {
                // S5（2026-10 结构性修复）：daemon 线程顶层 try/catch 兜底，避免未捕获异常静默杀死线程
                try {
                  val result = UndoGate.execute(this, engineManager)
                  if (result.executed) {
                    LogCollector.log("dsh-watchdog", "auto-undo ok -> " + (result.snapshotId ?: "?"))
                    engineManager.resetCooldown()
                    engineManager.startEngine()
                  } else {
                    LogCollector.log("dsh-watchdog", "auto-undo not executed: " + result.summary.take(160))
                  }
                } catch (e: Exception) {
                  LogCollector.log("dsh-watchdog", "auto-undo thread died: " + (e.message ?: e.javaClass.simpleName))
                }
              }.start()
            }
            LogCollector.log("dsh-watchdog", "restart attempt after failure #" + WatchdogV2.consecutiveFailures + " (backoff: " + WatchdogV2.nextDelayMs() + "ms advisory)")
          }
        }, 5, 5, TimeUnit.SECONDS)
      }
    }
  }

  private fun buildNotification(): android.app.Notification {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(NotificationChannel("engine", "Seagull 引擎", NotificationManager.IMPORTANCE_LOW))
    }
    val pending = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java),
      PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, "engine")
      .setSmallIcon(android.R.drawable.stat_notify_chat)
      .setContentTitle("Seagull 引擎运行中")
      .setContentText("Seagull DevStudio 正在后台工作")
      .setContentIntent(pending)
      .setOngoing(true)
      .build()
  }

  companion object {
    private const val NOTIFICATION_ID = 2

    /** 升级处置的让路上限（坑 79）：超过它视为处置线程卡死，看门狗恢复正常调度。 */
    private const val REPAIR_MAX_MS = 20L * 60 * 1000
    /** User-requested shutdown flag: after shutdown the watchdog/onStartCommand no longer raises the engine; the user must start it manually. */
    @Volatile
    var userShutdown = false
    /** Currently running service instance (MainActivity's "Shut down" stops the watchdog via requestShutdown). */
    @Volatile
    var instance: EngineService? = null
  }
}
