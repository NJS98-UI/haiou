#!/system/bin/sh
# =============================================================================
# Seagull DevStudio — 后台保活巡检（受控模板 / source of truth）
#
# 安装位置： /data/adb/service.d/seagull-keepalive.sh（KernelSU / Magisk boot service）
# 由 root-ops 插件 'keepalive_install' 工具落盘并立即启动；'keepalive_uninstall' 清除。
# 与 plugins/dsh-android-root-ops/src/index.js 内嵌 KEEPALIVE_SCRIPT 保持逐字节一致
# （pr-gate 的 check-keepalive-script.mjs 强制，坑 48 同款纪律）。
#
# 为什么需要它（app 内 watchdog 的盲区）：
#   watchdog 探活在 app 进程内——app 被 LMK / 厂商速冻 / 一键加速杀掉时，watchdog
#   陪葬，无人拉起。本脚本活在 app 进程之外（root shell 循环），是唯一能覆盖
#   「app 已死」场景的拉活者。
#
# 行为：
#   · 每 30s pidof 探测 app 主进程；
#   · 存活 → oom_score_adj 压到 -900（LMK 层免疫）+ cgroup 冻结状态探测日志
#     （收集 OriginOS 速冻形态数据，为后续解冻方案提供依据——纯读零风险）；
#   · 死亡 → am start 拉起（root shell 有权启动任意组件，绕开 Android 14
#     后台启动限制）；连续失败 3 次起指数退避（30→60→…→600s 封顶），
#     防崩溃循环时反复拉起与 UndoGate 打架；
#   · 事件写日志 /data/adb/seagull-keepalive.log（>100KB 截尾保留 200 行）。
# =============================================================================

PKG=com.dsharnessmobile.shell
ACTIVITY=com.dsharnessmobile.shell/.MainActivity
LOG=/data/adb/seagull-keepalive.log
BASE=30
MAX=600
FAILS=0
CUR=$BASE

log() {
  echo "$(date '+%m-%d %H:%M:%S') $*" >> "$LOG" 2>/dev/null
  SZ=$(wc -c < "$LOG" 2>/dev/null | tr -d ' ')
  [ "$SZ" -gt 102400 ] && tail -n 200 "$LOG" > "$LOG.t" 2>/dev/null && mv "$LOG.t" "$LOG"
}

# 单实例锁：发现除自身外的脚本实例即退出（防 service.d 开机实例与手动 install 叠加）
for P in $(pgrep -f seagull-keepalive.sh 2>/dev/null); do
  [ "$P" != "$$" ] && exit 0
done

log "keepalive start pid=$$"

while true; do
  PID=$(pidof "$PKG" 2>/dev/null)
  if [ -n "$PID" ]; then
    FAILS=0
    CUR=$BASE
    # pidof 可能返回多个 pid（空格分隔）——只压主进程（第一个）
    set -- $PID
    # oom_score_adj 压低（root 可写；-900 相当于 persistent 级，LMK 不会选中它）
    echo -900 > "/proc/$1/oom_score_adj" 2>/dev/null
    # 冻结探测（cgroup v1 freezer / v2 frozen；纯读，为 OriginOS 速冻对抗收集数据）
    CG=$(head -n 1 "/proc/$1/cgroup" 2>/dev/null)
    case "$CG" in
      *freezer*|*frozen*) log "FROZEN? $CG" ;;
    esac
  else
    FAILS=$((FAILS + 1))
    if [ "$FAILS" -gt 3 ]; then
      CUR=$((CUR * 2))
      [ "$CUR" -gt "$MAX" ] && CUR=$MAX
    fi
    log "dead (fails=$FAILS backoff=$CUR sec) -> am start"
    am start -n "$ACTIVITY" >/dev/null 2>&1 || log "am start failed rc=$?"
  fi
  sleep "$CUR"
done
