// Vendored JS shim for node-addon-require-builtin on android-arm64 (坑 69).
//
// Background: node-addon-native-custom-loader resolves its native binding via
// candidate paths, first of which is the optional package
// `node-addon-require-builtin-<os>-<cpu>`. Upstream never ships an
// android-arm64 prebuilt, the workspace/`../android-arm64` and local build
// candidates don't exist inside the device snapshot, so every engine start
// dies with ERR_MODULE_NOT_FOUND / binding validation failure on the phone.
//
// The shell launches the engine with `--expose-internals` (EngineManager.kt),
// so a pure-JS shim can legitimately provide the three duck-typed exports the
// validator expects (requireBuiltin / isAllowedInternalId /
// getNativeBindingInfo) by delegating to node's own internal module registry.
// The allow-list is restricted to internal/modules/* — the same surface the
// native binding exposes — so the shim never widens what engine code can
// require.
'use strict';

const ALLOWED_INTERNAL_IDS = new Set([
  'internal/modules/cjs/loader',
  'internal/modules/cjs/helpers',
  'internal/modules/esm/loader',
  'internal/modules/esm/utils',
  'internal/modules/esm/resolve',
]);

function isAllowedInternalId(moduleId) {
  if (typeof moduleId !== 'string') return false;
  if (ALLOWED_INTERNAL_IDS.has(moduleId)) return true;
  return moduleId.startsWith('internal/modules/');
}

function requireBuiltin(moduleId) {
  if (!isAllowedInternalId(moduleId)) {
    throw new Error(`require-builtin shim: internal id not allowed: ${moduleId}`);
  }
  return require(moduleId);
}

function getNativeBindingInfo() {
  return Object.freeze({
    mode: 'js-shim',
    product: 'require-builtin',
    backend: 'napi',
    abi: 'napi-v9',
  });
}

module.exports = { requireBuiltin, isAllowedInternalId, getNativeBindingInfo };
module.exports.default = module.exports;
