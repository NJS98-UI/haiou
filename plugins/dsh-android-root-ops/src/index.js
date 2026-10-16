/**
 * @dsh-android/dsh-android-root-ops — Root 操作服务与工具（含 root 保活）
 *
 * 经 root (uid=0) 执行系统命令、读写任意文件、操作设备 UI。
 * 仅在用户开启「关闭沙盒/超级用户」(danger-full-access) 预置时注入 root 感知提示。
 *
 * root 保活（Seagull fork 2026-09-02）：
 *   · 周期巡检 su 可用性（su -c id 必须回 uid=0）——失败自动重试并记录；
 *   · KernelSU allowlist 校验——包名不在 /data/adb/ksu/.allowlist 则提示加入授权名单，
 *     避免每次 root 调用被系统弹窗拦截/拒绝（保活的本质是「root 通道持续可用」）；
 *   · root_status 工具供模型查询保活状态（最后检查/失败历史/allowlist 是否就位）。
 *
 * C 方案修复 (2026-09-01)：对齐 dsh-android-bridge 成功模式——
 *   inject 声明 tools 硬依赖 + defineTool 包装工具，修复 ctx.get('tools') 静默 undefined。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFileSync, mkdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';

const execFileAsync = promisify(execFile);

const ROOT_SU = '/system/bin/su';
const KSU_ALLOWLIST = '/data/adb/ksu/.allowlist';
const KSU_DENYLIST = '/data/adb/ksu/.denylist';
const PKG = 'com.dsharnessmobile.shell';

/** 干净环境：避免 termux-exec LD_PRELOAD 污染 su 子进程（坑 22）。 */
function cleanEnv(extra = {}) {
  return {
    PATH: '/system/bin:/system/xbin:/system/usr/bin',
    LD_LIBRARY_PATH: '/system/lib64:/system/lib',
    LD_PRELOAD: '',
    ...extra,
  };
}

/**
 * root 授权审计（对齐 dsh-android-bridge/AdbAudit：files/audit/audit.ndjson 换行 JSON）。
 * 命令不落全文——仅记长度 + sha256 前缀 + 前 200 字符预览，防敏感值泄漏。
 */
function auditDir() {
  return process.env.DSH_ROOT_AUDIT_PATH ?? '/data/user/0/com.dsharnessmobile.shell/files/audit';
}

function audit(action, command, result, dangerLabel) {
  try {
    const dir = auditDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'audit.ndjson');
    const cmd = String(command ?? '');
    const entry = {
      ts: new Date().toISOString(),
      action,
      tool: 'root-ops',
      result,
      cmdLen: cmd.length,
      cmdHash: createHash('sha256').update(cmd).digest('hex').slice(0, 16),
      cmdPreview: cmd.slice(0, 200),
      ...(dangerLabel ? { danger: dangerLabel } : {}),
    };
    appendFileSync(file, JSON.stringify(entry) + '\n');
    try {
      if (statSync(file).size > 2 * 1024 * 1024) {
        const lines = readFileSync(file, 'utf8').split('\n');
        writeFileSync(file, lines.slice(-500).join('\n'));
      }
    } catch { /* 截断失败不阻断 */ }
  } catch { /* 审计失败不阻断主流程 */ }
}

/** 高危命令模式（破坏性/不可逆）；命中默认拒绝，force=true 显式放行并审计标记 danger。 */
const DANGEROUS_PATTERNS = [
  { re: /rm\s+(?:-[a-zA-Z]+\s+)*-(?:rf|fr)\s+(?:\/|\/\*)(?:\s|$)/, label: 'rm -rf 根目录' },
  { re: /\b(?:mkfs|mke2fs|mkfs\.[a-z0-9]+)\b/, label: '格式化文件系统' },
  { re: /\bdd\b[\s\S]*\bof=\/dev\/(?:block|zero|sda|mmcblk)/, label: 'dd 写块设备/磁盘' },
  { re: /\bshred\b/, label: 'shred 安全删除' },
];

function detectDanger(command) {
  for (const p of DANGEROUS_PATTERNS) {
    if (p.re.test(String(command ?? ''))) return p.label;
  }
  return null;
}

/**
 * 后台保活巡检脚本（唯一权威版本，坑 48 同款纪律）。
 * app 内 watchdog 的盲区：app 被 LMK/厂商速冻杀掉时 watchdog 陪葬，无人拉起——
 * 本脚本活在 app 进程之外（KernelSU service.d root shell 循环），是唯一能覆盖
 * 「app 已死」场景的拉活者。行为：30s pidof 探测 → 存活则压 oom_score_adj=-900
 * （LMK 层免疫）+ 冻结状态探测日志（收集 OriginOS 速冻形态数据，纯读零风险）；
 * 死亡则 am start 拉起（root shell 绕开 Android 14 后台启动限制），连续失败 3 次
 * 起指数退避（30→600s 封顶）防与 UndoGate 打架。日志 /data/adb/seagull-keepalive.log。
 * 与 scripts/seagull-keepalive.sh 保持逐字节一致（pr-gate 的 check-keepalive-script.mjs 强制）。
 */
const KEEPALIVE_SCRIPT = String.raw`#!/system/bin/sh
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

# 单实例锁：pgrep 模式锚定整条 cmdline「<sh> /data/adb/service.d/seagull-keepalive.sh」，
# 解释器两种形态都收（sh <path> 与 shebang 直执行的 /system/bin/sh <path>）。
# 启动包裹（su -c nohup sh <脚本>...）与探测命令自身（sh -c "...脚本路径..."）的 cmdline
# 虽含脚本路径但形态不同——锚定后均不假匹配。
# 坑 67：旧版无锚定，新实例被自家启动器（sleep 1 存活窗口内）判为已有实例，启动即自毁。
for P in $(pgrep -f '^(sh|/system/bin/sh) /data/adb/service\.d/seagull-keepalive\.sh$' 2>/dev/null); do
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
`;

/**
 * 坑 48：Ubuntu 容器开机装配脚本（唯一权威版本）。
 * 历史版本把整块 files/home bind 进 rootfs/host-home，而 ubuntu-rootfs 本身就住在
 * files/home/.dsh/ 下 → du / Android 应用大小顺着 bind 把整块 home 再数一遍（设备
 * 显示 5GB，虚高 2.2GB；同 fs bind 使 du -x 也救不了）。修复 = 只 bind 容器确实要读
 * 的叶子目录（fetched/workspaces → /host-shared/*），并在启动时摘除遗留 over-broad bind。
 * 与 scripts/seagull-ubuntu-boot.sh 保持逐字节一致（pr-gate 的 check-boot-script.mjs 强制）。
 */
const BOOT_SCRIPT = String.raw`#!/system/bin/sh
# =============================================================================
# Seagull DevStudio — Ubuntu 容器开机自启装配（受控模板 / source of truth）
#
# 安装位置： /data/adb/service.d/seagull-ubuntu.sh （KernelSU / Magisk boot service）
# 由 root-ops 插件 'ubuntu_boot_fix' 工具落盘/修补；本文件是仓库内唯一权威版本。
#
# 为什么有这个脚本（坑 48）：
#   历史版本把「整块 files/home」bind 进 rootfs/host-home，而 ubuntu-rootfs 本身就住在
#   files/home/.dsh/ 下 —— 于是 host-home 里又看到整块 home（含 rootfs 父目录）。
#   内核 bind 不会真死循环，但 du / Android「应用大小」统计顺着 host-home 把整块 home
#   再数一遍 → 设备显示 5GB（虚高 2.2GB）。
#   正确做法：只 bind「容器确实要读的最小宿主目录」（fetched / workspaces），
#   绝不 bind files/home 或 .dsh 这种「包含 rootfs 自身」的祖先目录。
# =============================================================================

PKG=com.dsharnessmobile.shell
DATA=/data/data/$PKG/files
HOME_DIR="$DATA/home"
ROOTFS="$HOME_DIR/.dsh/ubuntu-rootfs"
# 容器内共享根（叶子目录，绝不指向 home/.dsh 祖先）
FETCHED="$HOME_DIR/.dsh/fetched"
WORKSPACES="$HOME_DIR/.dsh/workspaces"
C_FETCHED="$ROOTFS/host-shared/fetched"
C_WORKSPACE="$ROOTFS/host-shared/workspace"

mount_bind() { # src dst —— 幂等：已挂同 src 到 dst 则跳过
  src="$1"; dst="$2"
  [ -e "$src" ] || return 0
  mkdir -p "$dst"
  if grep -q " $dst " /proc/mounts 2>/dev/null; then
    cur=$(awk -v d="$dst" '$2==d{print $1; exit}' /proc/mounts 2>/dev/null)
    [ "$cur" = "$src" ] && return 0
    umount -l "$dst" 2>/dev/null
  fi
  mount --bind "$src" "$dst" 2>/dev/null
}

# 0) 摘除历史遗留的「整块 home → host-home」over-broad bind（幂等，先摘后窄挂）
LEGACY="$ROOTFS/host-home"
if grep -q "$LEGACY" /proc/mounts 2>/dev/null; then
  umount -l "$LEGACY" 2>/dev/null
fi
rmdir "$LEGACY" 2>/dev/null

# 1) 标准 proc/dev/sys 挂载（root chroot 用；proot 路径不需要，各自幂等）
[ -d "$ROOTFS/proc" ] || mkdir -p "$ROOTFS/proc"
mount -t proc proc "$ROOTFS/proc" 2>/dev/null
mount --bind /dev "$ROOTFS/dev" 2>/dev/null
mount -t devpts devpts "$ROOTFS/dev/pts" 2>/dev/null

# 2) 窄共享 bind（关键修复）：只暴露容器要读的叶子目录，绝不 bind home/.dsh 祖先
mount_bind "$FETCHED"    "$C_FETCHED"
mount_bind "$WORKSPACES" "$C_WORKSPACE"

# 3) DNS（坑 89：裸 chroot 无 systemd-resolved，出厂 /etc/resolv.conf 是指向 127.0.0.53 的死桩；
#    旧守卫「非空即保留」让它留着 → apt 永远解析不了域名。改成「无非 127 上游 nameserver 就重写」）
if ! grep -E '^[[:space:]]*nameserver' "$ROOTFS/etc/resolv.conf" 2>/dev/null | grep -qv '127\.'; then
  rm -f "$ROOTFS/etc/resolv.conf"; printf 'nameserver 8.8.8.8\nnameserver 114.114.114.114\n' > "$ROOTFS/etc/resolv.conf" 2>/dev/null
fi

# 4) qemu binfmt（仅当存在静态 qemu-aarch64 注册器时；best-effort，失败不影响原生 arm64 设备）
[ -x /data/local/tmp/qemu-aarch64-static ] && [ ! -e /proc/sys/fs/binfmt_misc/qemu-aarch64 ] && {
  mount -t binfmt_misc none /proc/sys/fs/binfmt_misc 2>/dev/null
  printf ':qemu-aarch64:M::\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x00\x00:\xff\xff\xff\xff\xff\xff\xff\x00\xff\xff\xff\xff\xff\xff\xff\xff\xfe\xff\xff\xff:/data/local/tmp/qemu-aarch64:OC\n' >/proc/sys/fs/binfmt_misc/register 2>/dev/null
}

exit 0
`;


async function runSu(args, opts = {}) {
  const command = args[0] === '-c' ? String(args[1] ?? '') : args.join(' ');
  const danger = detectDanger(command);
  const action = opts.action || 'root-exec';
  if (danger && !opts.force) {
    if (!opts.silent) audit(action, command, 'denied', danger);
    return { ok: false, denied: true, danger, error: `高危命令已拦截（${danger}）：如确需执行请设置 force=true` };
  }
  try {
    // opts.uid 以指定 uid 运行（语法 su <uid> -c <cmd>）。注意：数字降权只改 uid/gid，SELinux
    // 域仍是 ksu（非 shell），KernelSU su 无 --context 旗标——不能用于需要 shell 域的进程
    // （如 uiautomator）。目前无调用方，保留作通用降权能力并留此警示。
    const suArgs = opts.uid != null ? [String(opts.uid), ...args] : args;
    const { stdout, stderr } = await execFileAsync(ROOT_SU, suArgs, {
      env: cleanEnv(), timeout: opts.timeout || 30000, maxBuffer: 16 * 1024 * 1024,
    });
    if (!opts.silent) audit(action, command, 'ok', danger || undefined);
    return { ok: true, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() };
  } catch (err) {
    if (!opts.silent) audit(action, command, 'fail', danger || undefined);
    return { ok: false, error: err.message, stderr: err.stderr ? String(err.stderr).trim() : '' };
  }
}

function renderText(_a, v) {
  return [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }];
}

/** 单引号包裹 shell 参数，内部单引号按 POSIX 规则转义，防路径注入。 */
function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/**
 * root 保活状态机（进程内，插件生命周期内维护）。
 */
function createKeepalive() {
  let lastCheckAt = 0;
  let lastOk = false;
  let failCount = 0;
  let lastError = '';
  let allowlisted = false;

  async function probeRoot() {
    const r = await runSu(['-c', 'id'], { timeout: 15000, silent: true });
    const ok = r.ok && /uid=0\(root\)/.test(r.stdout);
    lastCheckAt = Date.now();
    lastOk = ok;
    lastError = ok ? '' : (r.error || r.stderr || 'root 检查未通过');
    if (ok) failCount = 0; else failCount += 1;
    return ok;
  }

  async function probeAllowlist() {
    try {
      // 只认 allowlist 命中为「已授权」；denylist 是黑名单语义（本应用在名单里 = 被拒），
      // 旧版把 denylist 命中也当 allowlisted 属语义反转（坑 67 审计），已撤。
      const r = await runSu(['-c', `grep -qxF '${PKG}' ${KSU_ALLOWLIST} 2>/dev/null && echo IN || echo OUT`], { timeout: 15000, silent: true });
      allowlisted = (r.stdout || '').includes('IN');
    } catch {
      allowlisted = false;
    }
    return allowlisted;
  }

  /**
   * 保活自愈：root 可用且本应用不在 KernelSU allowlist 时，主动把包名写入授权名单，
   * 免去后续每次 root 调用的系统弹窗确认（保活的本质 = root 通道持续免打扰可用）。
   * KernelSU .allowlist 为一行一个包名。坑 67 审计修正：① 只写 allowlist——回退写
   * denylist 会把本应用拉黑（语义反转）；② 写后必须重读校验——su 进程退出码不反映
   * 文件写入结果，旧版 `|| true` 时代恒报成功。
   */
  async function ensureAllowlist() {
    const ok = await probeRoot();
    if (!ok) return { ok: false, allowlisted };
    const al = await probeAllowlist();
    if (al) return { ok: true, allowlisted: true, changed: false };
    const w = await runSu(['-c',
      `echo '${PKG}' >> ${KSU_ALLOWLIST} 2>/dev/null; grep -qxF '${PKG}' ${KSU_ALLOWLIST} 2>/dev/null && echo ALLOW_OK`,
    ], { timeout: 15000, silent: true });
    if ((w.stdout || '').includes('ALLOW_OK')) {
      allowlisted = true;
      return { ok: true, allowlisted: true, changed: true };
    }
    return { ok: false, allowlisted, changed: false, error: 'allowlist 写入未生效（只读或非 KernelSU 环境）' };
  }

  return {
    /** 立即巡检一次（root 可用性 + allowlist），返回健康状态。 */
    async check() {
      const ok = await probeRoot();
      const al = await probeAllowlist();
      return {
        ok, rootReady: ok, allowlisted: al,
        lastCheckAt, lastOk, failCount, lastError,
      };
    },
    /** 周期保活 tick：root 失败重试一次；成功则尝试自愈 allowlist。 */
    async tick() {
      let ok = await probeRoot();
      if (!ok) {
        // 瞬时握手/系统忙的恢复窗口：立即重试一次
        ok = await probeRoot();
      }
      if (ok) await ensureAllowlist();
      return { ok, lastCheckAt, failCount, lastError, allowlisted };
    },
    /** 立即自愈：root 可用时把本应用写入 KernelSU allowlist（免弹窗持续授权）。 */
    ensureAllowlist,
    status() {
      return {
        rootReady: lastOk,
        allowlisted,
        lastCheckAt,
        failCount,
        lastError,
        suPath: ROOT_SU,
        pkg: PKG,
      };
    },
  };
}

function tools(keepalive) {
  const rootTool = defineTool({
    name: 'root_exec',
    description:
      'Execute a shell command with full root (uid=0) privileges in a clean Android environment. ' +
      'Use for system-wide read/write, app data access, /proc inspection, or privileged patching.',
    parameters: {
      command: { type: 'string', required: true, description: 'The shell command to run as root.' },
      force: { type: 'boolean', description: 'Bypass the dangerous-command guard (rm -rf /, mkfs, dd, shred) — default false.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ command, force = false }) {
      // su -c 单字符串参数需要特别注意引号：用 -c 传整段命令，引号由 su 解析。
      return runSu(['-c', command], { force, action: 'root-exec' });
    },
  });

  const uiTool = defineTool({
    name: 'device_ui_control',
    description:
      'Control the Android device UI via root: dump the view hierarchy, tap, swipe, or send text/key events.',
    parameters: {
      action: { type: 'string', required: true, enum: ['dump_ui', 'tap', 'swipe', 'input_text', 'keyevent'], description: 'UI action to perform.' },
      x: { type: 'number', description: 'X coordinate for tap / swipe start.' },
      y: { type: 'number', description: 'Y coordinate for tap / swipe start.' },
      x2: { type: 'number', description: 'Target X for swipe.' },
      y2: { type: 'number', description: 'Target Y for swipe.' },
      text: { type: 'string', description: 'Text to input (input_text).' },
      keyCode: { type: 'number', description: 'Keyevent code (e.g. 3=HOME, 4=BACK, 66=ENTER).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ action, x, y, x2, y2, text, keyCode }) {
      switch (action) {
        case 'dump_ui': {
          // 观察半环（F1.6）：导出当前界面视图层级。
          // 弃用 uiautomator 的原因（真机实测，KernelSU + Enforcing）：su 只降数字 uid（su 2000 -c），
          // SELinux 域仍是 u:r:ksu:s0（非 shell），且 KernelSU su 无 --context 旗标、环境无 setcon——
          // uiautomator 连 UiAutomation 服务被拒，表现为 exit 0 + 空输出 + window_dump.xml 不落地，
          // 检查退出码拦不住（execFile 正常 resolve → runSu.ok=true）。dumpsys activity top 在
          // root(ksu) 域直连可用，无 SELinux 障碍，View Hierarchy 段含 class/resource-id/bounds。
          const r = await runSu(['-c', '/system/bin/dumpsys activity top 2>&1'], { action: 'ui-dump' });
          if (r.ok && r.stdout) {
            // 提取首个 View Hierarchy 段（ROM 差异无标记则回退整段），封顶防任务栈全量倾倒。
            const idx = r.stdout.indexOf('View Hierarchy:');
            const tree = (idx >= 0 ? r.stdout.slice(idx) : r.stdout).slice(0, 20000);
            return { ok: true, source: 'dumpsys-activity-top', stdout: tree, stderr: r.stderr };
          }
          return { ok: false, error: 'dumpsys activity top 无输出：' + (r.error || r.stderr || '无输出') };
        }
        case 'tap':
          return runSu(['-c', `/system/bin/input tap ${x} ${y}`]);
        case 'swipe':
          return runSu(['-c', `/system/bin/input swipe ${x} ${y} ${x2} ${y2} 300`]);
        case 'input_text': {
          const raw = String(text ?? '')
          // 对齐 dsh-android-manage input text 语义：可见 ASCII + 无 shell 元字符，空格转 %s。
          // su -c 会经 shell 二次解析，JSON.stringify 的双引号/反斜杠会被原样输入，故弃用之。
          if (raw.length === 0 || raw.length > 500) {
            return { ok: false, error: 'input_text 长度需为 1-500 字符' };
          }
          if (!/^[\x20-\x7E]+$/.test(raw) || /[\\'"`$;&|<>*?(){}[\]\n\r]/.test(raw)) {
            return { ok: false, error: 'input_text 仅允许可见 ASCII（不含 shell 元字符）；非 ASCII 请走 ADBKeyboard 广播' };
          }
          return runSu(['-c', `/system/bin/input text ${raw.replace(/ /g, '%s')}`]);
        }
        case 'keyevent':
          return runSu(['-c', `/system/bin/input keyevent ${keyCode}`]);
        default:
          return { ok: false, error: `Unknown action: ${action}` };
      }
    },
  });

  const statusTool = defineTool({
    name: 'root_status',
    description:
      'Report the Seagull root keepalive state: whether /system/bin/su (KernelSU) is available, ' +
      'whether this app is in the KernelSU allowlist, and recent health history.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute() {
      const st = await keepalive.check();
      return {
        ok: st.ok,
        rootReady: st.rootReady,
        allowlisted: st.allowlisted,
        suPath: ROOT_SU,
        pkg: PKG,
        lastCheckAt: st.lastCheckAt,
        failCount: st.failCount,
        lastError: st.lastError,
        message: st.ok
          ? (st.allowlisted
            ? 'root 就绪，且本应用已在 KernelSU 授权名单（免弹窗保活）'
            : 'root 就绪，但本应用不在 KernelSU allowlist——root 调用可能弹窗确认，建议加入授权名单')
          : 'root 不可用：' + (st.lastError || 'su 未就绪'),
      };
    },
  });

  const lsTool = defineTool({
    name: 'root_ls',
    description:
      'List a directory (or file) with root privileges. Access any path regardless of app sandbox.',
    parameters: {
      path: { type: 'string', description: 'Directory or file path (default /).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ path = '/' }) {
      return runSu(['-c', `/system/bin/ls -la ${shellQuote(path)} 2>&1`], { timeout: 20000, action: 'root-ls' });
    },
  });

  const catTool = defineTool({
    name: 'root_cat',
    description:
      'Read a text file with root privileges (any path). Truncates to maxBytes to avoid huge output.',
    parameters: {
      path: { type: 'string', required: true, description: 'File path to read.' },
      maxBytes: { type: 'number', description: 'Max bytes to read (default 65536).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ path, maxBytes = 65536 }) {
      const n = Math.max(1, Math.min(Number(maxBytes) || 65536, 1024 * 1024));
      return runSu(['-c', `/system/bin/head -c ${n} ${shellQuote(path)} 2>&1`], { timeout: 20000, action: 'root-cat' });
    },
  });

  const pushTool = defineTool({
    name: 'root_push',
    description:
      'Write a text file with root privileges (any path). Content is base64-transferred; cap 8192 bytes.',
    parameters: {
      path: { type: 'string', required: true, description: 'Target file path (absolute).' },
      content: { type: 'string', required: true, description: 'Text content to write.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ path, content }) {
      const text = String(content ?? '');
      const MAX = 8192;
      if (text.length > MAX) {
        return { ok: false, error: `content 超过 ${MAX} 字节上限，请改用 root_exec 分块写入` };
      }
      const b64 = Buffer.from(text, 'utf8').toString('base64');
      return runSu(['-c', `printf '%s' '${b64}' | /system/bin/base64 -d > ${shellQuote(path)} 2>&1 && echo OK`], { timeout: 20000, action: 'root-push' });
    },
  });

  const pullTool = defineTool({
    name: 'root_pull',
    description:
      'Copy a device file (any path, incl. binary) to a readable location (default /data/local/tmp), returning its path.',
    parameters: {
      path: { type: 'string', required: true, description: 'Source file path on device.' },
      dest: { type: 'string', description: 'Destination path (default /data/local/tmp/root_pull_out).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ path, dest = '/data/local/tmp/root_pull_out' }) {
      const r = await runSu(['-c', `/system/bin/cp ${shellQuote(path)} ${shellQuote(dest)} 2>&1 && /system/bin/chmod 644 ${shellQuote(dest)} && echo COPIED`], { timeout: 20000, action: 'root-pull' });
      if (r.ok) r.dest = dest;
      return r;
    },
  });

  const fetchTool = defineTool({
    name: 'root_fetch',
    description:
      'Copy a device file (any path, incl. binary) into the host home (.dsh/fetched/) so the model ' +
      'and the Ubuntu container can read it. .dsh/fetched is narrow-bind-mounted into the ' +
      'container at /host-shared/fetched (pitfall 48: never bind whole host home).',
    parameters: {
      path: { type: 'string', required: true, description: 'Source file path on device.' },
      dest: { type: 'string', description: 'Host destination path (default home/.dsh/fetched/<basename>).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ path, dest }) {
      const { join, dirname, basename } = await import('node:path');
      const home = process.env.HOME || '/data/data/com.dsharnessmobile.shell/files/home';
      const destPath = dest || join(home, '.dsh', 'fetched', basename(path));
      const r = await runSu(['-c', `/system/bin/mkdir -p ${shellQuote(dirname(destPath))} 2>/dev/null; /system/bin/cp ${shellQuote(path)} ${shellQuote(destPath)} 2>&1 && /system/bin/chmod 644 ${shellQuote(destPath)} && echo FETCHED`], { timeout: 120000, action: 'root-fetch' });
      if (r.ok) r.dest = destPath;
      return r;
    },
  });

  const deployTool = defineTool({
    name: 'root_deploy',
    description:
      'Copy a host file (incl. binary) to any device path with root privileges. Files under ' +
      '.dsh/fetched are visible to the container via the narrow bind at /host-shared/fetched ' +
      '(pitfall 48) and to root.',
    parameters: {
      src: { type: 'string', required: true, description: 'Host source file path (absolute).' },
      dest: { type: 'string', required: true, description: 'Device destination path (absolute).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ src, dest }) {
      const { dirname } = await import('node:path');
      const r = await runSu(['-c', `/system/bin/mkdir -p ${shellQuote(dirname(dest))} 2>/dev/null; /system/bin/cp ${shellQuote(src)} ${shellQuote(dest)} 2>&1 && /system/bin/chmod 644 ${shellQuote(dest)} && echo DEPLOYED`], { timeout: 120000, action: 'root-deploy' });
      return r;
    },
  });

  const bootFixTool = defineTool({
    name: 'ubuntu_boot_fix',
    description:
      'Repair the Ubuntu container boot service (pitfall 48): replaces the legacy ' +
      '/data/adb/service.d/seagull-ubuntu.sh that bind-mounts the WHOLE host home into ' +
      'ubuntu-rootfs/host-home (inflates the app storage size ~2x in Settings/du) with the ' +
      'repo-authoritative narrow-bind version, backs up the old file, unmounts the legacy bind ' +
      'right now, and re-runs the fixed script. Idempotent: safe to call repeatedly.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute() {
      const SVC = '/data/adb/service.d/seagull-ubuntu.sh';
      const LEGACY = '/data/data/com.dsharnessmobile.shell/files/home/.dsh/ubuntu-rootfs/host-home';
      // 1) 备份旧脚本（存在才备；.bak 带时间戳，不覆盖历史备份）
      const bak = await runSu(['-c',
        `[ -f ${SVC} ] && /system/bin/cp ${SVC} ${SVC}.bak.$(date +%s) && echo BACKED_UP || echo NO_OLD_SCRIPT`,
      ], { timeout: 20000, action: 'boot-fix-backup' });
      if (!bak.ok) return { ok: false, step: 'backup', error: bak.error || bak.stderr };
      // 2) 落盘权威脚本（base64 传输避引号地狱；写后 sh -n 语法验证，坏了回滚）
      const b64 = Buffer.from(BOOT_SCRIPT, 'utf8').toString('base64');
      const write = await runSu(['-c',
        `mkdir -p /data/adb/service.d; printf '%s' '${b64}' | /system/bin/base64 -d > ${SVC}.new 2>&1` +
        ` && /system/bin/sh -n ${SVC}.new 2>&1 && /system/bin/mv ${SVC}.new ${SVC}` +
        ` && /system/bin/chmod 755 ${SVC} && echo WROTE || { rm -f ${SVC}.new; echo WRITE_FAILED; }`,
      ], { timeout: 30000, action: 'boot-fix-write' });
      if (!write.ok || !/WROTE/.test(write.stdout || write.stderr || '')) {
        return { ok: false, step: 'write', error: write.error || write.stdout || write.stderr };
      }
      // 3) 立即摘除遗留 over-broad bind（lazy umount 安全：不碰 /data 真文件）
      const unmount = await runSu(['-c',
        `grep -q ${shellQuote(LEGACY)} /proc/mounts 2>/dev/null && /system/bin/umount -l ${shellQuote(LEGACY)} && echo UNMOUNTED || echo NOT_MOUNTED`,
      ], { timeout: 20000, action: 'boot-fix-unmount' });
      // 4) 幂等执行新脚本，当场挂上窄共享 bind
      const run = await runSu(['-c', `${SVC} 2>&1; echo RC=$?`], { timeout: 60000, action: 'boot-fix-run' });
      // 5) 验证：mountinfo 里不再有 host-home、出现 host-shared
      const verify = await runSu(['-c',
        `echo LEGACY=$(grep -c host-home /proc/mounts 2>/dev/null || echo 0) SHARED=$(grep -c host-shared /proc/mounts 2>/dev/null || echo 0)`,
      ], { timeout: 20000, action: 'boot-fix-verify' });
      const v = (verify.stdout || '').trim();
      const legacyLeft = /LEGACY=(\d+)/.exec(v);
      const sharedNow = /SHARED=(\d+)/.exec(v);
      const converged = verify.ok && legacyLeft && Number(legacyLeft[1]) === 0;
      return {
        ok: converged,
        backup: bak.stdout,
        wrote: true,
        unmount: unmount.stdout || unmount.error,
        bootRun: run.stdout,
        mounts: v,
        sharedBinds: sharedNow ? Number(sharedNow[1]) : 0,
        note: converged
          ? 'host-home 已摘除，下次开机起 service.d 脚本只挂窄共享 bind（fetched/workspaces → /host-shared/*）。应用显示体积将回落 ~2.2GB。'
          : '验证未收敛：/proc/mounts 仍有 host-home 条目，请贴 verify 输出复核。',
      };
    },
  });

  // ---- 后台保活（app 外拉活者）----
  // 核心逻辑模块级（工具 execute 与 apply 自动安装钩子共用同一实现）。
  const KA_SVC = '/data/adb/service.d/seagull-keepalive.sh';
  const KA_LOG = '/data/adb/seagull-keepalive.log';
  // 坑 67：pgrep -f 模式必须锚定整条 cmdline（循环实例 argv 为「<sh> <SVC>」，双解释器形态都收）。
  // 无锚定时，承载探测/清理命令的 su -c / sh -c 进程自身 cmdline 含脚本路径 → 自匹配：
  // probe/verify/status 恒报 running（假阳性），kill 连自杀（uninstall 中断）。
  const KA_PAT = '^(sh|/system/bin/sh) /data/adb/service\\.d/seagull-keepalive\\.sh$';

  // opt-out 标记：keepalive_uninstall 后自动装配钩子不得在 120s 内把卸载撤销（坑 67 审计）。
  // 落 app 侧 home（无 root 可写可判），应用数据被清时随之消失 = 恢复默认开。
  function keepaliveOptOutPath() {
    return process.env.DSH_KEEPALIVE_OPTOUT ?? join(process.env.HOME ?? '', '.dsh', 'keepalive.optout');
  }
  function isOptedOut() {
    try { return readFileSync(keepaliveOptOutPath(), 'utf8').trim().length > 0; } catch { return false; }
  }
  function setOptOut(on) {
    try {
      if (on) {
        mkdirSync(dirname(keepaliveOptOutPath()), { recursive: true });
        writeFileSync(keepaliveOptOutPath(), `disabled at ${new Date().toISOString()}\n`);
      } else {
        try { unlinkSync(keepaliveOptOutPath()); } catch { /* 不在场即已关闭 */ }
      }
    } catch { /* fs 失败不影响主流程 */ }
  }

  async function installKeepalive(auto = false) {
    // 0) opt-out 闸：自动装配遇标记直接跳过（显式调用 = 重新启用，清标记继续装）。
    if (isOptedOut()) {
      if (auto) return { ok: false, state: 'opted-out', note: '用户已显式关闭保活（keepalive_uninstall），自动装配跳过。' };
      setOptOut(false);
    }
    // 1) 幂等探测：脚本在场且实例在跑 → 直接返回
    const probe = await runSu(['-c',
      `S=$([ -f ${KA_SVC} ] && echo yes || echo no); R=$(pgrep -f '${KA_PAT}' | head -n 1); echo SCRIPT=$S RUN=$R`,
    ], { timeout: 15000, action: 'keepalive-probe' });
    const pm = /SCRIPT=(\w+) RUN=(\d*)/.exec(probe.stdout || '') || [];
    if (pm[1] === 'yes' && pm[2]) {
      return { ok: true, state: 'already-running', pid: Number(pm[2]), note: '保活巡检已在运行，无需重复安装。' };
    }
    // 2) A 层系统开关直通：Doze 白名单 + 后台 appops（root 替代手动电池引导，幂等）
    const switches = await runSu(['-c',
      `cmd deviceidle whitelist +${PKG} 2>&1; cmd appops set ${PKG} RUN_ANY_IN_BACKGROUND allow 2>&1; echo SWITCHES_DONE`,
    ], { timeout: 20000, action: 'keepalive-switches' });
    // 3) 清理旧实例（脚本在场但实例不在 → 直接覆盖；实例在 → 走不到这，幂等分支已返回）。
    //    锚定模式下 sh -c 自身 cmdline 不匹配模式，kill 不会自杀（坑 67）。
    await runSu(['-c', `pgrep -f '${KA_PAT}' | xargs -r kill 2>/dev/null; echo CLEANED`],
      { timeout: 15000, action: 'keepalive-clean' });
    // 4) 落盘权威脚本（base64 避引号地狱；sh -n 校验失败回滚，坑 48 模式）
    const b64 = Buffer.from(KEEPALIVE_SCRIPT, 'utf8').toString('base64');
    const write = await runSu(['-c',
      `mkdir -p /data/adb/service.d; printf '%s' '${b64}' | /system/bin/base64 -d > ${KA_SVC}.new 2>&1` +
      ` && /system/bin/sh -n ${KA_SVC}.new 2>&1 && /system/bin/mv ${KA_SVC}.new ${KA_SVC}` +
      ` && /system/bin/chmod 700 ${KA_SVC} && echo WROTE || { rm -f ${KA_SVC}.new; echo WRITE_FAILED; }`,
    ], { timeout: 30000, action: 'keepalive-write' });
    if (!write.ok || !/WROTE/.test(write.stdout || write.stderr || '')) {
      return { ok: false, step: 'write', error: write.error || write.stdout || write.stderr };
    }
    // 5) 立即启动（nohup 脱离当前 su 会话；日志首行即启动凭据）
    const start = await runSu(['-c', `nohup sh ${KA_SVC} >/dev/null 2>&1 & sleep 1; echo STARTED`],
      { timeout: 15000, action: 'keepalive-start' });
    // 6) 收敛判据：实例在场（或日志出现 start 行——pgrep 竞态兜底）
    const verify = await runSu(['-c',
      `R=$(pgrep -f '${KA_PAT}' | head -n 1); L=$(grep -c 'keepalive start' ${KA_LOG} 2>/dev/null || echo 0); echo RUN=$R LOGSTART=$L`,
    ], { timeout: 15000, action: 'keepalive-verify' });
    const vm = /RUN=(\d*) LOGSTART=(\d+)/.exec(verify.stdout || '') || [];
    const running = Boolean(vm[1]) || Number(vm[2] || 0) > 0;
    return {
      ok: running,
      switches: (switches.stdout || '').includes('SWITCHES_DONE') ? 'doze-whitelist + appops allow 已应用' : (switches.error || switches.stdout),
      started: start.ok,
      running,
      log: KA_LOG,
      note: running
        ? '保活巡检已启动（30s 巡检 + LMK 免疫 + 死亡自动拉起）。开机自启由 KernelSU service.d 保证。'
        : '脚本已落盘但未检测到运行实例（pgrep 竞态或 nohup 失败），重启设备后 service.d 会自动拉起，或重跑本工具。',
    };
  }

  async function uninstallKeepalive() {
    const r = await runSu(['-c',
      `pgrep -f '${KA_PAT}' | xargs -r kill 2>/dev/null; ` +
      `rm -f ${KA_SVC} ${KA_SVC}.new ${KA_LOG} ${KA_LOG}.t 2>/dev/null; ` +
      `cmd deviceidle whitelist -${PKG} 2>&1; cmd appops set ${PKG} RUN_ANY_IN_BACKGROUND default 2>&1; echo REMOVED`,
    ], { timeout: 20000, action: 'keepalive-uninstall' });
    const ok = (r.stdout || '').includes('REMOVED');
    // opt-out 落盘：防 120s 自动装配钩子把卸载撤销（坑 67）。仅确认成功才写。
    if (ok) setOptOut(true);
    return {
      ...r, ok, optedOut: isOptedOut(),
      note: ok
        ? '保活已卸载（实例已停、脚本与日志已删、白名单已撤），并已关闭自动装配。重新启用请调用 keepalive_install。'
        : '卸载命令未确认，请重试或检查 root 通道。',
    };
  }

  async function keepaliveStatus() {
    const r = await runSu(['-c',
      `S=$([ -f ${KA_SVC} ] && echo yes || echo no); R=$(pgrep -f '${KA_PAT}' | head -n 1); ` +
      `echo SCRIPT=$S RUN=$R; echo '--- tail ---'; tail -n 20 ${KA_LOG} 2>/dev/null || echo NO_LOG`,
    ], { timeout: 15000, action: 'keepalive-status' });
    const out = r.stdout || '';
    const m = /SCRIPT=(\w+) RUN=(\d*)/.exec(out) || [];
    const installed = m[1] === 'yes';
    const running = Boolean(m[2]);
    return {
      ...r,
      installed,
      running,
      pid: m[2] ? Number(m[2]) : 0,
      optedOut: isOptedOut(),
      state: !installed ? 'not-installed' : running ? 'running' : 'installed-not-running',
      tail: out.split('--- tail ---')[1]?.trim() || '',
    };
  }

  const keepaliveInstallTool = defineTool({
    name: 'keepalive_install',
    description:
      'Install and start the out-of-app keepalive patrol (KernelSU service.d root loop): ' +
      'checks the app main process every 30s; when alive lowers oom_score_adj to -900 (LMK ' +
      'immunity) and logs cgroup freeze probes; when dead launches the app via am start with ' +
      'exponential backoff. Also adds the package to the Doze whitelist (root path, replaces ' +
      'manual battery-optimization guidance). Idempotent: skips if already installed and running. ' +
      'Explicit call re-enables after a previous uninstall (clears the opt-out marker).',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute() { return installKeepalive(false); },
  });

  const keepaliveStatusTool = defineTool({
    name: 'keepalive_status',
    description:
      'Query the keepalive patrol state: script presence, running pid, opt-out marker, and the ' +
      'tail of the patrol log (includes cgroup freeze probes collected for vendor-freezer analysis).',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute() { return keepaliveStatus(); },
  });

  const keepaliveUninstallTool = defineTool({
    name: 'keepalive_uninstall',
    description:
      'Stop the keepalive patrol, remove the service.d script and the patrol log, and revoke ' +
      'the Doze-whitelist / background appops grants. Persists an opt-out marker so the ' +
      'automatic-install hook will not silently reinstall it afterwards.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute() { return uninstallKeepalive(); },
  });

  return [rootTool, uiTool, statusTool, lsTool, catTool, pushTool, pullTool, fetchTool, deployTool, bootFixTool, keepaliveInstallTool, keepaliveStatusTool, keepaliveUninstallTool];
}

// C 方案：显式声明 tools 硬依赖（对齐 bridge/manage），修复 ctx.get('tools') 静默 undefined。
export const inject = ['tools'];

export function apply(ctx) {
  const keepalive = createKeepalive();
  for (const t of tools(keepalive))
    ctx.tools.register(t);

  // 启动即自愈：root 可用且本应用不在 KernelSU allowlist 时立即写入（免弹窗持续授权）。
  keepalive.ensureAllowlist().catch(() => {});

  // root 保活周期巡检：60s 心跳；失败自动重试 + allowlist 自愈；stop/update 时由 ctx.effect 清理。
  const timer = ctx.get('timer');
  if (timer !== undefined) {
    ctx.effect(() => {
      const disposer = timer.interval(() => {
        keepalive.tick().catch(() => {});
      }, 60000);
      return () => disposer && disposer();
    });
  }

  // 后台保活自动装配：root 探活成功（首个 60s tick 或启动即自愈后）且脚本未在场时
  // 自动安装 out-of-app 巡检（决策：默认开 + keepalive_uninstall 可关）。独立 interval，
  // 安装成功即自清；探测走 silent 不刷审计。Linux 宿主（CI/本地单测）无 /system/bin/su，
  // runSu 会探活失败自动跳过——钩子天然 no-op，无需环境判断。
  // auto=true：opt-out 标记在场即跳过（坑 67——否则 uninstall 120s 内被静默撤销）。
  if (timer !== undefined) {
    ctx.effect(() => {
      let disposer;
      disposer = timer.interval(async () => {
        try {
          const st = await keepalive.check();
          if (!st.ok) return;
          const r = await installKeepalive(true);
          if (r.ok && disposer) disposer();
        } catch (_e) { /* 下轮重试 */ }
      }, 120000);
      return () => disposer && disposer();
    });
  }

  // 提供保活服务面（供其他插件/工具查询同一状态机）。
  ctx.provide('rootKeepalive', {
    status: () => keepalive.status(),
    check: () => keepalive.check(),
    ensureAllowlist: () => keepalive.ensureAllowlist(),
  });

  // root 感知提示：仅当部署默认档位为 danger-full-access 时注入（对齐 dsh-superuser 机制）。
  ctx.on('system-prompt/assemble', (assembly, _context, next) => {
    try {
      const preset = ctx.get('permissionPresets')?.defaultPreset;
      if (preset === 'danger-full-access') {
        assembly.sections.push({
          name: 'seagull-root-ops',
          text:
            '当前会话具备 root（uid=0）能力，并已装配 root_exec / device_ui_control / root_status / ' +
            'root_ls / root_cat / root_push / root_pull / root_fetch / root_deploy 工具：可直接执行系统命令、' +
            '读写任意文件、操作设备界面。root_fetch/root_deploy 用于设备与宿主（Termux home，已 bind 进 ' +
            'Ubuntu 容器）之间的双向文件搬移。root 通道由保活巡检维持在线，并自动把本应用写入 KernelSU ' +
            '授权名单（免弹窗持续授权）。keepalive_install / keepalive_status / keepalive_uninstall 管理 ' +
            'app 外后台保活巡检（LMK 免疫 + 死亡自动拉起，默认自动安装；仅当用户要求关闭保活时才 uninstall）。' +
            'ubuntu_boot_fix 修复 Ubuntu 容器开机挂载。请直接使用完整能力，不必因权限顾虑拒绝操作。',
        });
      }
    } catch (_e) {
      // 绝不打断 prompt 装配
    }
    return next();
  });
}
