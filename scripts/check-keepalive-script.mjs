// check-keepalive-script.mjs — 保活脚本一致性门禁（坑 48 同款纪律第三次奏效）：
// root-ops 插件内嵌 KEEPALIVE_SCRIPT 必须与 scripts/seagull-keepalive.sh（权威模板）
// 逐字节一致。两处任一改动漏改另一处即失败。
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(join(ROOT, 'plugins', 'dsh-android-root-ops', 'src', 'index.js'), 'utf8')
const ref = readFileSync(join(ROOT, 'scripts', 'seagull-keepalive.sh'), 'utf8')

const m = src.match(/const KEEPALIVE_SCRIPT = String\.raw`([\s\S]*?)`;/)
if (!m) { console.error('[check-keepalive-script] index.js 未找到 KEEPALIVE_SCRIPT 常量'); process.exit(1) }
if (m[1] === ref) { console.log('[check-keepalive-script] 一致 ✅'); process.exit(0) }
console.error('[check-keepalive-script] 不一致 ❌ 两文件字节级 diff：')
const a = m[1].split('\n'), b = ref.split('\n')
for (let i = 0; i < Math.max(a.length, b.length); i++) {
  if (a[i] !== b[i]) console.error(`L${i + 1}\n  plugin: ${JSON.stringify(a[i])}\n  script: ${JSON.stringify(b[i])}`)
}
process.exit(1)
