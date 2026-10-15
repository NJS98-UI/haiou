// build-engine-packages.mjs — 已发布快照的「缺包自愈」资产生成器。
//
// 背景（坑 72，2026-10-16 真机实锤）：scripts/engine-overlay.json 是引擎依赖登记表（505 条），
// build-snapshot-013.mjs 按它把包覆盖进**新**快照；但 assets/snapshot.tar.xz 里的已发布快照
// 与它对不上两类账：① 9 个包根本不在场（dsh-util-time / dsh-client-ui-primitives /
// dsh-ptc-runtime …）；② 18 个 @deepseek-ai/* 仍停在 0.1.1-rc.2 引擎线（dsh-sandbox 等 import
// 0.1.7 才有的 dsh-llm 导出 → 运行期成片 does not provide an export named 'assertNever'）。
// 全新安装 = 干净抽取 → 36 个插件 failed to import → 「startup failed: 1 required plugin did
// not activate」。老机器上这些包靠设备侧手工注入存活，叠加式抽取把缺口掩盖了（坑 71）。
//
// 本脚本把「登记表 − 快照实测（名称与版本双比）」的差额打成一个 tar.xz（路径即最终落点），
// 随 APK 出货，壳侧 EngineManager.installEnginePackages() 在缺/旧时抽取——APK 成为快照差额的
// 唯一真源，与 applyRuntimePatches / vendor-shims 的自愈口径一致。
//
// 用法：node scripts/build-engine-packages.mjs [--npm <npm-cli.js>] [--dry]
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const ASSETS = join(ROOT, 'app', 'src', 'main', 'assets')
const SNAP = join(ASSETS, 'snapshot.tar.xz')
const OUT_TGZ = join(ASSETS, 'engine-packages.tar.xz')
const OUT_JSON = join(ASSETS, 'engine-packages.json')
const STAGE = join(ROOT, 'build', 'engine-packages-stage')
const DL = join(ROOT, 'build', 'engine-packages-dl')
const NPM = process.argv.includes('--npm')
  ? process.argv[process.argv.indexOf('--npm') + 1]
  : process.env.NPM_CLI ?? 'npm'
const dry = process.argv.includes('--dry')

const log = (m) => console.log('[engpack] ' + m)
// npm 在本仓只以 npm-cli.js 形式在场（无全局安装），故用当前 node 解释器跑它；代理残留会
// 让 registry 请求挂死，显式清空。
function npmRun(args) {
  const cmd = NPM === 'npm' ? 'npm' : process.execPath
  const pre = NPM === 'npm' ? [] : [NPM]
  const r = spawnSync(cmd, [...pre, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', no_proxy: '*' },
  })
  if (r.status !== 0) throw new Error('npm ' + args.join(' ') + ' → ' + r.status + '\n' + (r.stderr ?? '') + (r.stdout ?? ''))
  return (r.stdout ?? '') + (r.stderr ?? '')
}
function sh(cmd, args, spawnOpts = {}) {
  // 外部 tar 走 msys/GNU 实现：Windows 绝对路径（D:\…）会被它当成远端主机名解析失败，
  // 反斜杠会被当转义符——一律按「仓库根相对 + 正斜杠」调用。
  const rel = (a) => (a.startsWith(ROOT) ? relative(ROOT, a) : a).split('\\').join('/')
  const notFoundOk = spawnOpts.notFoundOk === true
  const rest = { ...spawnOpts }
  delete rest.notFoundOk
  const r = spawnSync(cmd, args.map((a) => typeof a === 'string' ? rel(a) : a), { encoding: 'utf8', cwd: ROOT, ...rest })
  // tar 在「某条通配模式一条都没命中」时以 2 退出并打 Not found in archive——这里允许，
  // 其余成员照常解出（实测：快照不含某个包时正是这种退出）。
  if (r.status !== 0 && !(notFoundOk && /Not found in archive/.test(r.stderr ?? ''))) {
    throw new Error(cmd + ' ' + args.join(' ') + ' → ' + r.status + '\n' + (r.stderr ?? ''))
  }
  return r.stdout ?? ''
}
const names = (dir) => { try { return readdirSync(dir) } catch { return [] } }
const readCacheStamp = (p) => readFileSync(p, 'utf8').split('\n', 1)[0]

if (!existsSync(SNAP)) throw new Error('快照不在场：' + SNAP)
const OVERLAY = JSON.parse(readFileSync(join(ROOT, 'scripts', 'engine-overlay.json'), 'utf8'))
const ENGINE_NM = 'usr/lib/node_modules/@deepseek-ai/dsh/node_modules'

// 1. 快照实测「包名 → 版本」（不是只列目录！坑 72 的完整形态是：已发布快照既有缺包，
//    也有整批停在旧引擎线的包——0.1.1-rc.2 的 dsh-sandbox import 0.1.7 才有的 dsh-llm 导出，
//    就是运行期成片 does not provide an export named 的来源。只补缺包会留下这半边。）
//    抽 package.json 要整包 xz 解压（分钟级），按快照体积缓存于 build/；--relist 强制重抽。
const CACHE = join(ROOT, 'build', 'engine-packages-snapshot-versions.txt')
const needRelist = process.argv.includes('--relist') ||
  !existsSync(CACHE) ||
  statSync(CACHE).size === 0 ||
  readCacheStamp(CACHE) !== statSync(SNAP).size
if (needRelist) {
  log('从快照抽取引擎包版本表（xz 全量解压，约 2–5 分钟）…')
  const tmp = join(ROOT, 'build', 'engine-packages-snapjson')
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true })
  // 单条模式即可：GNU tar 的 * 在本机实现里跨 / 匹配，@scope/包 一起命中；
  // 「全部匹配后仍有模式落空」会让 tar 以 2 退出（Not found in archive），那不是失败。
  sh('tar', ['-xJf', SNAP, '-C', tmp, '--wildcards', ENGINE_NM + '/*/package.json'], { notFoundOk: true })
  const rows = []
  const base = join(tmp, ENGINE_NM)
  const versionOf = (dir) => {
    const pj = join(dir, 'package.json')
    if (!existsSync(pj)) return null
    try { return JSON.parse(readFileSync(pj, 'utf8')).version ?? null } catch { return null }
  }
  for (const e of names(base)) {
    if (e.startsWith('@')) {
      for (const s of names(join(base, e))) {
        const v = versionOf(join(base, e, s))
        if (v) rows.push(e + '/' + s + ' ' + v)
      }
    } else {
      const v = versionOf(join(base, e))
      if (v) rows.push(e + ' ' + v)
    }
  }
  mkdirSync(dirname(CACHE), { recursive: true })
  writeFileSync(CACHE, '#snap:' + statSync(SNAP).size + '\n' + rows.sort().join('\n') + '\n')
  rmSync(tmp, { recursive: true, force: true })
} else log('复用快照版本表缓存：build/engine-packages-snapshot-versions.txt')
const installed = new Map()
for (const line of readFileSync(CACHE, 'utf8').split('\n')) {
  const m = line.trim().match(/^(.*?) (\S+)$/)
  if (m) installed.set(m[1], m[2])
}
log('快照内引擎包：' + installed.size)

// 2. 差额 = 登记表（packages + vendorTop）里「不在场」或「版本不等于登记值」的包
const registry = { ...(OVERLAY.packages ?? {}), ...(OVERLAY.vendorTop ?? {}) }
const delta = Object.entries(registry)
  .filter(([n, v]) => installed.get(n) !== v)
  .map(([n, v]) => [n, v, installed.get(n)])
  .sort(([a], [b]) => a.localeCompare(b))
log('登记表 ' + Object.keys(registry).length + ' 条，差额 ' + delta.length + ' 个：')
for (const [n, v, got] of delta) log('  - ' + n + '@' + v + (got ? '（快照为 ' + got + '）' : '（快照缺）'))
if (delta.length === 0) {
  log('快照已自持登记表全部包（新快照线）——移除旧差额资产')
  rmSync(OUT_TGZ, { force: true }); rmSync(OUT_JSON, { force: true })
  console.log('=== 无差额，未生成资产 ===')
  process.exit(0)
}
if (dry) { log('--dry：不下载、不打包'); process.exit(0) }

// 3. 拉取 + staging（路径即设备落点，抽取侧无需 strip-components）
rmSync(STAGE, { recursive: true, force: true }); rmSync(DL, { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true }); mkdirSync(DL, { recursive: true })
const manifest = { engineVersion: OVERLAY.engineVersion, targetRoot: 'files/' + ENGINE_NM, packages: [] }
for (const [name, version] of delta) {
  // npm pack 的文件名打在 stderr、路径打在 stdout（版本行为不一），故按目录快照差集取件
  const before = new Set(names(DL))
  npmRun(['pack', `${name}@${version}`, '--pack-destination', DL])
  const fresh = names(DL).filter((f) => !before.has(f) && f.endsWith('.tgz'))
  if (fresh.length !== 1) throw new Error('npm pack 产物异常：' + name + ' → ' + fresh.join(','))
  const dest = join(STAGE, ENGINE_NM, name)
  mkdirSync(dest, { recursive: true })
  sh('tar', ['-xzf', join(DL, fresh[0]), '--strip-components=1', '-C', dest])
  const pj = JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8'))
  if (pj.version !== version) throw new Error(`${name} 取到 ${pj.version}，登记表钉 ${version}`)
  manifest.packages.push({ name, version })
  log('  + ' + name + '@' + version)
}

// 4. 打成 tar.xz（相对 STAGE 的 usr/… 路径，壳侧直接解到 filesDir）
rmSync(OUT_TGZ, { force: true })
sh('tar', ['-cJf', OUT_TGZ, '-C', STAGE, 'usr'])
writeFileSync(OUT_JSON, JSON.stringify(manifest, null, 2) + '\n')
rmSync(STAGE, { recursive: true, force: true }); rmSync(DL, { recursive: true, force: true })
log(`资产就位：engine-packages.tar.xz（${(statSync(OUT_TGZ).size / 1024).toFixed(0)} KB）+ engine-packages.json`)
console.log('=== 完成：差额 ' + delta.length + ' 个包已固化为 APK 资产 ===')
