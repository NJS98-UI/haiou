/**
 * Android stub for the POSIX flock entry. Android's Node build reports
 * `process.platform === 'android'`, for which @deepseek-ai/node-addon-system
 * ships no prebuilt Node-API addon, so the upstream loader threw
 * ERR_FLOCK_UNSUPPORTED_PLATFORM and every session write lease failed.
 * The engine is a single process here, so its in-process write claim already
 * excludes every writer — the same rationale upstream documents for the browser
 * worker stub (see dsh-session-persistence-jsonl/lease).
 */
export async function tryLockExclusive(fd) {
    if (!Number.isInteger(fd) || fd < 0) {
        throw Object.assign(new Error('EBADF: flock failed'), {
            code: 'EBADF',
            errno: 9,
            syscall: 'flock',
        });
    }
}
