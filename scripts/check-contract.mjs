// check-contract.mjs — adapter-layer contract point check (core M1.4 adapter chain check).
// Consumes scripts/contract.json; any broken point → non-zero exit + report. Usage: node scripts/check-contract.mjs
import { readFileSync, existsSync, readdirSync, statSync, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const contract = JSON.parse(readFileSync(join(root, 'scripts/contract.json'), 'utf8'))
const issues = []
const ok = (msg) => console.log('  OK  ' + msg)
const fail = (msg) => { issues.push(msg); console.log('  FAIL ' + msg) }

function dtsFiles(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...dtsFiles(p))
    else if (p.endsWith('.d.ts')) out.push(p)
  }
  return out
}

console.log('== 1. bundle 行引用 ==')
// 自包含 CI 无协调库（dsh/）在场：缺场 SKIP（warn），在场严格校验（2026-10 第三轮复盘
// 接线 pr-gate 时发现——原实现在自包含仓库恒 FAIL 9 项，门禁要么恒红要么被绕过）。
const upstreamInPlace = existsSync(join(root, contract.upstreamRepo))
for (const row of contract.rows) {
  const patchFile = join(root, contract.upstreamRepo, 'packages/bundle', row.bundle, 'cordis.patch.yml')
  if (!upstreamInPlace) { console.log('  SKIP 行 ' + row.id + '（协调库 ' + contract.upstreamRepo + ' 不在场）'); continue }
  if (!existsSync(patchFile)) { fail('bundle patch 缺失: ' + patchFile); continue }
  const text = readFileSync(patchFile, 'utf8')
  const hit = text.split('\n').find(l => l.trim() === '- id: ' + row.id)
  if (hit === undefined) fail('行 ' + row.id + ' 在上游 ' + row.bundle + ' bundle 中不存在（patch 静默失效风险）')
  else ok('行 ' + row.id + ' @ ' + row.bundle + ' 存在')
}

console.log('== 2. 插入行包存在（仓库 + 构建产物） ==')
for (const ins of contract.inserted) {
  const repo = join(root, ins.repo)
  if (!existsSync(join(repo, 'package.json'))) fail('仓库缺失: ' + ins.repo)
  else ok('仓库 ' + ins.repo + ' 存在')
  const built = existsSync(join(repo, 'lib/index.js')) || existsSync(join(repo, 'lib/client.js'))
  // lib/ 未构建在 CI 静态门禁里仅 warn：构建产物由 build-apk 的 requires 段强制（缺即拒打包），
  // 此处只守仓库存在性，避免 pr-gate 恒红（2026-10 第三轮复盘接线调整）。
  if (!built) console.log('  WARN ' + ins.repo + ' lib/ 未构建（build-apk 门禁负责强制构建）')
  else ok(ins.repo + ' lib/ 已构建')
}

console.log('== 3. 继承符号（基线 node_modules 类型面） ==')
const baseline = join(root, contract.symbols[0].repo, 'node_modules/@deepseek-ai')
// 基线 node_modules 不在场（未 npm install / 自包含 CI 不装插件依赖）→ 整节 SKIP；
// 在场则逐符号严格校验（2026-10 第三轮复盘接线调整）。
if (!existsSync(baseline)) {
  console.log('  SKIP 基线 node_modules 不在场（' + contract.symbols[0].repo + ' 未 npm install）')
} else {
  for (const sym of contract.symbols) {
    const typesDir = join(baseline, sym.pkg, 'lib/types')
    if (!existsSync(typesDir)) { fail('基线缺失 ' + sym.pkg + '/lib/types（先 npm install）'); continue }
    const found = dtsFiles(typesDir).some(f => readFileSync(f, 'utf8').includes(sym.symbol))
    if (found) ok(sym.pkg + ': ' + sym.symbol)
    else fail(sym.pkg + ': 符号 ' + sym.symbol + ' 不在基线类型面（继承面断裂）')
  }
}

console.log('== 4. 客户端槽位声明 ==')
const slotText = readFileSync(join(root, contract.clientSlots.repo, 'src/client/index.ts'), 'utf8')
for (const slot of contract.clientSlots.slots) {
  if (slotText.includes("'" + slot + "'")) ok('槽位 ' + slot + ' 已声明')
  else fail('槽位 ' + slot + ' 未声明')
}

console.log('== 5. 环境契约键 ==')
const envText = readFileSync(join(root, contract.envContract.repo, 'src/index.ts'), 'utf8')
for (const key of contract.envContract.keys) {
  if (envText.includes(key)) ok('环境键 ' + key + ' 注入')
  else fail('环境键 ' + key + ' 未注入')
}

console.log('== 6. 版本钉（package.json vs contract.json） ==')
// baselineExceptions is a per-package escape hatch for upstream packages that do
// not republish on every engine train; keep it empty when a repo baseline covers
// everything, so a stale pin fails loudly instead of being silently excused.
// repoBaselines overrides baseline/cordis per inserted repo: the browser-side
// plugin tracks the engine's client line (0.1.7-rc.2 / cordis 4.0.4, the version
// the bundled dsh actually ships), while the node-side shell plugin stays on the
// line its runtime packages were built against.
const exceptions = contract.baselineExceptions ?? {}
const repoOverrides = contract.repoBaselines ?? {}
for (const repo of contract.inserted.map(i => i.repo)) {
  const override = repoOverrides[repo] ?? {}
  const baseline = override.baseline ?? contract.baseline
  const cordisWant = override.cordis ?? contract.cordis
  const pkg = JSON.parse(readFileSync(join(root, repo, 'package.json'), 'utf8'))
  for (const [dep, pin] of Object.entries(pkg.devDependencies ?? {})) {
    if (!dep.startsWith('@deepseek-ai/dsh-')) continue
    const want = exceptions[dep] ?? baseline
    if (pin !== want) {
      fail(repo + ': ' + dep + ' 钉 ' + pin + ' ≠ 基线 ' + want)
    }
  }
  const cordisPin = pkg.devDependencies?.['@deepseek-ai/cordis'] ?? pkg.peerDependencies?.['@deepseek-ai/cordis']
  if (cordisPin !== cordisWant) fail(repo + ': cordis 钉 ' + cordisPin + ' ≠ ' + cordisWant)
}
ok('版本钉检查完成')

console.log('== 7. 资产 overlay ↔ 插件构建产物一致 ==')
// 坑 68 家族（模板 + 运行副本双落点必上门禁）：APK 用 assets/patched/* 覆写快照内插件产物，
// 资产与 npm 构建产物一旦漂移，装机就会把插件静默退回旧版本（坑 70① 的真机症状）。
for (const pair of contract.assetOverlays ?? []) {
  const asset = join(root, pair.asset)
  const built = join(root, pair.built)
  if (!existsSync(built)) {
    console.log('  WARN ' + pair.built + ' 未构建（跳过对账；build-apk 的 requires 段负责强制）')
    continue
  }
  if (!existsSync(asset)) { fail('overlay 资产缺失: ' + pair.asset); continue }
  if (readFileSync(asset).equals(readFileSync(built))) ok(pair.asset + ' == ' + pair.built)
  else fail(pair.asset + ' ≠ ' + pair.built + '（插件已重建但 APK 资产未同步 → 装机即回退旧契约）')
}

console.log('== 8. overlay 资产无死件（每个资产都要被壳侧 apply） ==')
// 死 overlay = 资产还在、代码里没人 apply：契约改了但装机不生效，且下次读代码的人会被
// 「资产存在」误导（llm-deepseek-index.js 即此状，靠文档标注才没踩）。
{
  const adir = join(root, contract.assetOverlayDir)
  const src = readFileSync(join(root, contract.assetOverlayReferencedBy), 'utf8')
  for (const f of readdirSync(adir)) {
    if ((contract.assetOverlayDeadAllowed ?? []).includes(f)) {
      console.log('  SKIP ' + f + '（已登记历史资产，不参与引擎）')
      continue
    }
    if (src.includes('patched/' + f)) ok('patched/' + f + ' 被 EngineManager apply')
    else fail('patched/' + f + ' 无人 apply（死 overlay：资产在但运行期永不落地）')
  }
}

console.log('== 9. 快照指纹钉：assets/snapshot.sha256 必须等于 snapshot.tar.xz 实测哈希 ==')
// 坑 71（2026-10-15 真机实锤）：指纹钉与 tar 包不一致时，壳侧每次启动都判定「快照已变」→
// 每次开机全量重抽 tar。tar 抽取是叠加式（从不删多余文件），一旦设备树里还留着旧引擎线，
// 叠加后就是 0.1.1/0.1.7 混装树 → 启动期成片 failed to import / required plugin did not activate。
// 静态对账把这个只在真机爆发的症状转成构建期失败。
{
  const snapp = contract.snapshot
  if (!snapp) console.log('  SKIP contract.snapshot 未登记')
  else {
    const tar = join(root, snapp.archive)
    const pin = join(root, snapp.pin)
    const lfsPointer = existsSync(tar) && statSync(tar).size < 4096
    if (!existsSync(tar) || lfsPointer) console.log('  SKIP 快照不在场（' + (lfsPointer ? 'LFS 指针' : '缺文件') + '，自包含 CI 不带 300MB 资产）')
    else if (!existsSync(pin)) fail('指纹文件缺失: ' + snapp.pin)
    else {
      const hash = await new Promise((resolve, reject) => {
        const h = createHash('sha256')
        const s = createReadStream(tar)
        s.on('error', reject)
        s.on('data', (c) => h.update(c))
        s.on('end', () => resolve(h.digest('hex')))
      })
      // 兼容两种历史写法：裸 hex（build-apk/build-snapshot 生成）与 sha256sum 文本（取首段）
      const pinned = readFileSync(pin, 'utf8').trim().split(/\s+/)[0]
      if (pinned === hash) ok('snapshot.sha256 == tar 实测哈希')
      else fail('snapshot.sha256=' + pinned.slice(0, 12) + ' ≠ tar 实测 ' + hash.slice(0, 12) + '（每次开机全量重抽 → 引擎树混装砖机）')
    }
  }
}

console.log('== 10. vendor shim：APK 资产 ↔ 注进快照的源件一致 ==')
// 坑 69 有两个落地口径：build-snapshot 把 scripts/vendor-shims/ 打进新快照，壳侧把
// assets/vendor-shims/ 补进已发布快照。两份一旦漂移，「新装的机器」和「升上来的机器」
// 跑的是不同 shim——排查时互相解释不通。
{
  const vs = contract.vendorShims
  if (!vs) console.log('  SKIP contract.vendorShims 未登记')
  else {
    const adir = join(root, vs.assetDir)
    if (!existsSync(adir)) fail('vendor shim 资产目录缺失: ' + vs.assetDir)
    else {
      const src = readFileSync(join(root, vs.referencedBy), 'utf8')
      for (const pkg of readdirSync(adir)) {
        if (!src.includes('"' + pkg + '"')) fail('vendor shim ' + pkg + ' 无人安装（死资产）')
        else ok(pkg + ' 被 EngineManager 安装')
        const sdir = join(root, vs.sourceDir, pkg)
        if (!existsSync(sdir)) { fail('快照侧源件缺失: ' + vs.sourceDir + '/' + pkg); continue }
        for (const f of readdirSync(join(adir, pkg))) {
          const a = join(adir, pkg, f), b = join(sdir, f)
          if (!existsSync(b)) { fail(pkg + '/' + f + ' 只存在于 APK 资产（快照侧缺）'); continue }
          if (readFileSync(a).equals(readFileSync(b))) ok(pkg + '/' + f + ' 与快照源件一致')
          else fail(pkg + '/' + f + ' ≠ 快照源件（两条安装路径漂移）')
        }
      }
    }
  }
}

console.log('== 11. 快照差额包资产 ↔ 引擎登记表一致 ==')
// 坑 72：已发布快照落后登记表若干 @deepseek-ai/* 包，壳侧靠 assets/engine-packages.tar.xz 补差。
// 差额清单一旦与登记表版本漂移（引擎升线只改了 overlay.json），补进去的就是旧包 → 运行期
// 报导出缺失；资产被删干净但代码还在引用同理。两者都在此静态钉住。
{
  const mj = join(root, 'app/src/main/assets/engine-packages.json')
  const at = join(root, 'app/src/main/assets/engine-packages.tar.xz')
  const src = readFileSync(join(root, 'app/src/main/java/com/dshmobile/shell/EngineManager.kt'), 'utf8')
  if (!existsSync(mj)) {
    if (existsSync(at)) fail('engine-packages.tar.xz 在场但清单缺失（壳侧无法判定差额）')
    else ok('无差额资产（快照自持登记表全部包）')
  } else {
    const man = JSON.parse(readFileSync(mj, 'utf8'))
    if (!existsSync(at)) fail('engine-packages.json 在场但资产缺失: app/src/main/assets/engine-packages.tar.xz')
    if (!src.includes('engine-packages.json')) fail('EngineManager 未安装差额包（死资产）')
    const registry = JSON.parse(readFileSync(join(root, contract.engineOverlay), 'utf8'))
    const all = { ...(registry.packages ?? {}), ...(registry.vendorTop ?? {}) }
    for (const p of man.packages) {
      if (all[p.name] === undefined) fail('差额包 ' + p.name + ' 不在登记表（应为快照已含或登记表待清）')
      else if (p.version !== all[p.name]) fail('差额包 ' + p.name + ' 清单钉 ' + p.version + ' ≠ 登记表 ' + all[p.name])
      else ok(p.name + '@' + p.version + ' 与登记表一致')
    }
  }
}

if (issues.length > 0) {
  console.error('')
  console.error('CONTRACT FAIL (' + issues.length + '):')
  for (const i of issues) console.error('  - ' + i)
  process.exit(1)
}
console.log('')
console.log('CONTRACT PASS')
