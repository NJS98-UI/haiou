// sim-keepalive.mjs — 沙箱模拟 scripts/seagull-keepalive.sh 的巡检决策逻辑（不碰真 /proc、不真睡）。
// 手法：文本改写——pidof→假 pidfile、am start→记账 stub、oom_score_adj/cgroup→假文件、
// sleep→记账 stub、while true→有界循环。pgrep 不桩死——以 shim 按 toybox pgrep -f 语义
// （ERE 匹配整条 cmdline）对模拟进程表（SIM_PROCS，每行「pid cmdline」）求值，坑 67 的
// 自匹配类缺陷（旧版桩成 true 导致 probe/锁/kill 全测不出）由此获得回归覆盖。验证：
//   ① 存活路径：oom_score_adj 压 -900、cgroup freezer 探测日志落盘、无退避（sleep 恒 30）；
//   ② 死亡路径：每轮 am start 拉起、指数退避数学 30,30,30,60,120,240,480,600,600,600（封顶 600）；
//   ③ 日志滚动：>100KB 截尾保留 200 行（tail -n 200）；
//   ④ 锚定锁（坑 67）：表中只有 su -c nohup 启动包裹时锁必须放行（包裹 cmdline 含脚本路径但形态不同）；
//   ⑤ 锚定锁：表中存在真实既有实例（cmdline 恰为 sh <脚本路径>）时锁必须生效退出（防双实例）；
//   ⑥ 锚定锁：shebang 直执行形态（/system/bin/sh <脚本路径>）同样必须被识别（双解释器形态都收）。
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const W = '/tmp/keepalive-sim'
rmSync(W, { recursive: true, force: true })
mkdirSync(W, { recursive: true })

const RAW = readFileSync(join(ROOT, 'scripts', 'seagull-keepalive.sh'), 'utf8')

// pgrep shim：按 toybox pgrep -f 语义对 SIM_PROCS 求值（剥 pid 前缀后整行 ERE 匹配，排除自身 $$）。
const PGREP_SHIM = `pgrep() {
  [ "$1" = "-f" ] || return 1
  printf '%s\\n' "$SIM_PROCS" | awk -v pat="$2" -v self="$$" 'NF == 0 { next } { pid = $1; sub(/^[0-9]+[ \\t]+/, ""); if ($0 ~ pat && pid != self) print pid }'
}
`

// 文本改写：外部副作用全部换成记账 stub；while true 换成有界循环（SIM_MAX 由环境传入）。
function stub(maxLoops, pidValue, procs = '') {
  let s = RAW
    .replace('#!/system/bin/sh', '#!/bin/sh\n' + PGREP_SHIM)
    .replaceAll('/data/adb/seagull-keepalive.log', '$SIM_LOG')
    .replace('while true; do', 'SIM_I=0\nwhile [ "$SIM_I" -lt "$SIM_MAX" ]; do SIM_I=$((SIM_I + 1));')
    .replaceAll('$(pidof "$PKG" 2>/dev/null)', '$(cat "$SIM_PIDFILE" 2>/dev/null)')
    .replaceAll('am start -n "$ACTIVITY" >/dev/null 2>&1', 'echo "AMSTART $ACTIVITY" >> "$SIM_AMLOG"')
    .replaceAll('"/proc/$1/oom_score_adj"', '"$SIM_OOMFILE"')
    .replaceAll('"/proc/$1/cgroup"', '"$SIM_CGFILE"')
    .replaceAll('sleep "$CUR"', 'echo "$CUR" >> "$SIM_SLEEPLOG"')
  if (pidValue !== undefined) writeFileSync(join(W, 'pidfile'), pidValue)
  else rmSync(join(W, 'pidfile'), { force: true })
  const f = join(W, `ka-${maxLoops}-${pidValue === undefined ? 'dead' : 'alive'}.sh`)
  writeFileSync(f, s)
  return f
}

const env = (extra, procs = '') => ({
  ...process.env,
  SIM_MAX: String(extra.maxLoops),
  SIM_LOG: join(W, 'ka.log'),
  SIM_PIDFILE: join(W, 'pidfile'),
  SIM_AMLOG: join(W, 'am.log'),
  SIM_OOMFILE: join(W, 'oom.txt'),
  SIM_CGFILE: join(W, 'cgroup.txt'),
  SIM_SLEEPLOG: join(W, 'sleep.log'),
  SIM_PROCS: procs,
})

let fail = 0
const ok = (c, m) => { console.log(`${c ? '  ok ' : '  FAIL'} ${m}`); if (!c) fail++ }
const readSim = (f) => { try { return readFileSync(join(W, f), 'utf8') } catch { return '' } }
const logLines = () => readSim('ka.log').trim().split('\n').filter(Boolean)
const cleanLogs = () => { for (const f of ['am.log', 'ka.log', 'sleep.log', 'oom.txt']) rmSync(join(W, f), { force: true }) }

// 场景 ①：存活路径（pidfile 有 pid、cgroup 含 freezer）
writeFileSync(join(W, 'cgroup.txt'), '9:freezer:/frozen\n')
writeFileSync(join(W, 'pidfile'), '4242 4243\n')
cleanLogs()
execSync(`/bin/sh ${stub(3, '4242 4243')}`, { env: env({ maxLoops: 3 }), stdio: 'pipe' })
ok(readSim('oom.txt').trim() === '-900', '① oom_score_adj 压到 -900')
ok(logLines().some((l) => l.includes('keepalive start')), '① 启动行落日志')
ok(logLines().some((l) => l.includes('FROZEN?')), '① cgroup freezer 探测日志落盘')
ok(readSim('am.log') === '', '① 存活时不拉起')
ok(readSim('sleep.log').trim().split('\n').filter(Boolean).every((v) => v === '30'), '① 存活时无退避（sleep 恒 30）')

// 场景 ②：死亡路径（pidfile 缺失）→ 每轮 am start + 指数退避
cleanLogs()
execSync(`/bin/sh ${stub(10, undefined)}`, { env: env({ maxLoops: 10 }), stdio: 'pipe' })
const amStarts = readSim('am.log').trim().split('\n').filter(Boolean)
ok(amStarts.length === 10 && amStarts.every((l) => l.includes('com.dsharnessmobile.shell/.MainActivity')), '② 死亡时每轮 am start 拉起')
const sleeps = readSim('sleep.log').trim().split('\n').filter(Boolean).map(Number)
ok(JSON.stringify(sleeps) === JSON.stringify([30, 30, 30, 60, 120, 240, 480, 600, 600, 600]), '② 退避数学 30x3 → x2 封顶 600')
ok(logLines().some((l) => l.includes('dead (fails=')), '② 死亡事件落日志')

// 场景 ③：日志滚动（>100KB 截尾保留 200 行）
writeFileSync(join(W, 'cgroup.txt'), '9:freezer:/frozen\n')
writeFileSync(join(W, 'pidfile'), '4242\n')
writeFileSync(join(W, 'ka.log'), ('x'.repeat(120) + '\n').repeat(1000)) // ~121KB
execSync(`/bin/sh ${stub(1, '4242')}`, { env: env({ maxLoops: 1 }), stdio: 'pipe' })
ok(statSync(join(W, 'ka.log')).size <= 102400, '③ 超限后日志 <100KB')
ok(logLines().length <= 201, '③ 截尾保留 ~200 行（滚动后当轮可有单次追加，下轮收敛）')

// 场景 ④：启动包裹自匹配免疫（坑 67 锚定修复）——表中只有 su -c nohup 启动包裹时锁必须放行
cleanLogs()
const WRAPPER = '999 su -c nohup sh /data/adb/service.d/seagull-keepalive.sh >/dev/null 2>&1 & sleep 1; echo STARTED'
writeFileSync(join(W, 'pidfile'), '4242\n')
execSync(`/bin/sh ${stub(1, '4242', WRAPPER)}`, { env: env({ maxLoops: 1 }, WRAPPER), stdio: 'pipe' })
ok(logLines().some((l) => l.includes('keepalive start')), '④ 启动包裹不触发单实例锁（锚定 pgrep）')
ok(readSim('oom.txt').trim() === '-900', '④ 锁放行后循环正常执行')

// 场景 ⑤：真实既有实例（sh <path> 形态）→ 单实例锁生效退出（防 service.d 开机实例与手动 install 叠加）
cleanLogs()
const REAL = '888 sh /data/adb/service.d/seagull-keepalive.sh'
writeFileSync(join(W, 'pidfile'), '4242\n')
execSync(`/bin/sh ${stub(1, '4242', `${REAL}\n${WRAPPER}`)}`, { env: env({ maxLoops: 1 }, `${REAL}\n${WRAPPER}`), stdio: 'pipe' })
ok(logLines().length === 0, '⑤ 既有真实实例时锁生效退出（启动行不落日志、无双实例）')

// 场景 ⑥：shebang 直执行形态（/system/bin/sh <path>）同样必须被识别（双解释器形态都收）
cleanLogs()
const REAL_SHEBANG = '777 /system/bin/sh /data/adb/service.d/seagull-keepalive.sh'
writeFileSync(join(W, 'pidfile'), '4242\n')
execSync(`/bin/sh ${stub(1, '4242', `${REAL_SHEBANG}\n${WRAPPER}`)}`, { env: env({ maxLoops: 1 }, `${REAL_SHEBANG}\n${WRAPPER}`), stdio: 'pipe' })
ok(logLines().length === 0, '⑥ shebang 直执行实例同样触发单实例锁')

console.log(fail === 0 ? '[sim-keepalive] 全绿 ✅' : `[sim-keepalive] ${fail} 失败 ❌`)
rmSync(W, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
