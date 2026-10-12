// sim-keepalive.mjs — 沙箱模拟 scripts/seagull-keepalive.sh 的巡检决策逻辑（不碰真 /proc、不真睡）。
// 手法：文本改写——pidof→假 pidfile、am start→记账 stub、oom_score_adj/cgroup→假文件、
// sleep→记账 stub、while true→有界循环。验证：
//   ① 存活路径：oom_score_adj 压 -900、cgroup freezer 探测日志落盘、无退避（sleep 恒 30）；
//   ② 死亡路径：每轮 am start 拉起、指数退避数学 30,30,30,60,120,240,480,600,600,600（封顶 600）；
//   ③ 日志滚动：>100KB 截尾保留 200 行（tail -n 200）。
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const W = '/tmp/keepalive-sim'
rmSync(W, { recursive: true, force: true })
mkdirSync(W, { recursive: true })

const RAW = readFileSync(join(ROOT, 'scripts', 'seagull-keepalive.sh'), 'utf8')

// 文本改写：外部副作用全部换成记账 stub；while true 换成有界循环（SIM_MAX 由环境传入）。
function stub(maxLoops, pidValue) {
  let s = RAW
    .replace('#!/system/bin/sh', '#!/bin/sh')
    .replaceAll('/data/adb/seagull-keepalive.log', '$SIM_LOG')
    .replace('while true; do', 'SIM_I=0\nwhile [ "$SIM_I" -lt "$SIM_MAX" ]; do SIM_I=$((SIM_I + 1));')
    .replaceAll('$(pidof "$PKG" 2>/dev/null)', '$(cat "$SIM_PIDFILE" 2>/dev/null)')
    .replaceAll('$(pgrep -f seagull-keepalive.sh 2>/dev/null)', '$(true)')
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

const env = (extra) => ({
  ...process.env,
  SIM_MAX: String(extra.maxLoops),
  SIM_LOG: join(W, 'ka.log'),
  SIM_PIDFILE: join(W, 'pidfile'),
  SIM_AMLOG: join(W, 'am.log'),
  SIM_OOMFILE: join(W, 'oom.txt'),
  SIM_CGFILE: join(W, 'cgroup.txt'),
  SIM_SLEEPLOG: join(W, 'sleep.log'),
})

let fail = 0
const ok = (c, m) => { console.log(`${c ? '  ok ' : '  FAIL'} ${m}`); if (!c) fail++ }
const readSim = (f) => { try { return readFileSync(join(W, f), 'utf8') } catch { return '' } }
const logLines = () => readSim('ka.log').trim().split('\n').filter(Boolean)

// 场景 ①：存活路径（pidfile 有 pid、cgroup 含 freezer）
writeFileSync(join(W, 'cgroup.txt'), '9:freezer:/frozen\n')
writeFileSync(join(W, 'pidfile'), '4242 4243\n')
rmSync(join(W, 'am.log'), { force: true }); rmSync(join(W, 'ka.log'), { force: true }); rmSync(join(W, 'sleep.log'), { force: true })
execSync(`/bin/sh ${stub(3, '4242 4243')}`, { env: env({ maxLoops: 3 }), stdio: 'pipe' })
ok(readSim('oom.txt').trim() === '-900', '① oom_score_adj 压到 -900')
ok(logLines().some((l) => l.includes('keepalive start')), '① 启动行落日志')
ok(logLines().some((l) => l.includes('FROZEN?')), '① cgroup freezer 探测日志落盘')
ok(readSim('am.log') === '', '① 存活时不拉起')
ok(readSim('sleep.log').trim().split('\n').filter(Boolean).every((v) => v === '30'), '① 存活时无退避（sleep 恒 30）')

// 场景 ②：死亡路径（pidfile 缺失）→ 每轮 am start + 指数退避
rmSync(join(W, 'am.log'), { force: true }); rmSync(join(W, 'ka.log'), { force: true }); rmSync(join(W, 'sleep.log'), { force: true })
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

console.log(fail === 0 ? '[sim-keepalive] 全绿 ✅' : `[sim-keepalive] ${fail} 失败 ❌`)
rmSync(W, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
