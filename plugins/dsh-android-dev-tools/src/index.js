/**
 * @dsh-android/dsh-android-dev-tools — Ubuntu PRoot 容器命令执行
 *
 * 通过 proot-entry.sh 进入 Ubuntu 24.04 ARM64 容器执行构建/开发命令。
 *
 * C 方案修复 (2026-09-01)：对齐 dsh-android-bridge 成功模式——
 *   inject 声明 tools 硬依赖 + defineTool 包装工具，修复 ctx.get('tools') 静默 undefined。
 *
 * 状态真实性修复（2026-10-17，真机体检实锤）：ubuntu_status 此前只做 access+stat，
 * 「rootfs 在场」被当成「容器可用」上报（ok:true），而同一台机器上 ubuntu_exec 跑
 * `true` 都是 proot error: execve("/usr/bin/bash"): Permission denied。现在把两个判据
 * 拆开，并做一次有界的真实冒烟；判定结果落进探针文件供壳侧复用（决定是否还要解压
 * 307MB rootfs）。
 */
import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { defineTool } from '@deepseek-ai/dsh-tools';

const execFileAsync = promisify(execFile);

/** 壳侧与插件共用的判定文件（schema 变更要同步改 EngineManager.containerProbe）。 */
const PROBE_SCHEMA = 1;

function home() {
  return process.env.HOME || '/data/data/com.dsharnessmobile.shell/files/home';
}

function dshHome() {
  return process.env.DSH_HOME || path.join(home(), '.dsh');
}

function ubuntuEntry() {
  return path.join(dshHome(), 'ubuntu-rootfs', 'proot-entry.sh');
}

function probeFile() {
  return path.join(dshHome(), 'ubuntu-container-probe.json');
}

/** 宿主 Termux 前缀：壳侧 shellEnv() 注入 TERMUX__PREFIX，兜底按 HOME 的兄弟目录推。 */
function prefixDir() {
  return path.resolve(process.env.TERMUX__PREFIX || path.join(home(), '..', 'usr'));
}

/** 读 ELF 头第 5/17/19 字节：class、e_type（2=ET_EXEC 非 PIE，3=ET_DYN/PIE）、e_machine。 */
async function readElfHeader(p) {
  let fh;
  try {
    fh = await fsp.open(p, 'r');
    const buf = Buffer.alloc(20);
    const { bytesRead } = await fh.read(buf, 0, 20, 0);
    if (bytesRead < 20 || buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) return null;
    return { path: p, class: buf[4] === 2 ? 64 : 32, eType: buf[16] | (buf[17] << 8), machine: buf[18] | (buf[19] << 8) };
  } catch {
    return null;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

/** 冒烟输出里判「内核/沙箱拒绝执行」的特征（Android 16 与鸿蒙卓易通都落在这里）。 */
function classifyFailure(text) {
  const t = String(text || '');
  if (/execve\(.*\): Permission denied|EACCES/.test(t)) return 'kernel-refused-exec';
  if (/CANNOT LINK|unexpected e_type/.test(t)) return 'linker-rejected-image';
  if (/No such file or directory/.test(t)) return 'container-entry-missing';
  return 'unknown';
}

async function readProbe() {
  try { return JSON.parse(await fsp.readFile(probeFile(), 'utf8')); } catch { return null; }
}

/** 写判定文件（原子替换，避免壳侧读到半截 JSON）。 */
async function writeProbe(rec) {
  const tmp = `${probeFile()}.tmp`;
  try {
    await fsp.writeFile(tmp, JSON.stringify({ schema: PROBE_SCHEMA, at: new Date().toISOString(), ...rec }, null, 2));
    await fsp.rename(tmp, probeFile());
  } catch { /* 探针文件是优化项不是功能项，写失败不影响本次返回 */ }
}

/** 一次有界的容器冒烟：走的就是 ubuntu_exec 的同一条链，只是命令固定为 true。 */
async function smokeContainer(timeoutMs) {
  const entry = ubuntuEntry();
  const r = spawnSync('bash', [entry, '-lc', 'true'], { timeout: timeoutMs, encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}${r.error ? r.error.message : ''}`;
  if (r.error && r.error.code === 'ETIMEDOUT') return { ok: false, reason: 'smoke-timeout', tail: `容器冒烟超时（${timeoutMs}ms 内未返回）` };
  if (r.status === 0) return { ok: true, reason: '', tail: '' };
  return { ok: false, reason: classifyFailure(out), tail: tailOut(out).split('\n').slice(0, 3).join('\n') };
}

// su 落点候选，与壳侧 EngineManager.SU_CANDIDATES 对齐（坑 84 ⑤：改判据两侧同改）。Magisk/KernelSU
// 常在 /system/bin 之外（实测 OnePlus 在 /product/bin/su -> ./magisk），只认 /system/bin/su 会把
// 已 root 机器误判成无 su → ubuntu_status 报 su:false、ubuntu_exec 走不到 chroot 逃生通道。
const SU_CANDIDATES = [
  '/system/bin/su', '/system/xbin/su', '/sbin/su', '/product/bin/su',
  '/product/xbin/su', '/vendor/bin/su', '/apex/com.android.runtime/bin/su', '/system_ext/bin/su',
];

function suBin() {
  for (const p of SU_CANDIDATES) { try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
  return null;
}

function hasSu() {
  return suBin() !== null;
}


function renderText(_a, v) {
  return [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }];
}

/** 单引号包裹防命令注入（对齐 root-ops/apk-tools 的 shellQuote 语义）。 */
function shQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/** apt 输出可能很长，只保留尾部（错误摘要通常在末尾），封顶 8KB。 */
function tailOut(s) {
  const t = (s || '').trim();
  return t.length > 8192 ? t.slice(-8192) : t;
}

function tools() {
  const execTool = defineTool({
    name: 'ubuntu_exec',
    description:
      'Execute a build or development command inside the Seagull Ubuntu container ' +
      '(apt/dpkg/gcc/cmake/python3/java toolchain). Typically used for APK reverse/build, ' +
      'C/C++ compilation, or Python tooling that needs a full distro.',
    parameters: {
      command: { type: 'string', required: true, description: 'Shell command to run inside Ubuntu (bash -lc).' },
      timeoutMs: { type: 'number', description: 'Timeout in ms (default 120000).' },
      force: { type: 'string', description: 'Set to "1" to run even when the last probe judged the container unusable.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ command, timeoutMs = 120000, force }) {
      const entry = ubuntuEntry();
      // proot-entry.sh 是 bash 脚本（依赖 ${BASH_SOURCE[0]}，shebang #!/bin/bash），必须用 bash 执行；
      // 用 PATH 查找的 `bash`（termux $PREFIX/bin/bash），不硬编码 /bin/bash 依赖 LD_PRELOAD 重路由。
      const shell = 'bash';
      // 上一次探针已判死且没有 root chroot 通道时，不再把 120s 预算烧在必然失败的链上；
      // 给模型一条可执行的下一步，而不是重复吐 proot 的三行噪声。
      if (force !== '1' && !hasSu()) {
        const cached = await readProbe();
        if (cached && cached.blocked) {
          return {
            ok: false, skipped: true, reason: cached.reason, probedAt: cached.at,
            error: 'Ubuntu 容器在本机被判定不可用（' + cached.reason + '），已跳过执行以免空耗超时；' +
              '判据来自上一次真实冒烟：' + (cached.tail || '(无 stderr 记录)'),
            hint: '内核对 app 私有目录下的非 bionic ELF 直接 EACCES（Android 16+ / 鸿蒙卓易通实测），proot 与其 loader/guest ld.so 都过不去；' +
              '没有 su（Magisk/KernelSU 的 su 落点不限于 /system/bin/su，也可能在 /product/bin/su 等）时也没有 chroot 逃生通道。要么在已 root 的设备上用（proot-entry 会自动走 root chroot），' +
              '要么改用宿主 Termux 侧的按需安装器（tool_install）与 APK 内置二进制。确认要重试请传 force="1"。',
          };
        }
      }
      try {
        const { stdout, stderr } = await execFileAsync(shell, [entry, '-lc', command], {
          timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024,
        });
        const prev = await readProbe();
        if (prev && prev.blocked) await writeProbe({ blocked: false, reason: '', su: hasSu(), runner: 'plugin-exec' });
        return { ok: true, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() };
      } catch (err) {
        const out = `${err.message || ''}\n${err.stderr || ''}`;
        const reason = classifyFailure(out);
        if (reason === 'kernel-refused-exec' || reason === 'linker-rejected-image') {
          await writeProbe({ blocked: true, reason, su: hasSu(), tail: tailOut(out).split('\n').slice(0, 3).join('\n'), runner: 'plugin-exec' });
        }
        return {
          ok: false, reason, error: err.message,
          stderr: err.stderr ? String(err.stderr).trim() : '',
          hint: reason === 'kernel-refused-exec'
            ? '内核/沙箱拒绝执行容器内的 ELF（非 bionic 链路镜像在 Android 16+ 与鸿蒙上直接 EACCES），不是命令写错，也不是 rootfs 缺失；重试无意义。'
            : reason === 'linker-rejected-image'
              ? '镜像被 linker 拒载（非 PIE / 与 /system/bin/linker64 不兼容）；proot 的 loader 属此类。'
              : '容器执行链失败，见 stderr 原文。',
        };
      }
    },
  });


  const statusTool = defineTool({
    name: 'ubuntu_status',
    description:
      'Report the Ubuntu container honestly: whether the rootfs is present AND whether it can ' +
      'actually execute. Presence and usability are different facts — on Android 16+ and HarmonyOS ' +
      'the kernel refuses to exec non-bionic ELF, so a fully assembled 300MB rootfs can still be ' +
      'a dead container. Set smoke=false to skip the bounded execution probe.',
    parameters: {
      smoke: { type: 'string', description: 'Set to "0" to skip the real exec probe (presence only, fast).' },
      timeoutMs: { type: 'number', description: 'Exec probe budget in ms (default 20000).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ smoke, timeoutMs = 20000 }) {
      const entry = ubuntuEntry();
      const rootfs = path.dirname(entry);
      // marker = Ubuntu 关键二进制 usr/bin/bash（Ubuntu 24.04 的 bin -> usr/bin 软链），
      // 与壳侧 extractToolAssets 幂等落点（bin/bash）对齐。仅 access 根目录会漏判
      // 「目录在但内容未解压」以及软链丢失的残缺装配。
      const bash = path.join(rootfs, 'usr/bin/bash');
      let st;
      let present = true;
      try {
        await fsp.access(bash);
        // 2026-10 复盘修复：stat 原在 try 外——access 与 stat 之间软链断裂/竞态会抛
        // 未捕获异常把整个工具执行崩掉。合并进同一 try，如实转为 not-present 语义。
        st = await fsp.stat(bash);
      } catch {
        present = false;
      }
      const su = hasSu();
      const loaders = [];
      for (const rel of ['share/operit-native/loader', 'libexec/proot/loader']) {
        const h = await readElfHeader(path.join(prefixDir(), rel));
        if (h) loaders.push({ ...h, eTypeName: h.eType === 2 ? 'ET_EXEC' : h.eType === 3 ? 'ET_DYN(PIE)' : `ET_${h.eType}` });
      }
      if (!present) {
        const blocked = await readProbe();
        return {
          ok: false, present: false, usable: false, rootfs, su, loaders,
          reason: blocked && blocked.blocked ? blocked.reason : 'rootfs-missing',
          message: 'Ubuntu rootfs 未装配（缺 usr/bin/bash）' +
            (blocked && blocked.blocked
              ? `；且本机已判定容器不可用（${blocked.reason}），壳侧按探针跳过了解压——这不是缺陷，是平台限制。`
              : '：请确认 APK 内置 rootfs 资产已完整解压到 .dsh/ubuntu-rootfs。'),
        };
      }
      const base = { present: true, rootfs, bashBytes: st.size, su, loaders, execMode: su ? 'root-chroot' : 'proot' };
      if (smoke === '0') {
        const cached = await readProbe();
        return { ...base, ok: !(cached && cached.blocked), usable: cached ? !cached.blocked : undefined, probed: false,
          message: cached ? `按缓存判定回报（${cached.at}，${cached.blocked ? '不可用:' + cached.reason : '可用'}），未执行冒烟。` : '未做冒烟，只报在场。' };
      }
      const s = await smokeContainer(timeoutMs);
      // 探针结论回写：壳侧下次启动据此决定是否还要解压 300MB rootfs；成功则清除 blocked 记录。
      await writeProbe(s.ok
        ? { blocked: false, reason: '', su, execMode: base.execMode, runner: 'plugin' }
        : { blocked: s.reason === 'kernel-refused-exec' || s.reason === 'linker-rejected-image', reason: s.reason, su,
            execMode: base.execMode, loaderTypes: loaders.map((l) => l.eType), tail: s.tail, runner: 'plugin' });
      return {
        ...base, ok: s.ok, usable: s.ok, probed: true,
        reason: s.ok ? '' : s.reason, smoke: s.ok ? { exit: 0 } : { exit: 1, tail: s.tail },
        message: s.ok ? '容器可用：已用 bash -lc true 走通 proot-entry 全链。'
          : `容器不可用（${s.reason}）。在场≠可用：rootfs 完整（usr/bin/bash ${st.size}B）但执行链被拒——` +
            'Android 16+ / 鸿蒙内核对 app 私有目录里的非 bionic ELF 直接 EACCES，' +
            'proot 的 loader 与 guest ld.so 全在这一条上；无 su（落点不限于 /system/bin/su）时没有 chroot 逃生通道。',
      };
    },
  });


  const toolchainTool = defineTool({
    name: 'ubuntu_toolchain_install',
    description:
      'Install the compile toolchain (build-essential/gcc/g++/make/cmake/git/python3) inside the ' +
      'Seagull Ubuntu container via apt. The APK now ships a slim minbase rootfs (no toolchain baked ' +
      'in) to keep it light-asset; call this once after ubuntu_status confirms the rootfs is present. ' +
      'Requires root chroot (KernelSU) for a reliable apt/dpkg run — without root, dpkg hits the ' +
      'SYSCONFDIR sandbox limitation (坑13) and the install may partially fail; the tool reports this honestly.',
    parameters: {
      packages: { type: 'string', description: 'Optional space-separated extra apt packages to install. Defaults to "build-essential cmake git python3".' },
      timeoutMs: { type: 'number', description: 'Timeout in ms (default 900000).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ packages, timeoutMs = 900000 }) {
      const entry = ubuntuEntry();
      // 白名单字符闸（apt 包名字符集：字母数字 + . + _ + -），非法项丢弃；再逐个单引号包裹——双保险防注入。
      const extra = String(packages || '').trim().split(/\s+/).filter((p) => /^[A-Za-z0-9._+-]+$/.test(p)).map((p) => shQuote(p)).join(' ')
        || 'build-essential cmake git python3';
      const pkgs = extra;
      // 探测 root 通道：任一 su 候选可执行（SU_CANDIDATES，与壳侧对齐）= proot-entry.sh 会走 root chroot（apt 可靠）；
      // 否则纯 proot，dpkg 触发 SYSCONFDIR 限制（坑13），如实降级报告。
      const hasRoot = hasSu();

      const script =
        'set -e; export DEBIAN_FRONTEND=noninteractive; ' +
        '[ -s /etc/apt/sources.list ] || printf "deb http://ports.ubuntu.com/ubuntu-ports noble main universe\\n" > /etc/apt/sources.list; ' +
        'apt-get update -y && apt-get install -y --no-install-recommends ' + pkgs + ' && apt-get clean';
      if (!hasRoot) {
        return {
          ok: false, rootRequired: true,
          error: '未检测到 root 通道（SU_CANDIDATES 各落点均不可执行，含 /system/bin/su、/product/bin/su 等）：纯 proot 下 apt/dpkg 会触发 SYSCONFDIR 沙箱限制（坑13），无法可靠安装工具链。请在已 root 的设备上重试，或改用宿主 Termux 的按需安装器。',
        };
      }
      try {
        const { stdout, stderr } = await execFileAsync('bash', [entry, '-lc', script], {
          timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024,
        });
        return { ok: true, root: true, packages: pkgs.trim(), stdout: tailOut(stdout), stderr: (stderr || '').trim() };
      } catch (err) {
        return { ok: false, root: true, error: err.message, stderr: tailOut(err.stderr ? String(err.stderr) : '') };
      }
    },
  });

  return [execTool, statusTool, toolchainTool];
}

// C 方案：显式声明 tools 硬依赖（对齐 bridge/manage），修复 ctx.get('tools') 静默 undefined。
export const inject = ['tools'];

export function apply(ctx) {
  for (const t of tools())
    ctx.tools.register(t);
}
