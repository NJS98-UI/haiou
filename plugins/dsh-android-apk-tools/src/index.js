/**
 * @dsh-android/dsh-android-apk-tools - APK decompile & rebuild tools.
 *
 * Seagull fork 执行模型（2026-09-02 复盘定案）：
 *   双路径执行 APK 工具链，均跑在宿主（Termux）——**不经 Ubuntu 容器**：
 *     1) 优先 usr/bin/{apktool,jadx,apksigner}（install-java-tools.sh 按需装配的 wrapper）
 *     2) 缺则回退 usr/share/{apktool,jadx}（apktool=APK 内置资产解压；jadx=tool_install 在线装，
 *        解到 usr/share/jadx 同构布局）+ usr/bin/java
 *   工具就绪门槛：java（openjdk-21）必须在；apktool/jadx/apksigner 任一路径可用。
 *   全缺时返回明确引导（install-java-tools.sh），不静默失败。
 *
 * C 方案修复 (2026-09-01)：对齐 dsh-android-bridge 成功模式——
 *   inject 声明 tools 硬依赖 + defineTool 包装工具，修复 ctx.get('tools') 静默 undefined。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, appendFileSync, mkdirSync, statSync, readFileSync, writeFileSync, accessSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';

const execFileAsync = promisify(execFile);

/**
 * root 通道（KernelSU/Magisk）：apk_install 走 su -c pm install 装回设备，补全改 APK 闭环。
 * 坑 88 同源纪律：Magisk/KernelSU 的 su 落点不止 /system/bin/su（实测 OnePlus/Magisk 30.7 在
 * /product/bin/su→magisk，/system/bin/su 压根不存在）。写死单路径会把已 root 机误判成无 root、
 * 装回失败。发现面与 dsh-android-dev-tools 的 SU_CANDIDATES、壳侧 EngineManager 保持一致（改判据同改）。
 */
const SU_CANDIDATES = [
  '/system/bin/su', '/system/xbin/su', '/sbin/su', '/product/bin/su',
  '/product/xbin/su', '/vendor/bin/su', '/apex/com.android.runtime/bin/su', '/system_ext/bin/su',
];

function suBin() {
  for (const p of SU_CANDIDATES) { try { accessSync(p, constants.X_OK); return p; } catch { /* 继续下一个候选 */ } }
  return null;
}

/** 干净环境：避免 termux-exec LD_PRELOAD 污染 su 子进程（坑 22）。PATH 覆盖各 su 候选分区，
 *  使 magisk/su 起的内层 shell 能找到 /product/bin 等处的工具。 */
function cleanEnv() {
  return {
    PATH: '/system/bin:/system/xbin:/sbin:/product/bin:/product/xbin:/vendor/bin:/system_ext/bin:/system/usr/bin',
    LD_LIBRARY_PATH: '/system/lib64:/system/lib',
    LD_PRELOAD: '',
  };
}

async function runRoot(args, timeout, action) {
  const command = args[0] === '-c' ? String(args[1] ?? '') : args.join(' ');
  const su = suBin();
  // 无 root 通道时如实失败关闭（不猜路径、不把 ENOENT 烧成超时），给可执行的下一步。
  if (!su) {
    auditRoot(action || 'apk-install', command, 'no-su');
    return {
      ok: false, rootRequired: true,
      error: '无 root 通道：SU_CANDIDATES 全不命中（/system/bin/su、/product/bin/su、/vendor/bin/su 等），未执行 pm install。',
      hint: 'apk_install 需 KernelSU/Magisk 提权；确认设备已 root。su 落点可能不在 /system/bin（常见于 /product/bin/su→magisk），本工具发现面已覆盖 8 候选分区。',
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync(su, args, {
      env: cleanEnv(), timeout: timeout || 120000, maxBuffer: 16 * 1024 * 1024,
    });
    auditRoot(action || 'apk-install', command, 'ok');
    return { ok: true, su, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() };
  } catch (err) {
    auditRoot(action || 'apk-install', command, 'fail');
    return { ok: false, su, error: err.message, stderr: err.stderr ? String(err.stderr).trim() : '' };
  }
}

/** root 提权审计（对齐 root-ops/bridge：files/audit/audit.ndjson；命令不落全文）。 */
function auditRoot(action, command, result) {
  try {
    const dir = process.env.DSH_ROOT_AUDIT_PATH ?? '/data/user/0/com.dsharnessmobile.shell/files/audit';
    mkdirSync(dir, { recursive: true });
    const cmd = String(command ?? '');
    const entry = {
      ts: new Date().toISOString(),
      action,
      tool: 'apk-tools',
      result,
      cmdLen: cmd.length,
      cmdHash: createHash('sha256').update(cmd).digest('hex').slice(0, 16),
      cmdPreview: cmd.slice(0, 200),
    };
    appendFileSync(join(dir, 'audit.ndjson'), JSON.stringify(entry) + '\n');
    // 滚动截断：>2MB 保留尾部 500 行（2026-10-08 真机报告 B5；对齐 bridge/root-ops）
    try {
      const file = join(dir, 'audit.ndjson');
      if (statSync(file).size > 2 * 1024 * 1024) {
        const lines = readFileSync(file, 'utf8').split('\n');
        writeFileSync(file, lines.slice(-500).join('\n'));
      }
    } catch { /* 截断失败不阻断 */ }
  } catch { /* 审计失败不阻断 */ }
}

/** 单引号包裹 shell 参数，内部单引号按 POSIX 规则转义，防路径注入。 */
function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

function runtimePrefix() {
  return process.env.TERMUX__PREFIX || process.env.PREFIX || '/data/data/com.dsharnessmobile.shell/files/usr';
}

/** 宿主 home 目录（app 域 files/home）。 */
function homeDir() {
  return process.env.HOME || runtimePrefix().replace(/\/usr\/?$/, '') + '/home';
}

/**
 * Java 系工具统一 env：Termux openjdk 的 user.home / java.io.tmpdir 不读 HOME/TMPDIR env
 * （编译期硬编码 Termux 路径），必须经 JAVA_TOOL_OPTIONS 显式 -D 覆盖，否则 apktool
 * 建 framework 目录、buildResources createTempFile 均失败（坑 39）。
 */
function javaEnv() {
  const home = homeDir();
  return {
    ...process.env,
    JAVA_TOOL_OPTIONS: '-Duser.home=' + home + ' -Djava.io.tmpdir=' + home + '/tmp',
  };
}
function usrBin(name) { return runtimePrefix() + '/bin/' + name; }
function usrShare(name) { return runtimePrefix() + '/share/' + name; }

/** java 运行时路径：usr/bin/java（install-java-tools 或快照装配）。 */
function javaBin() { return usrBin('java'); }
/** keytool 运行时路径（openjdk-21，随 install-java-tools 落 usr/bin）。 */
function keytoolBin() { return usrBin('keytool'); }

/** debug keystore 固定落点（files/usr/.dsh/keystore/debug.keystore）。 */
function debugKeystoreDir() { return runtimePrefix() + '/.dsh/keystore'; }
function debugKeystore() { return debugKeystoreDir() + '/debug.keystore'; }

/**
 * 通用 keystore 生成：alias/storePass/keyPass/cn/outPath 可自定义；缺省即标准 Android debug keystore。
 * 已存在则直接复用（幂等）。
 */
async function genKeystore({ alias = 'androiddebugkey', storePass = 'android', keyPass = 'android', cn = 'CN=Android Debug,O=Android,C=US', outPath } = {}) {
  const ks = outPath || debugKeystore();
  if (existsSync(ks)) return { ok: true, keystore: ks, existed: true };
  if (!existsSync(keytoolBin())) {
    return { ok: false, error: 'keytool 不可用：请先运行 install-java-tools.sh 安装 openjdk-21' };
  }
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(ks), { recursive: true });
  const args = [
    '-genkeypair', '-v',
    '-keystore', ks,
    '-alias', alias,
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
    '-storepass', storePass, '-keypass', keyPass,
    '-dname', cn,
  ];
  try {
    await execFileAsync(keytoolBin(), args, { timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: javaEnv() });
    return { ok: true, keystore: ks };
  } catch (err) {
    return { ok: false, error: 'keytool 生成 keystore 失败：' + err.message };
  }
}

/** 确保 debug keystore 存在（genKeystore 缺省参数即 debug）。 */
async function ensureDebugKeystore() {
  return genKeystore();
}

/**
 * 解析某个工具的可执行调用：
 * 优先 usr/bin wrapper（install-java-tools.sh），回退 usr/share 内置 jar + java。
 * @param cpMain 非空时用 `java -cp <jar> <cpMain>`（jadx 等有主类的），否则 `java -jar <jar>`。
 * @returns {cmd, args, needsJava} 或 null（不可用）。
 */
function resolveTool(name, jarRel, cpMain) {
  const wrapper = usrBin(name);
  if (existsSync(wrapper)) return { cmd: wrapper, args: [], needsJava: false };
  const p = usrShare(jarRel);
  if (existsSync(javaBin()) && existsSync(p)) {
    if (cpMain) return { cmd: javaBin(), args: ['-cp', p, cpMain], needsJava: true };
    return { cmd: javaBin(), args: ['-jar', p], needsJava: true };
  }
  return null;
}

// 每个操作**实际依赖**的工具子集。旧的 `toolReady()` 一律要求 apktool+jadx+apksigner 三件套齐全，
// 于是 apk_build_sign（根本不碰 jadx）会被一个缺失的 jadx 挡死——而 jadx 已轻资产在线化，新装机上
// 大概率不在。这正是「签名名不副实、到构建那一步才炸」的真凶之一：门槛按 superset 卡、单操作被无关工具拖累。
const N_APKTOOL = ['apktool', 'apktool/apktool.jar', null];
// jadx 是官方 zip 的 bin/jadx 启动脚本（非 jar），离线兜底须走 `java -cp lib/*.jar jadx.cli.JadxCLI`。
const N_JADX = ['jadx', 'jadx/lib/jadx-1.5.0-all.jar', 'jadx.cli.JadxCLI'];
const N_APKSIGNER = ['apksigner', 'apksigner/apksigner.jar', null];

/** 给定需求子集，返回缺失项（java 缺席先记，再逐个 resolveTool 判）。 */
function missingFor(needs) {
  const missing = [];
  if (!existsSync(javaBin())) missing.push('java (openjdk-21)');
  for (const [name, jarRel, cpMain] of needs) {
    if (resolveTool(name, jarRel, cpMain) === null) missing.push(name);
  }
  return missing;
}

/** 全工具超集的缺失表（仅用于通用引导文案，不再作单操作的闸）。 */
function toolReady() {
  return missingFor([N_APKTOOL, N_JADX, N_APKSIGNER]);
}

function installGuide(missing = toolReady()) {
  return '缺少 ' + missing.join('、') + '。请先运行：install-java-tools.sh（快照 usr/bin 内，按需安装器）；jadx 亦可经 tool_install jadx 在线安装（轻资产：jadx 不再随 APK 内置）。注意这套 java/apktool/jadx/apksigner 跑在**宿主 Termux**（openjdk-21），不经 Ubuntu 容器——容器里没有 java 与此无关。';
}

/**
 * java「文件在场」不等于「能跑」（对齐坑 84 在场≠可用、坑 90 执行≠解析）：wrapper/软链在位，
 * 但 JVM 缺库、linker 拒载、或 JAVA_TOOL_OPTIONS 指错（坑 39）都会让 `java -jar` 在 apktool 建
 * framework、apksigner 签名的**构建中途**才炸。门槛处做一次有界 `java -version`，把「地基坏了」
 * 提前、如实归因，而不是让工具描述里的「Requires java」变成一次半途而废的构建。
 * 只在 java 文件确实在场时才有意义（missingFor 已先把「完全没装」摘出去）。
 */
async function javaFunctional() {
  const jb = javaBin();
  if (!existsSync(jb)) return { ok: false, state: 'absent' };
  try {
    const { stdout, stderr } = await execFileAsync(jb, ['-version'], {
      timeout: 30000, maxBuffer: 4 * 1024 * 1024, env: javaEnv(),
    });
    const first = String(stderr || stdout || '').split('\n')[0].trim();
    if (/version/i.test(first)) return { ok: true, state: 'ok', version: first };
    return { ok: false, state: 'no-version', detail: first || '(空输出)' };
  } catch (err) {
    const detail = `${err.message || ''}${err.stderr ? ' ' + String(err.stderr).trim() : ''}`.trim();
    return { ok: false, state: /Permission denied|EACCES|CANNOT LINK|exec format/i.test(detail) ? 'exec-refused' : 'exec-failed', detail: detail.slice(0, 400) };
  }
}

/**
 * 单操作前置闸：**只查该操作实际需要的工具**（needs）是否在场，再验 java 地基能跑。
 * 用 superset 会把无关的缺失（如 build_sign 撞上没装的 jadx）算成阻断，故必须按 needs 收口。
 */
async function apkToolchainGate(needs) {
  const missing = missingFor(needs);
  if (missing.length > 0) return { pass: false, kind: 'missing', guidance: installGuide(missing), missing };
  const j = await javaFunctional();
  if (!j.ok) {
    return {
      pass: false, kind: 'java-broken',
      error: `java 文件在场但跑不起来（state=${j.state}）：${j.detail || ''}`,
      guidance: 'apktool/jadx/apksigner 全依赖这个 java 运行时——地基跑不动，构建会在中途炸，故提前拦。' +
        '这套 java 在宿主 Termux（openjdk-21），与 Ubuntu 容器无关：重跑 install-java-tools.sh，或检查 ' +
        'JAVA_TOOL_OPTIONS 的 user.home/java.io.tmpdir（坑 39，指错会让 apktool 建 framework 失败）。',
    };
  }
  return { pass: true, javaVersion: j.version };
}

async function runTool(name, jarRel, args, timeout, cpMain) {
  const t = resolveTool(name, jarRel, cpMain);
  if (t === null) return { ok: false, error: installGuide() };
  try {
    const { stdout, stderr } = await execFileAsync(t.cmd, [...t.args, ...args], {
      timeout: timeout || 300000, maxBuffer: 64 * 1024 * 1024, env: javaEnv(),
    });
    return { ok: true, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() };
  } catch (err) {
    // jadx 在遇部分非致命资源/类解析警告时退出码为 3（或 2），但源码依然完整解出，不应判死
    if (name === 'jadx' && (err.code === 3 || err.code === 2)) {
      return { ok: true, stdout: String(err.stdout || '').trim(), stderr: String(err.stderr || '').trim(), warning: 'jadx finished with non-fatal errors' };
    }
    return { ok: false, error: err.message, stderr: err.stderr ? String(err.stderr).trim() : '' };
  }
}

function renderText(_a, v) {
  return [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }];
}

/** 解析 aapt2 dump badging 输出为结构化字段。 */
function parseBadging(badging) {
  const info = { permissions: [], nativeAbis: [] };
  const pkgMatch = badging.match(/^package: name='([^']*)' versionCode='([^']*)' versionName='([^']*)'/m);
  if (pkgMatch) {
    info.packageName = pkgMatch[1];
    info.versionCode = pkgMatch[2];
    info.versionName = pkgMatch[3];
  }
  const sdk = badging.match(/^sdkVersion:'([^']*)'/m);
  if (sdk) info.minSdkVersion = sdk[1];
  const target = badging.match(/^targetSdkVersion:'([^']*)'/m);
  if (target) info.targetSdkVersion = target[1];
  const label = badging.match(/^application-label:'([^']*)'/m);
  if (label) info.label = label[1];
  info.permissions = [...badging.matchAll(/^uses-permission: name='([^']*)'/gm)].map((m) => m[1]);
  const abis = [...badging.matchAll(/^native-code: (.*)$/gm)];
  if (abis.length > 0) {
    info.nativeAbis = abis.flatMap((m) => m[1].split(' ').map((s) => s.replace(/'/g, '')).filter(Boolean));
  }
  return info;
}

function tools() {
  const decompileTool = defineTool({
    name: 'apk_decompile',
    description:
      'Decompile an APK to smali (apktool) or Java source (jadx), or both. Runs on the HOST Termux ' +
      'openjdk toolchain (NOT the Ubuntu container — the container having no java is unrelated); ' +
      'requires a *working* java + apktool/jadx (install-java-tools.sh or built-in jar assets). The ' +
      'gate runs `java -version` up front, so a present-but-broken JVM is reported here instead of ' +
      'failing mid-decompile.',
    parameters: {
      apkPath: { type: 'string', required: true, description: 'Path to the target APK.' },
      outDir: { type: 'string', required: true, description: 'Output directory.' },
      mode: { type: 'string', enum: ['apktool', 'jadx', 'both'], description: 'Decompile engine.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ apkPath, outDir, mode = 'apktool' }) {
      const needs = mode === 'jadx' ? [N_JADX] : mode === 'both' ? [N_APKTOOL, N_JADX] : [N_APKTOOL];
      const gate = await apkToolchainGate(needs);
      if (!gate.pass) return gate.kind === 'missing'
        ? { ok: false, guidance: gate.guidance, missing: gate.missing }
        : { ok: false, error: gate.error, guidance: gate.guidance };
      if (mode === 'apktool') return runTool('apktool', 'apktool/apktool.jar', ['d', apkPath, '-o', outDir, '-f']);
      if (mode === 'jadx') return runTool('jadx', 'jadx/lib/jadx-1.5.0-all.jar', ['-d', outDir, apkPath], 300000, 'jadx.cli.JadxCLI');
      const r1 = await runTool('apktool', 'apktool/apktool.jar', ['d', apkPath, '-o', outDir + '/smali', '-f']);
      if (!r1.ok) return r1;
      return runTool('jadx', 'jadx/lib/jadx-1.5.0-all.jar', ['-d', outDir + '/src', apkPath], 300000, 'jadx.cli.JadxCLI');
    },
  });

  const buildSignTool = defineTool({
    name: 'apk_build_sign',
    description:
      'Rebuild an APK project directory (apktool b), then zipalign and debug-sign it (apksigner). ' +
      'Runs on the HOST Termux openjdk toolchain (NOT the Ubuntu container); requires a *working* ' +
      'java + apktool + apksigner (install-java-tools.sh or built-in assets). It does NOT need jadx — ' +
      'a missing jadx must not block signing. The gate runs `java -version` up front, so a ' +
      'present-but-broken JVM is reported here instead of exploding mid-sign.',
    parameters: {
      srcDir: { type: 'string', required: true, description: 'The APK project directory (from apk_decompile apktool).' },
      outApk: { type: 'string', required: true, description: 'Output signed APK path.' },
      keystore: { type: 'string', description: 'Custom keystore path (default: auto-generated debug keystore).' },
      ksAlias: { type: 'string', description: 'Key alias (default androiddebugkey).' },
      ksPass: { type: 'string', description: 'Keystore password (default android).' },
      keyPass: { type: 'string', description: 'Key password (default android).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ srcDir, outApk, keystore, ksAlias = 'androiddebugkey', ksPass = 'android', keyPass = 'android' }) {
      // 只需 apktool + apksigner（zipalign 可选）——不含 jadx，缺 jadx 不该挡住签名（坑 91）。
      const gate = await apkToolchainGate([N_APKTOOL, N_APKSIGNER]);
      if (!gate.pass) return gate.kind === 'missing'
        ? { ok: false, guidance: gate.guidance, missing: gate.missing }
        : { ok: false, error: gate.error, guidance: gate.guidance };
      const unsigned = outApk + '.unsigned.apk';
      const aligned = outApk + '.aligned.apk';
      const r1 = await runTool('apktool', 'apktool/apktool.jar', ['b', srcDir, '-o', unsigned]);
      if (!r1.ok) return r1;
      let keystorePath = keystore;
      if (!keystorePath) {
        const ks = await ensureDebugKeystore();
        if (!ks.ok) return ks;
        keystorePath = ks.keystore;
      } else if (!existsSync(keystorePath)) {
        return { ok: false, error: 'keystore 不存在：' + keystorePath };
      }
      // zipalign 可选（usr/bin 或 usr/share；无则直接签未对齐包）
      const z = usrBin('zipalign');
      const signArgs = ['sign', '--ks', keystorePath, '--ks-key-alias', ksAlias, '--ks-pass', 'pass:' + ksPass, '--key-pass', 'pass:' + keyPass, '--out', outApk];
      if (existsSync(z)) {
        const r2 = await runTool('zipalign', 'zipalign/zipalign', ['-v', '-p', '4', unsigned, aligned]);
        if (!r2.ok) return r2;
        const r3 = await runTool('apksigner', 'apksigner/apksigner.jar', [...signArgs, aligned]);
        if (r3.ok) { const { rmSync } = await import('node:fs'); try { rmSync(unsigned); rmSync(aligned); } catch {} }
        return r3;
      }
      const r3 = await runTool('apksigner', 'apksigner/apksigner.jar', [...signArgs, unsigned]);
      if (r3.ok) { const { rmSync } = await import('node:fs'); try { rmSync(unsigned); } catch {} }
      return r3;
    },
  });

  const infoTool = defineTool({
    name: 'apk_info',
    description:
      'Inspect an APK metadata: package name, version, min/target SDK, permissions, native ABIs, ' +
      'and signing certificate. Uses aapt2 dump badging + apksigner verify --print-certs (host Termux).',
    parameters: {
      apkPath: { type: 'string', required: true, description: 'Path to the target APK.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ apkPath }) {
      const aapt2 = usrBin('aapt2');
      if (!existsSync(aapt2)) {
        return { ok: false, guidance: installGuide(), missing: ['aapt2'] };
      }
      let badging;
      try {
        const { stdout } = await execFileAsync(aapt2, ['dump', 'badging', apkPath], {
          timeout: 60000, maxBuffer: 16 * 1024 * 1024,
        });
        badging = stdout;
      } catch (err) {
        return { ok: false, error: 'aapt2 dump badging 失败：' + err.message + (err.stderr ? ' ' + String(err.stderr).trim() : '') };
      }
      const info = parseBadging(badging || '');
      const signer = resolveTool('apksigner', 'apksigner/apksigner.jar');
      if (signer) {
        try {
          const { stdout } = await execFileAsync(signer.cmd, [...signer.args, 'verify', '--print-certs', apkPath], {
            timeout: 60000, maxBuffer: 16 * 1024 * 1024, env: javaEnv(),
          });
          info.signingCertificates = (stdout || '').trim();
        } catch (err) {
          info.signingCertificates = 'verify 失败：' + err.message;
        }
      } else {
        info.signingCertificates = 'apksigner 不可用，跳过签名校验';
      }
      return { ok: true, ...info };
    },
  });

  const keystoreGenTool = defineTool({
    name: 'keystore_gen',
    description:
      'Generate a signing keystore (keytool). Defaults to a standard Android debug keystore; ' +
      'customize alias/storePass/keyPass/cn/outPath for release signing.',
    parameters: {
      alias: { type: 'string', description: 'Key alias (default androiddebugkey).' },
      storePass: { type: 'string', description: 'Keystore password (default android).' },
      keyPass: { type: 'string', description: 'Key password (default android).' },
      cn: { type: 'string', description: 'Distinguished name CN (default CN=Android Debug,O=Android,C=US).' },
      outPath: { type: 'string', description: 'Output keystore path (default usr/.dsh/keystore/debug.keystore).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute(params = {}) {
      return genKeystore(params);
    },
  });

  const installTool = defineTool({
    name: 'apk_install',
    description:
      'Install a signed APK onto the device via root (su -c pm install). Completes the ' +
      'decompile → rebuild → sign → install loop. Requires a working su (KernelSU/Magisk) — 落点经 ' +
      'SU_CANDIDATES 8 候选发现（不止 /system/bin/su；坑 88）。apkPath must be an absolute device-visible path.',
    parameters: {
      apkPath: { type: 'string', required: true, description: 'Absolute path to the signed APK.' },
      flags: { type: 'string', description: 'Extra pm install flags (default "-r -t"; e.g. "-r -d" to downgrade).' },
      user: { type: 'string', description: 'Target user id (default none; e.g. "0").' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ apkPath, flags = '-r -t', user }) {
      // flags/user 走白名单校验，防命令注入（仅 pm install 合法 flag 字符 / 数字用户）。
      if (!/^[a-zA-Z0-9\-\s]*$/.test(flags)) {
        return { ok: false, error: 'flags 仅允许字母/数字/连字符/空格' };
      }
      if (user !== undefined && !/^\d+$/.test(String(user))) {
        return { ok: false, error: 'user 仅允许数字' };
      }
      const userArg = user ? `--user ${user}` : '';
      const cmd = `/system/bin/pm install ${flags} ${userArg} ${shellQuote(apkPath)} 2>&1`;
      const r = await runRoot(['-c', cmd], null, 'apk-install');
      // pm install 失败经 stdout「Failure [reason]」而非退出码反馈（pm 是 java 进程，恒 exit 0）。
      const success = r.ok && /^Success\b/m.test(r.stdout || '');
      if (r.ok) {
        r.success = success;
        if (!success) r.error = (r.stdout || '').split('\n').find((l) => l.trim()) || 'unknown install failure';
      }
      return r;
    },
  });

  const smaliFindTool = defineTool({
    name: 'smali_find',
    description:
      'Search decompiled smali source (apktool output) for a string or ERE regex, returning ' +
      'file:line matches. Use it to locate code to patch before smali_edit.',
    parameters: {
      dir: { type: 'string', required: true, description: 'Root dir of smali source (e.g. apktool output).' },
      pattern: { type: 'string', required: true, description: 'String or ERE regex to search (grep -E).' },
      maxResults: { type: 'number', description: 'Max matches to return (default 50).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ dir, pattern, maxResults = 50 }) {
      if (!existsSync(dir)) return { ok: false, error: 'smali 目录不存在：' + dir };
      const n = Math.max(1, Math.min(Number(maxResults) || 50, 500));
      try {
        const { stdout } = await execFileAsync('grep', ['-rEn', '--include=*.smali', '--', pattern, dir], {
          timeout: 120000, maxBuffer: 16 * 1024 * 1024,
        });
        // 冒号解析防 NaN（2026-10 第三轮复盘）：.smali 含 NUL/非 UTF-8 字节时 grep 输出
        // "Binary file ... matches"（无冒号）→ Number('')=NaN 成员被 lossless 序列化整值拒收。
        // 无冒号行/非有限行号跳过或降级 0。
        const matches = (stdout || '').split('\n').filter(Boolean).slice(0, n).map((line) => {
          const i = line.indexOf(':');
          if (i <= 0) return null;
          const rest = line.slice(i + 1);
          const j = rest.indexOf(':');
          if (j <= 0) return null;
          const lineNumber = Number(rest.slice(0, j));
          return { file: line.slice(0, i), lineNumber: Number.isFinite(lineNumber) ? lineNumber : 0, text: rest.slice(j + 1) };
        }).filter(Boolean);
        return { ok: true, count: matches.length, matches };
      } catch (err) {
        if (err.code === 1) return { ok: true, count: 0, matches: [] };
        return { ok: false, error: 'grep 失败：' + err.message };
      }
    },
  });

  const smaliEditTool = defineTool({
    name: 'smali_edit',
    description:
      'Edit a smali file by replacing a literal string (find) with another (replace). Literal ' +
      '(no regex); writes back in place and keeps a .bak backup. Use smali_find first to locate.',
    parameters: {
      file: { type: 'string', required: true, description: 'Path to the smali file to edit.' },
      find: { type: 'string', required: true, description: 'Literal text to replace.' },
      replace: { type: 'string', required: true, description: 'Replacement text.' },
      all: { type: 'boolean', description: 'Replace all occurrences (default false; find must be unique).' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderText },
    async execute({ file, find, replace, all = false }) {
      if (!find) return { ok: false, error: 'find 不能为空' };
      if (!existsSync(file)) return { ok: false, error: '文件不存在：' + file };
      const { readFileSync, writeFileSync, copyFileSync } = await import('node:fs');
      const content = readFileSync(file, 'utf8');
      const count = content.split(find).length - 1;
      if (count === 0) return { ok: false, error: '未找到目标文本：' + find.slice(0, 80) };
      if (!all && count > 1) {
        return { ok: false, error: `目标文本出现 ${count} 次，请提供更精确的 find 或设置 all=true` };
      }
      try { copyFileSync(file, file + '.bak'); } catch {}
      // 用函数作 replace 第二参，避免 $ 序列（$& $1 等）在 smali 代码里被特殊展开。
      const next = all ? content.split(find).join(replace) : content.replace(find, () => replace);
      writeFileSync(file, next, 'utf8');
      return { ok: true, replaced: all ? count : 1, backup: file + '.bak' };
    },
  });

  return [decompileTool, buildSignTool, infoTool, keystoreGenTool, installTool, smaliFindTool, smaliEditTool];
}

// C 方案：显式声明 tools 硬依赖（对齐 bridge/manage），修复 ctx.get('tools') 静默 undefined。
export const inject = ['tools'];

export function apply(ctx) {
  for (const t of tools())
    ctx.tools.register(t);
}
