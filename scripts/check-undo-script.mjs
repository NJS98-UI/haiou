// check-undo-script.mjs — undo 急救 CLI 副本一致性门禁（坑 68，check-keepalive-script 同款纪律）：
// scripts/dsh-undo-emergency.mjs（仓库模板）必须与 app/src/main/assets/undo-emergency.mjs
// （UndoGate 实际执行的运行版）逐字节一致。历史教训：P1 修复只改了 assets 侧，
// scripts/ 模板落后 56 行，两侧无门禁即漂移。
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const tpl = readFileSync(join(ROOT, 'scripts', 'dsh-undo-emergency.mjs'), 'utf8')
const run = readFileSync(join(ROOT, 'app', 'src', 'main', 'assets', 'undo-emergency.mjs'), 'utf8')

if (tpl === run) { console.log('[check-undo-script] 一致 ✅'); process.exit(0) }
console.error('[check-undo-script] 不一致 ❌ scripts/dsh-undo-emergency.mjs 与 app/src/main/assets/undo-emergency.mjs 字节级 diff：')
const a = tpl.split('\n'), b = run.split('\n')
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) console.error(`L${i + 1}\n  template: ${JSON.stringify(a[i])}\n  runtime:  ${JSON.stringify(b[i])}`)
}
process.exit(1)
