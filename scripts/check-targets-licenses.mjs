// check-targets-licenses.mjs — 快照装配清单与许可矩阵的静态对账闸（坑 77）
//
// 背景：`scripts/build-snapshot-013.mjs` 的 TARGETS 一旦加包，`usr/var/lib/dpkg/status`
// 就多出条目；而 `check-third-party.mjs` 要求每个已装包都在
// `scripts/third-party-licenses.json` 有登记，缺即拒打包。问题是那道闸要读归档内
// dpkg status（Windows 侧经 wsl.exe 的 `tar -xOf`），本机没有 WSL 发行版时根本跑不动
// （坑 77 实锤：TARGETS 补 'jq' 后本地 gradle 全绿，云端 build-apk 三连红）。
// 本闸把「加包必登记许可」这条不变量改成纯静态、跨平台、零依赖的检查，接进 pr-gate，
// 让它在装配之前就能红。
//
// 检查面（两件，都是静态可判定的）：
//  ① TARGETS 每个显式条目都在矩阵 `packages` 里有许可登记（缺失即失败）；
//  ② 其中 copyleft（GPL/LGPL 族）条目所需的仓库标准文本 `matrix.licenseTexts[fam]` 在
//     工作区存在（A2 源；新增 GPL 包却忘了往 LICENSES/ 放全文，也在这一层拦住）。
// 依赖闭包 BFS 自动带出的传递包（如 oniguruma）不在本闸覆盖面——那是装配期才生成的
// 清单，仍由 `check-third-party.mjs --tar` 在 CI 兜底；本闸只保证「人手写进 TARGETS 的
// 那一批」不会裸奔。
//
// 用法：node scripts/check-targets-licenses.mjs
//   [--snapshot-script <path>] [--licenses <path>] [--licenses-dir <path>]
// 退出 0=通过；非 0=拒绝（CI 步骤与 build-apk-013.ps1 门禁接入）。
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const SNAPSHOT_SCRIPT = arg('--snapshot-script', 'scripts/build-snapshot-013.mjs')
const LICENSES_JSON = arg('--licenses', 'scripts/third-party-licenses.json')
const LICENSES_DIR = arg('--licenses-dir', 'LICENSES')

/**
 * 从快照装配脚本里取显式 TARGETS 清单。
 * 形状漂移（改名、换引号、多行数组）一律硬失败而不是静默返回空集——空集会伪装成「全通过」。
 * @param {string} src build-snapshot-013.mjs 全文。
 * @returns {string[]} TARGETS 包名。
 */
export function readTargets(src) {
  const line = /^const TARGETS = \[(.*)\]$/m.exec(src)
  if (!line) throw new Error(`TARGETS 锚点漂移：在 ${SNAPSHOT_SCRIPT} 里找不到单行 \`const TARGETS = [...]\``)
  const names = [...line[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  if (!names.length) throw new Error(`TARGETS 解析为空（${SNAPSHOT_SCRIPT}）`)
  return names
}

const failures = []
let targets
let matrix
try {
  targets = readTargets(readFileSync(SNAPSHOT_SCRIPT, 'utf8'))
  matrix = JSON.parse(readFileSync(LICENSES_JSON, 'utf8'))
} catch (e) {
  console.error(`TARGETS/许可矩阵读取失败: ${e.message}`)
  process.exit(1)
}

// 族→标准文本的判定口径与 check-third-party.mjs 第 A2 段保持一致（含 '+` 族按前缀匹配），
// 两处若漂移就会出现「本地过、CI 拒」或反之。
const TEXT_FAMILIES = ['GPL-2.0+', 'GPL-3.0+', 'LGPL-2.1+', 'LGPL-3.0+']
const neededTexts = new Set()
for (const pkg of targets) {
  const license = matrix.packages[pkg]
  if (!license) {
    failures.push(`矩阵缺条目: ${pkg}（TARGETS 加包要同批登记 scripts/third-party-licenses.json）`)
    continue
  }
  if (matrix.copyleftFamilies.some((f) => license.includes(f))) {
    for (const fam of TEXT_FAMILIES) {
      if (!license.includes(fam.split('+')[0])) continue
      const rel = matrix.licenseTexts[fam]
      if (!rel) {
        failures.push(`${pkg}@${license}: 族 ${fam} 在 matrix.licenseTexts 无映射`)
        continue
      }
      neededTexts.add(rel)
    }
  }
}
for (const rel of neededTexts) {
  const target = LICENSES_DIR === 'LICENSES' ? rel : join(LICENSES_DIR, rel.replace(/^LICENSES\//, ''))
  if (!existsSync(target)) failures.push(`copyleft 标准文本缺失: ${target}`)
}

if (failures.length) {
  console.error(`TARGETS-LICENSES CHECK FAILED（${failures.length}）`)
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`targets-licenses ok: ${targets.length} 显式 TARGETS 全部登记（需标准文本 ${neededTexts.size} 份在场）`)
