#!/bin/bash
# ==============================================================================
# launch_ubuntu_proot.sh - Ubuntu 容器启动器（root chroot 优先，proot fallback）
# 兼容 Android 8.0 - 15；有 KernelSU/Magisk su 时直接用 root chroot，绕开 proot。
# ==============================================================================
PREFIX="${PREFIX:-/data/data/com.dsharnessmobile.shell/files/usr}"
HOME_DIR="${HOME:-/data/data/com.dsharnessmobile.shell/files/home}"
UBUNTU_ROOT="${HOME_DIR}/.dsh/ubuntu-rootfs"
PROOT_BIN="${PREFIX}/share/operit-native/proot"

if [ ! -d "${UBUNTU_ROOT}" ]; then
    echo "[Seagull Error] Ubuntu rootfs not found at ${UBUNTU_ROOT}"
    # 壳侧容器探针判死时会主动跳过 307MB rootfs 解压（非缺陷、非中断），这里把原因摊开，
    # 免得运维把它读成「解压坏了」。探针文件与插件 ubuntu_status/ubuntu_exec 共用同一 schema。
    if [ -f "${HOME_DIR}/.dsh/ubuntu-container-probe.json" ]; then
        echo "[Seagull Info] 容器探针结论: $(head -c 400 "${HOME_DIR}/.dsh/ubuntu-container-probe.json")"
    fi
    exit 1
fi

# 提取命令：兼容 `-lc CMD`（ubuntu_exec 默认）与直接 `CMD...`。
if [ "${1:-}" = "-lc" ] || [ "${1:-}" = "-c" ]; then
    CMD="${2:-}"
else
    CMD="$*"
fi

# ---- Root chroot 路径（KernelSU/Magisk su 可用时；候选见 EngineManager.SU_CANDIDATES，Magisk 常在 /system/bin 之外）----
SU=""
for _su in /system/bin/su /system/xbin/su /sbin/su /product/bin/su /product/xbin/su /vendor/bin/su /apex/com.android.runtime/bin/su /system_ext/bin/su; do
    [ -x "$_su" ] && SU="$_su" && break
done
[ -n "$SU" ] || SU="$(command -v su 2>/dev/null || true)"
if [ -n "$SU" ]; then
    CMD_B64="$(printf '%s' "$CMD" | base64 | tr -d '\n')"
    exec "$SU" -c "export PATH=/system/bin:/system/xbin:/product/bin:/system/usr/bin; export LD_LIBRARY_PATH=/system/lib64:/system/lib; export LD_PRELOAD=; R='$UBUNTU_ROOT'; mount -t proc proc \"\$R/proc\" 2>/dev/null; mount -t sysfs sys \"\$R/sys\" 2>/dev/null; mount -o bind /dev \"\$R/dev\" 2>/dev/null; mount -t devpts devpts \"\$R/dev/pts\" 2>/dev/null; mkdir -p \"\$R/tmp\" \"\$R/run\"; chmod 1777 \"\$R/tmp\" 2>/dev/null; if ! grep -E '^[[:space:]]*nameserver' \"\$R/etc/resolv.conf\" 2>/dev/null | grep -qv '127\.'; then rm -f \"\$R/etc/resolv.conf\"; printf 'nameserver 8.8.8.8\nnameserver 114.114.114.114\n' > \"\$R/etc/resolv.conf\"; fi; C=\$(printf '%s' '$CMD_B64' | base64 -d 2>/dev/null); exec chroot \"\$R\" /usr/bin/env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/root TERM=xterm LANG=C.UTF-8 TMPDIR=/tmp /bin/bash -lc \"\$C\""
fi

# ---- proot fallback ----
# 初始化虚假 sysdata（Android 内核 /proc/stat 缺桌面字段，容器内 nproc/ps/CMake 会读 0 核）
"${HOME_DIR}/.dsh/scripts/setup_fake_sysdata.sh" "${UBUNTU_ROOT}" 2>/dev/null || true
# PROOT_TMP_DIR 要的是「能建出来且可写」的目录：TMPDIR 由壳侧 shellEnv() 注入（files/home/tmp），
# 但该目录可能被清理器删掉；旧写法 mkdir -p 失败也照样把路径交给 proot，于是 proot 只吐一句
# can't chmod '<...>/proot-XXXX': No such file or directory，把真实故障（执行被拒/目录缺失）盖掉。
# 逐个候选确认存在+可写，取第一个成立的；全失败就直说临时目录问题，不再伪装成 proot 的错。
for _cand in "${TMPDIR:-}" "$HOME_DIR/.dsh/tmp" "$HOME_DIR/tmp"; do
    [ -n "$_cand" ] || continue
    if mkdir -p "$_cand" 2>/dev/null && [ -d "$_cand" ] && [ -w "$_cand" ]; then export PROOT_TMP_DIR="$_cand"; break; fi
done
if [ -z "${PROOT_TMP_DIR:-}" ]; then
    echo "launch_ubuntu_proot: 没有可用临时目录（TMPDIR=${TMPDIR:-<空>} HOME=$HOME_DIR）——先修目录再谈容器" >&2
    exit 1
fi
# 自包含 Operit proot：loader 与 proot 同目录（usr/share/operit-native），用 PROOT_LOADER 显式指定
export PROOT_LOADER="${PROOT_LOADER:-${PREFIX}/share/operit-native/loader}"
# 清理 termux-exec 的 execve 拦截（会把 guest 路径改写成宿主 PREFIX 路径，导致 proot execve 失败）
unset LD_PRELOAD TERMUX_EXEC__EXECVE_CALL__INTERCEPT TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE TERMUX_EXEC__PROC_SELF_EXE

exec "${PROOT_BIN}" \
    --link2symlink \
    --kill-on-exit \
    -0 \
    -r "${UBUNTU_ROOT}" \
    -b /dev \
    -b /proc \
    -b /sys \
    -b "${UBUNTU_ROOT}/proc/.stat:/proc/stat" \
    -b "${UBUNTU_ROOT}/proc/.loadavg:/proc/loadavg" \
    -b "${UBUNTU_ROOT}/proc/.uptime:/proc/uptime" \
    -b "${UBUNTU_ROOT}/proc/.version:/proc/version" \
    -b /storage \
    -b "${HOME_DIR}:${HOME_DIR}" \
    -w "${HOME_DIR}" \
    /bin/bash "$@"
