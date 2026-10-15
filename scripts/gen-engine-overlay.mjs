#!/usr/bin/env node
// 从开源 npm 生成 scripts/engine-overlay.json（引擎升级登记表，坑 66）。
// 用法：node scripts/gen-engine-overlay.mjs [engineVersion]   （默认取 @deepseek-ai/dsh dist-tags.latest）
// 语义：全传递闭包（dependencies 面远不止第一层）——
//   packages  = @deepseek-ai 域全部可达包（0.1.7 线把 0.1.1 单体拆成数百细粒度包，必须全量在场）
//   vendorTop = 非 scoped 第三方传递闭包，按 spec 并集 max-satisfying 解析（dist-tags.latest 会越 caret 上界，
//               如 js-yaml ^4.2.0 的 latest 是 5.x）；旧清单已有钉版若仍满足全部 spec 则保留（对齐已知可用组合）。
// 可选依赖（平台二进制 @img/*、sherpa-onnx-* 等）不入清单：
//   前者需真机验证（Android bionic 无 android triple 的包本就装不上）。
//   peerDependencies 则**必须**入闭包（坑 69）：0.1.7 线把包间装配依赖全部声明为
//   peer（dependencies 只剩 cosmokit/zod 类基础设施），cordis 运行期从引擎树解析
//   peer——只走 dependencies 面会系统性漏包（dsh-session-persistence 等），
//   真机表现为 35 插件 failed to import 的 ESM 导出面漂移崩溃。
//   peerDependenciesMeta.optional=true 的 peer 除外（宿主可缺省）。
// 运行期未发布包（keepUnpublished，如 dsh-client-runtime 峰顶 0.1.1-rc.2）无 registry 元数据，保留原样。

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MANIFEST = join(ROOT, 'scripts', 'engine-overlay.json')
const REG = ['https://registry.npmjs.org', 'https://registry.npmmirror.com']
const failed = []
const packCache = new Map()

async function packument(name) {
  if (packCache.has(name)) return packCache.get(name)
  for (const m of REG) {
    try {
      const r = await fetch(`${m}/${name}`, { signal: AbortSignal.timeout(30000) })
      if (!r.ok) continue
      const j = await r.json()
      packCache.set(name, j)
      return j
    } catch { /* 下一镜像 */ }
  }
  packCache.set(name, null)
  failed.push(name)
  return null
}

function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v)
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null, raw: v } : null
}
function cmp(a, b) {
  for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] - b[k]
  if (a.pre === null && b.pre !== null) return 1
  if (a.pre !== null && b.pre === null) return -1
  if (a.pre === b.pre) return 0
  return a.pre < b.pre ? -1 : 1
}
function satOne(ver, range) {
  let m
  if ((m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(range))) return ver ? cmp(ver, parse(range)) === 0 : false
  if ((m = /^\^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(range))) {
    if (!ver) return false
    const lo = { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null }
    if (cmp(ver, lo) < 0) return false
    if (lo.major > 0) return ver.major === lo.major
    if (lo.minor > 0) return ver.major === 0 && ver.minor === lo.minor
    return ver.major === 0 && ver.minor === 0
  }
  if ((m = /^~(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(range))) {
    if (!ver) return false
    const lo = { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null }
    return cmp(ver, lo) >= 0 && ver.major === lo.major && ver.minor === lo.minor
  }
  if ((m = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range))) return ver ? cmp(ver, { major: +m[1], minor: +m[2], patch: +m[3], pre: null }) >= 0 : false
  if (range === '*' || range === 'x' || range === '') return !!ver && ver.pre === null
  return null
}
function maxSatisfying(versions, range) {
  let best = null
  for (const alt of range.split('||').map((s) => s.trim())) {
    for (const v of versions) {
      const p = parse(v)
      if (!p) continue
      if (p.pre !== null && !/-[0-9A-Za-z.-]+$/.test(alt)) continue
      if (satOne(p, alt) === true && (best === null || cmp(p, best) > 0)) best = p
    }
  }
  return best?.raw ?? null
}
function satisfiesAll(version, specs) {
  for (const s of specs) if (maxSatisfying([version], s) !== version) return false
  return true
}

const engineVersion = process.argv[2] ?? null

// 根包版本：argv 优先，否则 dist-tags.latest
let rootVer = engineVersion
{
  const j = await packument('@deepseek-ai/dsh')
  if (!j) throw new Error('dsh 元数据不可得')
  rootVer ??= j['dist-tags'].latest
  console.error(`root = @deepseek-ai/dsh@${rootVer}`)
}

// 遍历全传递闭包，记录每个 dep 的 spec 并集
const seen = new Set()
const specWanted = new Map()
async function walk(name, version) {
  const key = `${name}@${version}`
  if (seen.has(key)) return
  seen.add(key)
  const j = await packument(name)
  if (!j) return
  const v = j.versions[version]
  if (!v) { failed.push(`${key} (version absent)`); return }
  // dependencies + peerDependencies 双面并集（坑 69：0.1.7 线包间依赖全走 peer）；
  // peerDependenciesMeta 标记 optional 的 peer 不入闭包。
  const reqDeps = { ...(v.dependencies ?? {}) }
  const optPeers = new Set(Object.entries(v.peerDependenciesMeta ?? {}).filter(([, m]) => m?.optional).map(([k]) => k))
  for (const [dep, spec] of Object.entries(v.peerDependencies ?? {})) {
    if (!optPeers.has(dep)) reqDeps[dep] = spec
  }
  for (const [dep, spec] of Object.entries(reqDeps)) {
    if (dep === name) continue // self-peer（同名自身）跳过，防自引用噪声
    if (!specWanted.has(dep)) specWanted.set(dep, new Set())
    specWanted.get(dep).add(spec)
    const dj = await packument(dep)
    if (!dj) continue
    const dv = maxSatisfying(Object.keys(dj.versions), spec) ?? dj.versions[dj['dist-tags'].latest]?.version
    if (!dv) continue
    await walk(dep, dv)
  }
}
await walk('@deepseek-ai/dsh', rootVer)

// 组装清单：旧钉版优先（满足全部 spec 即保留），否则 max-satisfying
const old = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const oldPins = { ...(old.packages ?? {}), ...(old.vendorTop ?? {}) }
const packages = {}
const vendorTop = {}
for (const [name, specs] of [...specWanted].sort()) {
  if (name === '@deepseek-ai/dsh') continue
  const j = packCache.get(name)
  if (!j) continue
  const all = Object.keys(j.versions)
  const specList = [...specs]
  let chosen = oldPins[name] && satisfiesAll(oldPins[name], specList) ? oldPins[name] : null
  if (!chosen) {
    for (const s of specList) {
      const ms = maxSatisfying(all, s)
      if (ms && (chosen === null || cmp(parse(ms), parse(chosen)) > 0)) chosen = ms
    }
    chosen ??= j.versions[j['dist-tags'].latest]?.version
  }
  if (!chosen) continue
  if (name.startsWith('@')) packages[name] = chosen
  else vendorTop[name] = chosen
}

const manifest = {
  $schema: old.$schema ?? 'seagull-devstudio engine overlay manifest (W1.dsh-upgrade)',
  engineVersion: rootVer,
  comment: [
    'DSH engine upgrade manifest: full transitive closure of the engine line, regenerated by',
    'scripts/gen-engine-overlay.mjs from the public npm registry (pitfall 66).',
    'packages = every reachable @deepseek-ai-scoped package; vendorTop = every non-scoped transitive',
    'dependency resolved max-satisfying per spec union (old pins kept while still satisfying).',
    'keepUnpublished = packages absent from this release line, kept at their tree versions.'
  ],
  rootPackage: { name: '@deepseek-ai/dsh', version: rootVer },
  packages,
  vendorTop,
  keepUnpublished: old.keepUnpublished ?? []
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
console.error(`walk failed: ${failed.join(', ') || '(none)'}`)
console.error(`written ${MANIFEST}: packages=${Object.keys(packages).length} vendorTop=${Object.keys(vendorTop).length}`)
