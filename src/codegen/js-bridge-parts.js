/**
 * @fileoverview Template string fragments for the JS bridge generator.
 *
 * All bridge string pieces are kept here so the bridge source is composed from
 * named constants rather than inline concatenation in js-bridge.js.
 */

// ── Externref table ───────────────────────────────────────────────────────────

export const BRIDGE_EXT_TABLE = `\
const _ext = [null];
const _extFree = [];
const _extRefCount = [0];
const _extSet = (obj) => {
  if (obj == null) return 0;
  if (_extFree.length) {
    const i = _extFree.pop();
    _ext[i] = obj; _extRefCount[i] = 1; return i;
  }
  _ext.push(obj); _extRefCount.push(1);
  return _ext.length - 1;
};
const _extGet = (i) => _ext[i];
const _extInc = (i) => { if (i !== 0) _extRefCount[i]++; };
const _extDel = (i) => {
  if (i === 0) return;
  if (--_extRefCount[i] <= 0) { _ext[i] = null; _extFree.push(i); }
};
`;

// ── String codec ──────────────────────────────────────────────────────────────

export const BRIDGE_STRING_CODEC = `\
const _enc = new TextEncoder();
const _dec = new TextDecoder();
const _scratch = new Uint8Array(4096);
const _strCache = new Map();
let _heapBase = 0;
let _ex;

const _writeStr = (s) => {
  if (s == null) return [0, 0];
  const ascii = s.length <= 4096 && !s.split('').some(c => c.charCodeAt(0) > 127);
  if (ascii) {
    const ptr = _ex.__jswat_alloc_raw(s.length);
    const m = new Uint8Array(_ex.memory.buffer);
    for (let i = 0; i < s.length; i++) m[ptr + i] = s.charCodeAt(i);
    return [ptr, s.length];
  }
  const r = _enc.encodeInto(s, _scratch);
  if (r.written <= 4096) {
    const ptr = _ex.__jswat_alloc_raw(r.written);
    new Uint8Array(_ex.memory.buffer).set(_scratch.subarray(0, r.written), ptr);
    return [ptr, r.written];
  }
  const b = _enc.encode(s);
  const ptr = _ex.__jswat_alloc_raw(b.length);
  new Uint8Array(_ex.memory.buffer).set(b, ptr);
  return [ptr, b.length];
};

const _readStr = (ptr, len) => {
  if (ptr === 0) return null;
  if (ptr < _heapBase) {
    const k = (ptr * 65536 + len) | 0;
    if (_strCache.has(k)) return _strCache.get(k);
    const s = _dec.decode(new Uint8Array(_ex.memory.buffer, ptr, len));
    _strCache.set(k, s); return s;
  }
  return _dec.decode(new Uint8Array(_ex.memory.buffer, ptr, len));
};
`;

// ── Node.js env hooks (io/fs/clock/random/process) ───────────────────────────

export const BRIDGE_ENV_NODE = `\
const _isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
const _fs = _isNode ? (await import('fs')) : null;
const _crypto = _isNode ? (await import('crypto')) : null;

const _envHooks = {
  __jswat_io_write: (ptr, len, fd) => {
    const buf = Buffer.from(_ex.memory.buffer, ptr, len);
    if (fd === 2) process.stderr.write(buf);
    else process.stdout.write(buf);
  },
  __jswat_console_error: (ptr, len) => {
    console.error(_readStr(ptr, len));
  },
  __jswat_stderr_write: (ptr, len) => {
    throw new Error(_readStr(ptr, len));
  },
  __jswat_io_read: (buf, maxLen) => {
    // Synchronous stdin read via fd 0 (Node.js).
    if (!_fs) return 0;
    try {
      const tmp = Buffer.alloc(maxLen);
      const n = _fs.readSync(0, tmp, 0, maxLen);
      if (n > 0) new Uint8Array(_ex.memory.buffer).set(tmp.subarray(0, n), buf);
      return n;
    } catch { return 0; }
  },
  __jswat_clock_now: () => Date.now() | 0,
  __jswat_clock_monotonic: () => (performance.now() * 1e6) | 0,
  random_get: (ptr, len) => {
    const arr = new Uint8Array(_ex.memory.buffer, ptr, len);
    if (_crypto) _crypto.randomFillSync(arr);
    else if (typeof crypto !== 'undefined') crypto.getRandomValues(arr);
    return 0;
  },
  proc_exit: (code) => {
    if (_isNode) process.exit(code);
    throw new Error('proc_exit(' + code + ')');
  },
  __jswat_fs_read: (pathPtr, pathLen) => {
    if (!_fs) { _ex.__str_len_out.value = 0; return 0; }
    try {
      const path = _readStr(pathPtr, pathLen);
      const content = _fs.readFileSync(path);
      const ptr = _ex.__jswat_alloc_raw(content.length);
      new Uint8Array(_ex.memory.buffer).set(content, ptr);
      _ex.__str_len_out.value = content.length;
      return ptr;
    } catch { _ex.__str_len_out.value = 0; return 0; }
  },
  __jswat_fs_write: (pathPtr, pathLen, contentPtr, contentLen) => {
    if (!_fs) return 0;
    try {
      const path = _readStr(pathPtr, pathLen);
      const data = new Uint8Array(_ex.memory.buffer, contentPtr, contentLen);
      _fs.writeFileSync(path, data);
      return 1;
    } catch { return 0; }
  },
  __jswat_fs_append: (pathPtr, pathLen, contentPtr, contentLen) => {
    if (!_fs) return 0;
    try {
      const path = _readStr(pathPtr, pathLen);
      const data = new Uint8Array(_ex.memory.buffer, contentPtr, contentLen);
      _fs.appendFileSync(path, data);
      return 1;
    } catch { return 0; }
  },
  __jswat_fs_exists: (pathPtr, pathLen) => {
    if (!_fs) return 0;
    try {
      const path = _readStr(pathPtr, pathLen);
      return _fs.existsSync(path) ? 1 : 0;
    } catch { return 0; }
  },
  __jswat_fs_delete: (pathPtr, pathLen) => {
    if (!_fs) return 0;
    try {
      const path = _readStr(pathPtr, pathLen);
      _fs.unlinkSync(path);
      return 1;
    } catch { return 0; }
  },
  __jswat_fs_mkdir: (pathPtr, pathLen) => {
    if (!_fs) return 0;
    try {
      const path = _readStr(pathPtr, pathLen);
      _fs.mkdirSync(path, { recursive: true });
      return 1;
    } catch { return 0; }
  },
  __jswat_fs_readdir: (pathPtr, pathLen) => {
    if (!_fs) { _ex.__str_len_out.value = 0; return 0; }
    try {
      const path = _readStr(pathPtr, pathLen);
      const entries = _fs.readdirSync(path);
      const json = JSON.stringify(entries);
      const bytes = _enc.encode(json);
      const ptr = _ex.__jswat_alloc_raw(bytes.length);
      new Uint8Array(_ex.memory.buffer).set(bytes, ptr);
      _ex.__str_len_out.value = bytes.length;
      return ptr;
    } catch { _ex.__str_len_out.value = 0; return 0; }
  },
};
`;

// ── WASM init (with sidecar .wasm file) — ESM variant ────────────────────────

export const BRIDGE_INIT_ESM_SIDECAR = (wasmFilename) => `\
const _wasmUrl = new URL('./${wasmFilename}', import.meta.url);
const _wasmBytes = typeof process !== 'undefined'
  ? (await import('fs')).readFileSync(_wasmUrl)
  : await fetch(_wasmUrl).then(r => r.arrayBuffer());
const _memory = new WebAssembly.Memory({ initial: 1, maximum: 256 });
const _imports = { env: { memory: _memory, ..._envHooks } };
const { instance: _inst } = await WebAssembly.instantiate(_wasmBytes, _imports);
_ex = _inst.exports;
_heapBase = _ex.__jswat_heap_base?.value ?? 0;
_ex.__jswat_init?.();
`;

// ── WASM init (with sidecar .wasm file) — CJS variant ────────────────────────

export const BRIDGE_INIT_CJS_SIDECAR = (wasmFilename) => `\
const _path = require('path');
const _wasmBytes = require('fs').readFileSync(_path.join(__dirname, '${wasmFilename}'));
const _memory = new WebAssembly.Memory({ initial: 1, maximum: 256 });
const _imports = { env: { memory: _memory, ..._envHooks } };
const { instance: _inst } = await WebAssembly.instantiate(_wasmBytes, _imports);
_ex = _inst.exports;
_heapBase = _ex.__jswat_heap_base?.value ?? 0;
_ex.__jswat_init?.();
`;

// ── WASM init (inline base64 bundle) ─────────────────────────────────────────

export const BRIDGE_INIT_BUNDLE = (base64Bytes) => `\
const _b64 = '${base64Bytes}';
const _wasmBytes = Uint8Array.from(atob(_b64), c => c.charCodeAt(0));
const _memory = new WebAssembly.Memory({ initial: 1, maximum: 256 });
const _imports = { env: { memory: _memory, ..._envHooks } };
const { instance: _inst } = await WebAssembly.instantiate(_wasmBytes, _imports);
_ex = _inst.exports;
_heapBase = _ex.__jswat_heap_base?.value ?? 0;
_ex.__jswat_init?.();
`;
