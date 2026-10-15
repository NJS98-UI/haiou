// patch-spill-local-android.mjs — @deepseek-ai/dsh-spill-local 的 Android 祖先目录适配（幂等补丁）
//
// 背景（2026-10-16 真机实锤，坑 76）：spill-local 的启动清理在解析每个候选 root 时走
// hasProtectedAncestors()，其判据是「祖先目录组可写且无 sticky 即拒绝」。这个威胁模型来自
// 多用户 POSIX 主机，在 Android 上是必然假阳性：
//   /data       0771 system:system   ← 组可写、无 sticky → 拒
//   /data/data  0771 system:system   ← 同上 → 拒
// app 自己的 files/ 也常是 0771 <app uid>。于是真机 home/tmp 下积累的 92 个 dsh-spill-* 根
// 全部报 `skipped unsafe root ... protected write and ancestor permissions`，清理通道整体空转
// （每个进程 mkdtemp 一个新根却永远回收不了，目录只增不减）。
// 而 Android 的真实可达性完全不同：gid=1000(system) 不在任何 app 的补充组里，普通 app uid
// 既写不进 /data 也写不进 /data/data（DAC + SELinux 双重），组写位在这里根本不构成
// 「别的本地用户可以替换子目录」。所以按「这个组到底还有谁能进」判定，而不是「组写位在不在」。
//
// 判据（只在 process.platform === 'android' 生效，其余平台语义逐字节不变）：
//   非 world 可写，且组写位属于以下二者之一 → 视为受保护
//     · gid === 本进程 euid：Android 每个 app 的私有组，仅本 app；
//     · uid < 10000 且 gid < 10000 且 gid 不在本进程补充组内：平台账号专属组（system/root…）。
//   其余仍按上游拒绝（例如 gid=1007(log)/1015(sdcard_rw) 这类多 app 共享组、或别的 app 的组）。
//
// 用法：node scripts/patch-spill-local-android.mjs <index.js> [--apply|--check]
//   --check（默认）：验证 Android 分支在场且上游原句已改写 → 退出 0，否则 1（构建门禁用）
//   --apply：在 dsh-spill-local 原始 lib/index.js 上打补丁（已打则跳过），随后 --check 自验
//
// 上游基线：@deepseek-ai/dsh-spill-local@0.1.7-rc.2（lib/index.js，字节级锚点）
import { readFileSync, writeFileSync } from 'node:fs'

const MARKER = 'dsh-mobile-android-ancestors'

const HELPERS = `/* ${MARKER}：Android 祖先目录判据（坑 76）。上游只看组写位存不存在，
* Android 上 /data 与 /data/data 恒 0771 system:system、app 的 files/ 恒带组写位，
* 于是每个候选 spill root 都被拒；这里改为按「该组实际还有谁能进」判定。 */
const ANDROID_AID_APP = 10000;
/** 本进程所属组；取不到就按空集处理，只会让判据更严。 */
function androidGroups() {
	if (process.getgroups === void 0) return [];
	try {
		return process.getgroups();
	} catch {
		return [];
	}
}
const ANDROID_GROUPS = androidGroups();
/**
* 组可写的祖先在 Android 是否仍对其他 uid 关闭：非 world 可写，且组是
* 本 app 私有组（gid === euid）或本进程拿不到的平台组（uid/gid < 10000）。
* @param stats 祖先目录的 lstat 结果。
* @param currentUid 本进程 euid。
* @returns 该祖先可视为受保护时返回 \`true\`。
*/
function isProtectedAndroidAncestor(stats, currentUid) {
	if (process.platform !== "android") return false;
	/* 16 = 组写位，2 = 其他用户写位（上游的 18 即 0o022 两位合一）。 */
	if ((stats.mode & 2) !== 0 || (stats.mode & 16) === 0) return false;
	if (stats.gid === currentUid) return true;
	return stats.uid < ANDROID_AID_APP && stats.gid < ANDROID_AID_APP && !ANDROID_GROUPS.includes(stats.gid);
}`

const EDITS = [
  {
    name: 'A1 助手函数与判据注入（hasProtectedAncestors 之前）',
    apply(src) {
      const anchor = '/**\n* Check that no ancestor permits another local OS user to replace the selected'
      const i = src.indexOf(anchor)
      if (i < 0) throw new Error('A1 锚点缺失（docstring 变了，需人工核对）')
      return src.slice(0, i) + HELPERS + '\n' + src.slice(i)
    },
    check: (src) => src.includes(MARKER) && src.includes('function isProtectedAndroidAncestor(stats, currentUid)'),
  },
  {
    name: 'A2 祖先拒绝条件改写',
    apply(src) {
      const OLD = `\t\tconst writableByOthers = (stats.mode & 18) !== 0;\n\t\tconst sticky = (stats.mode & 512) !== 0;\n\t\tif (writableByOthers && !sticky) return false;\n\t\t/* v8 ignore next -- requires an ancestor owned by another OS account inside\n\t\ta writable sticky parent; ordinary test fixtures cannot change uid. */\n\t\tif (writableByOthers && childStats.uid !== currentUid) return false;`
      const NEW = `\t\tconst writableByOthers = (stats.mode & 18) !== 0;\n\t\tconst sticky = (stats.mode & 512) !== 0;\n\t\t/* ${MARKER}：Android 上组写位不等于「别人能替换」，见文件头说明。 */\n\t\tconst protectedAncestor = isProtectedAndroidAncestor(stats, currentUid);\n\t\tif (writableByOthers && !sticky && !protectedAncestor) return false;\n\t\t/* v8 ignore next -- requires an ancestor owned by another OS account inside\n\t\ta writable sticky parent; ordinary test fixtures cannot change uid. */\n\t\tif (writableByOthers && !protectedAncestor && childStats.uid !== currentUid) return false;`
      if (!src.includes(OLD)) throw new Error('A2 锚点缺失（祖先判据四行变了，需人工核对）')
      return src.replace(OLD, NEW)
    },
    check: (src) => src.includes('if (writableByOthers && !sticky && !protectedAncestor) return false;')
      && src.includes('if (writableByOthers && !protectedAncestor && childStats.uid !== currentUid) return false;')
      && !src.includes('if (writableByOthers && !sticky) return false;'),
  },
]

const file = process.argv[2]
const mode = process.argv[3] ?? '--check'
if (!file) { console.error('用法: node patch-spill-local-android.mjs <index.js> [--apply|--check]'); process.exit(2) }

let src = readFileSync(file, 'utf8')
if (mode === '--apply') {
  for (const e of EDITS) {
    if (e.check(src)) { console.log(`  跳过（已在场）: ${e.name}`); continue }
    src = e.apply(src)
    console.log(`  已应用: ${e.name}`)
  }
  writeFileSync(file, src)
  mode2check(file)
} else if (mode === '--check') {
  mode2check(file)
} else {
  console.error(`未知模式: ${mode}`)
  process.exit(2)
}

function mode2check(path) {
  const cur = readFileSync(path, 'utf8')
  let bad = 0
  for (const e of EDITS) {
    if (!e.check(cur)) { console.error(`FAIL ${e.name}`); bad++ } else console.log(`OK   ${e.name}`)
  }
  if (bad) process.exit(1)
  console.log(`spill-local Android 补丁校验通过: ${path}`)
}
