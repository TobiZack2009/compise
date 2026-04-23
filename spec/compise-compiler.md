# Compise Compiler Reference

> Implementation reference for the Compise compiler.
> Covers WASM type mappings, object header layout, memory model,
> calling convention, runtime internals, tree-shaking, JS bridge
> architecture, `.jsbind.js` processing, CLI, and compiler test pragmas.

*See also: [compise-spec.md](compise-spec.md) — Language Spec | [compise-std.md](compise-std.md) — Standard Library*

The compiler CLI is `jswat` — preserved for compatibility.

---

## Targets

| Target | `_start` | WASI imports | `__jswat_init` | Output format |
|---|---|---|---|---|
| `wasm32-wasip1` | exported | `wasi_snapshot_preview1.*` | not exported | core module |
| `wasm32-unknown` | not exported | none | always exported | core module |
| `wasm32-ld` | via `__wasm_call_ctors` | `wasi_snapshot_preview1.*` (unresolved) | not exported | relocatable object |
| `wasm32-component` | component model | WIT interfaces | not exported | WASM component |
| `wasm32-js-esm` | not exported | JS bridge | always exported | JS ESM + `.wasm` sidecar |
| `wasm32-js-cjs` | not exported | JS bridge | always exported | JS CJS + `.wasm` sidecar |
| `wasm32-js-bundle` | not exported | JS bridge | always exported | single JS file, WASM inlined |

**Compile-time target globals** (folded by Level 5 DCE):

```
__target_wasip1    = 1 on wasm32-wasip1,    0 elsewhere
__target_unknown   = 1 on wasm32-unknown,   0 elsewhere
__target_ld        = 1 on wasm32-ld,        0 elsewhere
__target_component = 1 on wasm32-component, 0 elsewhere
__target_js        = 1 on all wasm32-js-*,  0 elsewhere
__wasi_available   = 1 on wasip1 and ld,    0 elsewhere
__component        = 1 on wasm32-component, 0 elsewhere
```

---

## WASM Type Mappings

**In registers / function signatures:**

| Compise type | WASM type | Notes |
|---|---|---|
| `bool` | `i32` | 0 = false, 1 = true |
| `i8` | `i32` | sign-extended on load |
| `u8` | `i32` | zero-extended on load |
| `i16` | `i32` | sign-extended on load |
| `u16` | `i32` | zero-extended on load |
| `i32`, `u32` | `i32` | native |
| `i64`, `u64` | `i64` | native |
| `isize`, `usize` | `i32` (WASM32) | pointer-sized — `i64` on future WASM64 targets |
| `f32` | `f32` | native |
| `f64` | `f64` | native |
| `str` | `(i32, i32)` | fat pointer: data_ptr + len. Null when data_ptr = 0 |
| `String` | `i32` | heap pointer or 0 |
| class instance | `i32` | heap pointer or 0 |
| array | `i32` | header pointer or 0 |
| `Box<T>` | `i32` | heap pointer or 0 |
| `List<T>` | `i32` | header pointer or 0 |
| `null` | `i32` | always 0 |
| `Option(T)` | `(T_wasm, i32)` | value + is_null flag |
| `ListView<T>` | `(i32, i32)` | data_ptr + length |
| function value | `(i32, i32)` | fn_index + env_ptr |
| `JSObject` | `i32` | externref table index, 0 = null |
| `JSFn<sig>` | `i32` | externref table index, 0 = null |
| `JSSymbol` | `i32` | externref table index, 0 = null |
| `JSValue` | `(i32, i64)` | tag + payload — see JSValue Wire Format |
| ZST | `i32` | singleton pointer — compile-time constant |
| `undefined` | — | zero WASM return values |
| `enum` | underlying primitive WASM type | e.g. `isize` → `i32` on WASM32 |

**In memory (struct fields, array elements):**

| Compise type | Memory size | Load | Store |
|---|---|---|---|
| `bool` | 1 byte | `i32.load8_u` | `i32.store8` |
| `i8` | 1 byte | `i32.load8_s` | `i32.store8` |
| `u8` | 1 byte | `i32.load8_u` | `i32.store8` |
| `i16` | 2 bytes | `i32.load16_s` | `i32.store16` |
| `u16` | 2 bytes | `i32.load16_u` | `i32.store16` |
| `i32`, `u32` | 4 bytes | `i32.load` | `i32.store` |
| `i64`, `u64` | 8 bytes | `i64.load` | `i64.store` |
| `isize`, `usize` | 4 bytes (WASM32) | `i32.load` | `i32.store` |
| `f32` | 4 bytes | `f32.load` | `f32.store` |
| `f64` | 8 bytes | `f64.load` | `f64.store` |
| heap pointer | 4 bytes (WASM32) | `i32.load` | `i32.store` |
| `str` in struct | 8 bytes (two usize) | two loads | two stores |
| `Option(isize)` in struct | 8 bytes (4+4) | two loads | two stores |
| `Option(f64)` in struct | 16 bytes (8+8) | two loads | two stores |
| `ListView<T>` in struct | 8 bytes (two usize) | two loads | two stores |
| `JSObject`/`JSFn`/`JSSymbol` in struct | 4 bytes | `i32.load` | `i32.store` |
| `JSValue` in struct | 12 bytes (4 + 8) | three loads | three stores |
| `$generic()` field | 0 bytes | — | — |
| ZST field | 4 bytes | `i32.load` | `i32.store` |

---

## Calling Convention

**Simple scalars:**

```js
function add(a = isize(0), b = isize(0)) { return a + b; }
// WASM: (func (param i32 i32) (result i32))
```

**Two-word values:**

```js
function takeStr(s = "") { return s.length; }
// WASM: (func (param i32 i32) (result i32))  — data_ptr + len

function sumOpts(a = Option(isize), b = Option(isize)) { return (a ?? isize(0)) + (b ?? isize(0)); }
// WASM: (func (param i32 i32 i32 i32) (result i32))

function processVal(v = JSValue) { return v.isNullish(); }
// WASM: (func (param i32 i64) (result i32))  — tag + payload
```

**`JSObject`/`JSFn`/`JSSymbol` — single `i32`:**

```js
function handleEl(el = JSObject) { return el.getStr("id"); }
// WASM: (func (param i32) (result i32 i32))  — i32 extref in, str (i32,i32) out
```

**`undefined` return — zero WASM return values:**

```js
function log(msg = "") { console.log(msg); }
// WASM: (func (param i32 i32))  — no result
```

**ZST parameters — compile-time constant `i32`:**

```js
function handle(e = Click) { ... }
// WASM: (func (param i32))  — always the singleton pointer
```

**Multiple return values — sret pointer:**

When a function returns a class instance, the caller allocates space and passes a hidden sret pointer as the first parameter. Two-word values (`str`, `ListView<T>`, `Option(T)`, `JSValue`, function values) return as multiple WASM return values natively — no sret needed.

**`JSFn` calls** generate a dedicated WASM import per call signature: `__jswat_call_jsfn_<encoded_sig>`. Different signatures produce different imports.

**RC across call boundary:** Passing a GC heap value to a function increments its RC at the call site and decrements after return. ZSTs — RC operation skipped (singleton, never freed). Manual objects (`0xFFFFFFFF` sentinel) — RC check skipped. `JSObject`/`JSFn`/`JSSymbol` — externref slot refcount incremented at call site, decremented after return.

---

## Object Header and Memory Layout

**Every heap object — 12-byte prefix:**

```
Offset 0   rc_class   [ bit 31 = manual sentinel | bit 30 = reserved |
                        bits 29–24 = size-class (0–63) | bits 23–0 = refcount (max 16M) ]
           0xFFFFFFFF = manual sentinel — RC skipped entirely
Offset 4   vtable_ptr [ pointer to vtable, 0 if no symbol methods ]
Offset 8   class_id   [ unique u32, compiler-assigned ]
Offset 12  fields...
```

**Compact field layout (default):**

```
Sort order: f64/i64/u64 (8) → f32/i32/u32/isize/usize/ptr (4) → i16/u16 (2) → i8/u8/bool (1)
```

**`@ordered` layout:** fields in field declaration order — the order they appear in the class body, top to bottom. Constructor assignment order is irrelevant.

**Inheritance layout:** base class fields form a prefix. Derived class fields are appended after the last base field. Both base and derived fields are sorted by their respective compact sort order unless `@ordered` is applied.

**ZST layout:** 12-byte header only. Zero field bytes. Singleton allocated once at program start. All `new ZST()` calls return the same pointer. RC is a no-op — ZSTs are never freed.

**`$generic()` fields:** zero bytes in layout. Compile-time only — not stored in the object.

**`str` value type:** `(data_ptr: usize, len: usize)`. Null sentinel: `data_ptr = 0`. Raw UTF-8 bytes at pointed-to address — no header.

**`StrRef` — compiler-internal heap object:**

```
Offset 0   rc_class    4    — GC managed
Offset 4   vtable_ptr  4
Offset 8   class_id    4    — unique to StrRef
Offset 12  data_ptr    4    — points into source String's buffer or data segment
Offset 16  len         4
Offset 20  owner       4    — heap pointer to owning String, or 0 for literals
```

`StrRef` is never user-visible. The calling convention for `str` parameters is always `(i32, i32)` regardless of whether backed by a `StrRef`.

**`JSValue` heap layout** (when stored to field or collection — not needed for register-only use):

```
Offset 0   rc_class    4    — GC managed
Offset 4   vtable_ptr  4    — dispose frees JSString str alloc or calls _extDel
Offset 8   class_id    4    — one per variant (JSUndefined, JSNull, JSBool, etc.)
Offset 12  tag         4    — variant tag (0–8)
Offset 16  payload     8    — variant payload
```

**Externref table** (JS targets only): JS-side `_ext[]` array. `JSObject`/`JSFn`/`JSSymbol` are `i32` indices. Index 0 = null. Each slot carries a reference count.

**Compiler-generated `$`-prefixed properties:**

| Property | Value |
|---|---|
| `T.$byteSize` | Total allocation size including header |
| `T.$stride` | Element step for array traversal |
| `T.$headerSize` | Always `usize(12)` |
| `T.$classId` | Compiler-assigned `u32`, stable within a build |
| `T.$offset(n)` | Byte offset of nth declared field from object start |
| `T.$dataOffset(n)` | Byte offset of nth declared field from data start |
| `e.$addr` | Base address of any heap object — read-only |
| `b.$val` | `Box<T>` value accessor |
| `list.$ptr` | Address of first element (`list.$addr + 16`) |
| `list.$byteSize` | `length × T.$byteSize` |

---

## Generator State Machine Compilation

Every `function*` declaration is compiled into a state machine class. The generator function itself allocates and returns the state machine.

**Compilation algorithm:**

1. Assign a unique state index to every `yield` point in the function body, across all branches
2. All local variables that are live across any `yield` point become fields on the state machine class
3. The function body is split at each `yield` — each segment becomes a case in `next()`'s switch
4. `return` or end-of-body transitions to a terminal state; subsequent `next()` calls return null
5. `yield*` embeds the delegated iterable as a field and forwards `next()` calls until it returns null

**Generated class structure:**

```js
// source:
function* range(start = isize(0), end = isize(0)) {
  let i = start;
  while (i < end) {
    yield i;
    i += 1;
  }
}

// compiler generates (conceptually):
class __RangeGenerator {
  #state = i32(0);
  #i = isize(0);
  #end = isize(0);

  constructor(start = isize(0), end = isize(0)) {
    this.#i = start;
    this.#end = end;
  }

  next() {   // returns Option(isize)
    switch (this.#state) {
      case 0:
        if (this.#i >= this.#end) { this.#state = 2; return null; }
        this.#state = 1;
        return this.#i;
      case 1:
        this.#i += isize(1);
        this.#state = 0;
        // loop back — continue switch
        if (this.#i >= this.#end) { this.#state = 2; return null; }
        return this.#i;
      case 2:
        return null;   // terminal
    }
  }
}
```

**Bidirectional generators:** `next(value = Tin?)`. The incoming value is stored in a field between states and accessible as the result of the `yield` expression.

**`yield` inside `try`:** CE-CF10. The state machine model does not track exception handler state across yield points.

**Independent instances:** every `function*` call allocates a new state machine with its own copy of all locals. Instances never share state unless they explicitly close over an external reference type.

**Abandoned generators:** when a generator's RC reaches zero, the destructor runs. No `finally` blocks are pending — `finally` is only valid in `try/catch`, not inside generators that span yields.

**Recursive generators with `yield*`:** produce a heap chain of state machines at runtime. Depth is bounded by the recursion depth. CW-G01 emitted.

---

## `instanceof` and `class_id`

Every class has a compiler-assigned `u32` class ID. Class IDs for subclasses are assigned contiguously under their base class. `instanceof Base` is a range check:

```
class_id >= Base.minId && class_id <= Base.maxId
```

ZST class IDs are assigned normally — `instanceof` works on ZSTs via the singleton's header.

---

## Vtable Dispatch

Every class implementing any `@symbol` method gets a vtable at `ptr+4`. Zero if no symbol methods.

```
[ dispose_fn_idx | compare_fn_idx | hash_fn_idx | tostr_fn_idx | ... ]
```

**Abstract methods:** an `@abstract` method has a vtable slot that points to a trap function in the base class. Derived classes that implement the method replace the slot with their implementation. The compiler verifies at instantiation that no trap slots remain — CE-C04 if any do.

**Inheritance:** a derived class's vtable is a copy of the base class vtable with overridden slots replaced. Non-overridden slots keep the base implementation pointer. Resolution is entirely at compile time.

`JSString`, `JSObj`, `JSArr` variants have vtables with dispose entries.

---

## JavaScript Target

This section covers compiler internals specific to the `wasm32-js-esm`, `wasm32-js-cjs`, and `wasm32-js-bundle` targets.

---

### JSValue Wire Format

`JSValue` is `(tag: i32, payload: i64)` in registers. No heap allocation for primitive variants.

| Variant | Tag | Payload |
|---|---|---|
| `JSUndefined` | 0 | 0 |
| `JSNull` | 1 | 0 |
| `JSBool` | 2 | 0 = false, 1 = true |
| `JSInt` | 3 | `i64(value)` — sign-extended i32 |
| `JSNumber` | 4 | f64 bits as i64 via `f64.reinterpret_i64` |
| `JSBigInt` | 5 | `i64(value)` |
| `JSString` | 6 | `(u32 ptr << 32) | u32 len` — packed i64 |
| `JSObj` | 7 | `i64(extref_index)` |
| `JSArr` | 8 | `i64(extref_index)` |

**Bridge `_wrapJSValue(v)`:**

```js
function _wrapJSValue(v) {
  if (v === undefined) return [0, 0n];
  if (v === null)      return [1, 0n];
  switch (typeof v) {
    case "boolean": return [2, v ? 1n : 0n];
    case "number":
      if (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647)
        return [3, BigInt(v)];
      return [4, _f64ToBits(v)];
    case "bigint":  return [5, v];
    case "string": {
      const [ptr, len] = _writeStr(v);
      return [6, (BigInt(ptr) << 32n) | BigInt(len)];
    }
    default:
      if (Array.isArray(v)) return [8, BigInt(_extSet(v))];
      return [7, BigInt(_extSet(v))];
  }
}
```

**Bridge `_unwrapJSValue(tag, payload)`:**

```js
function _unwrapJSValue(tag, payload) {
  switch (tag) {
    case 0: return undefined;
    case 1: return null;
    case 2: return payload !== 0n;
    case 3: return Number(BigInt.asIntN(32, payload));
    case 4: return _bitsToF64(payload);
    case 5: return payload;
    case 6: return _readStr(Number(payload >> 32n), Number(payload & 0xFFFFFFFFn));
    case 7: case 8: return _extGet(Number(payload));
  }
}
```

---

### Marshalling Adapter Pipeline

For every `@jsbind funcName` declaration the compiler generates a marshalling adapter. The adapter is the only code that accesses bridge internals (`_readStr`, `_writeStr`, `_extGet`, `_extSet`, `_wrapJSValue`, `_unwrapJSValue`). The user's plain JS function receives and returns ordinary JS values. CE-B09 if user code references bridge internals directly.

**Adapter structure:**

1. Receives raw WASM-level parameters from the WASM import slot
2. Unmarshals each parameter to its JS equivalent
3. Calls the user's plain JS function with the unmarshalled values
4. Marshals the JS return value back to its WASM-level encoding
5. Returns the WASM-encoded result

**Complete unmarshal table (WASM parameters → plain JS values):**

| Compise type | WASM-level params | Unmarshal operation | Plain JS value |
|---|---|---|---|
| `str` / `String` | `(i32 ptr, i32 len)` | `_readStr(ptr, len)` | JS `string` or `null` |
| `JSObject` | `i32 idx` | `_extGet(idx)` | real JS object |
| `@jsbind.type T` | `i32 idx` | `_extGet(idx)` | real JS object |
| `JSSymbol` | `i32 idx` | `_extGet(idx)` | real JS `Symbol` |
| `JSFn<sig>` | `i32 idx` | `_extGet(idx)` | real JS `Function` |
| `JSValue` | `(i32 tag, i64 payload)` | `_unwrapJSValue(tag, payload)` | any JS value |
| `bool` | `i32` | `v !== 0` | JS `boolean` |
| integer types | `i32` | identity | JS `number` |
| `i64` / `u64` | `i64` | identity | JS `bigint` |
| `f32` / `f64` | `f32` / `f64` | identity | JS `number` |

**Complete marshal table (plain JS return → WASM encoding):**

| Compise return type | Expected JS return | Marshal operation | WASM result |
|---|---|---|---|
| `str` / `String` | `string` or `null` | `v != null ? _writeStr(v) : [0, 0]` | `(i32 ptr, i32 len)` |
| `f64` / `f32` | `number` | identity | `f64` / `f32` |
| integer types | `number` | identity / truncate | `i32` |
| `i64` / `u64` | `bigint` | identity | `i64` |
| `bool` | `boolean` | `v ? 1 : 0` | `i32` |
| `JSObject` | JS object or `null` | `v != null ? _extSet(v) : 0` | `i32` |
| `@jsbind.type T` | JS object or `null` | `v != null ? _extSet(v) : 0` | `i32` |
| `JSSymbol` | JS `Symbol` or `null` | `v != null ? _extSet(v) : 0` | `i32` |
| `JSFn<sig>` | JS `Function` or `null` | `v != null ? _extSet(v) : 0` | `i32` |
| `JSValue` | any JS value | `_wrapJSValue(v)` | `(i32 tag, i64 payload)` |
| `undefined` | nothing / `undefined` | nothing emitted | — |

---

### `.jsbind.js` Compile-Time Processing

`.jsbind.js` files are compile-time inputs only — processed during parse + type-check. They are never loaded at runtime.

**Processing steps:**

1. Parse as a Compise module. Type-check all function signatures. Verify `//# module` header — CE-B08 if absent.
2. Collect `//# js.import <spec> as <alias> [url "..."]` directives.
3. Collect plain JS file paths from `import { ... } from "./path.js"` statements. Resolve relative to the `.jsbind.js` file. Assign each a bridge lib alias: `_lib_<basename>`. Queue for copy.
4. Validate each `@jsbind funcName` — name must appear as a named import from step 3 — CE-B01 if not found. Body must be empty — CE-B02 if non-empty.
5. Parse each `js { }` block. Apply split algorithm: top-level `VariableDeclaration` and `FunctionDeclaration` → **hoist** list; all other top-level statements → **post-init** list.
6. For each `@jsbind funcName` function: generate marshalling adapter.
7. For each `@jsbind.type` class: generate adapters with `self` prepended as first WASM parameter.
8. For each `@jsbind.error` class: validate extends `AppError` — CE-B07 if not. Generate JS `Error` subclass. Register `$classId → ErrorClass` in `_classIdToError`.
9. Deduplication: same hoisted declaration name from two files — CE-B04. Same `//# js.import` specifier, different versions — CW-B02.
10. Copy queued JS files to `dist/lib/`.
11. Emit bridge initialisation.

On non-`wasm32-js-*` targets: all `@jsbind` functions become stubs returning `0`/`null`/`false`. CW-JS01 emitted once per file.

---

### `js { }` Block Split Algorithm

1. Parse the block content as a list of JS statements.
2. For each statement at the top level of the block:
   - `VariableDeclaration` (`const`, `let`) → **hoist**: emit at bridge module scope.
   - `FunctionDeclaration` (`function f() {}`) → **hoist**: emit at bridge module scope.
   - Any other statement → **post-init**: collected in the post-init function, called after WASM instantiation.
3. Nested statements inside hoisted declarations are not re-examined.

---

### `//# js.import` Resolution per Target

| Directive | `wasm32-js-esm` | `wasm32-js-cjs` | `wasm32-js-bundle` |
|---|---|---|---|
| `//# js.import foo as F` | `import * as F from "foo"` | `const F = require("foo")` | CW-B01; bare specifier emitted |
| `//# js.import foo@1.2 as F url "https://..."` | `import * as F from "foo"` | `const F = require("foo")` | `import * as F from "https://..."` |

---

### Shared Memory

The bridge detects `SharedArrayBuffer` availability at runtime:

```js
const _sabAvailable = typeof SharedArrayBuffer !== "undefined";
const _memory = _sabAvailable
  ? new WebAssembly.Memory({ initial: _initialPages, maximum: _maxPages, shared: true })
  : new WebAssembly.Memory({ initial: _initialPages });
```

When SAB is unavailable the bridge falls back to non-shared memory — all features work normally except WASM atomic instructions. `isSABAvailable` is exported alongside `@export` wrappers. Browser environments that need SAB must be served with COOP/COEP headers.

---

### Error Conversion

**`_wrapJswatError(wasmEx)` — converts outbound Compise exception to JS `Error`:**

```js
function _wrapJswatError(wasmEx) {
  const ptr = wasmEx.getArg(_jswatTag, 0);
  const classId = new Uint32Array(_ex.memory.buffer)[(ptr + 8) >> 2];
  const mem32 = new Uint32Array(_ex.memory.buffer);
  const msgPtr = mem32[(ptr + 12) >> 2];
  const msgLen = mem32[(ptr + 16) >> 2];
  const message = msgPtr ? _readStr(msgPtr, msgLen) : "(no message)";
  const ErrorClass = _classIdToError.get(classId) ?? JswatError;
  const err = _buildJswatError(ErrorClass, classId, ptr, message);
  _ex.__jswat_rc_dec(ptr);
  return err;
}
```

**`_jsErrorToJswat(e)` — converts inbound JS exception to Compise AppError:**

```js
function _jsErrorToJswat(e) {
  if (e instanceof JswatError && e.jswatPtr) {
    _ex.__jswat_rc_inc(e.jswatPtr);
    return e.jswatPtr;
  }
  const msg = e?.message ?? String(e);
  const [msgPtr, msgLen] = _writeStr(msg);
  let allocFn = _ex.__jswat_alloc_IOError;
  if (e instanceof TypeError || e instanceof RangeError)
    allocFn = _ex.__jswat_alloc_ValueError;
  return allocFn(msgPtr, msgLen);
}
```

---

### Bridge Initialisation Order

1. Static `import` statements for `//# js.import` dependencies (ESM) or `require()` calls (CJS).
2. Define all bridge utilities (`_ext*`, `_gl*`, `_enc`, `_dec`, `_writeStr`, `_readStr`, `_wrapJSValue`, `_unwrapJSValue`).
3. Dynamically import plain JS lib files.
4. Emit hoisted declarations from all `js { }` blocks at module scope.
5. Detect SAB availability and allocate memory.
6. Construct `_imports` with all `@jsbind` adapters and std hooks.
7. Instantiate WASM.
8. Capture `_ex = instance.exports` and `_heapBase`.
9. Capture `_jswatTag`.
10. Run post-init statements from all `js { }` blocks.
11. Call `_ex.__jswat_init()`.
12. Export `@export` wrappers and `isSABAvailable`.
13. Run environment detection (Node.js vs browser).

---

## Runtime Architecture

### Three-Layer Model

```
Layer 0  WASM primitives     memory.grow, memory.copy, memory.fill, atomic ops
Layer 1  Allocator (WAT)     size-classed free list, bump allocator, Arena, Pool
Layer 2  GC (WAT)            sentinel-aware rc_inc/rc_dec, dispose dispatch
─────────────────────────────────────────────────────────────────────────────
Layer 3  std (Compise)       stdlib on top of Layers 1–2
Layer 4  JS bridge           externref table, string codec, adapters (JS targets only)
```

### Allocator

**Size classes:** 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096 bytes, plus large (>4096).

**Free list:** 11 heads at `heap_base`. Each free block reuses `rc_class` slot as next-pointer.

**Large allocations:** doubly-linked list, 12-byte header `[next:4 | prev:4 | size:4]`.

**Bump allocator:** new blocks from `$bump`, growing via `memory.grow`. OOM → RT-01.

### Reference Counting

```wat
(func $__jswat_rc_inc (param $ptr i32)
  local.get $ptr
  i32.load
  i32.const -1
  i32.eq
  if return end     ;; manual sentinel — skip
  ;; increment refcount in bits 23–0
)
```

When refcount hits 0: call `Symbol.dispose` via vtable, return memory to free list. ZST objects never reach zero — RC operations are no-ops.

### Externref Table

```js
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
```

### String Codec

```js
const _enc = new TextEncoder();
const _dec = new TextDecoder();
const _scratch = new Uint8Array(4096);
const _strCache = new Map();

const _writeStr = (s) => {
  if (!s) return [0, 0];
  let ascii = true;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) { ascii = false; break; }
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
```

### Debug Poison

| Pattern | Meaning |
|---|---|
| `0xDEADDEAD` | Freed manual object |
| `0x00FACADE` | Freed GC object |
| `0xABABABAB` | Arena-reset region |
| `0xFEEDFEED` | Freed pool slot |

---

## Tree-Shaking

Five levels, automatic. No annotations required.

**Level 1** — User module DCE: unreachable from `@export` + `_start`.
**Level 2** — Stdlib DCE: same analysis on stdlib.
**Level 3** — Runtime DCE after `wasm-merge` + `wasm-opt --dce`.
**Level 4** — RC elimination: binaryen `-O3` escape analysis.
**Level 5** — Target branch folding: all `__target_*` globals folded.

| Function | Included when |
|---|---|
| `__jswat_alloc` | Any heap allocation |
| `__jswat_free` | `__jswat_alloc` included |
| `__jswat_rc_inc` | Heap value crosses scope |
| `__jswat_rc_dec` | Heap value goes out of scope |
| `__jswat_dispose` | Any class implements `Symbol.dispose` |
| `__jswat_arena_*` | `alloc.arena()` used |
| `__jswat_pool_*` | `alloc.pool()` used |
| `__strref_alloc` | Any `str` escapes lexical scope |
| `__jswat_alloc_raw` | `wasm32-js-*` + string parameters in `@export` |
| `__jswat_free_raw` | `__jswat_alloc_raw` included |
| `__jswat_invoke_jsfn` | Any `JSFn` called from WASM |
| `__jswat_result_*` | `Result<T>` in `@export` functions |
| `__jswat_alloc_*Error` | `@jsbind` functions with JS→WASM exception path |

### Full Pipeline

```
1.  Parse + type-check full module graph (including .jsbind.js files)
2.  Process .jsbind.js: validate, extract adapters, copy JS files
3.  --target folds __target_* globals
4.  Build call graph rooted at @export + _start
5.  Mark reachable: functions, classes, static fields, vtable entries
6.  Emit reachable symbols → user.wasm
7.  wasm-merge user.wasm runtime.wasm → merged.wasm     (skipped for wasm32-ld)
8.  wasm-opt --dce merged.wasm
9.  wasm-opt -O3 merged.wasm
10. → final.wasm
11. (wasm32-js-* only) Generate JS bridge from @export annotations + adapter registry
12. (wasm32-js-bundle only) Inline WASM binary as Uint8Array; inline JS lib files as Blob URLs
```

---

## Compiler Intrinsics

| Intrinsic | Signature | Purpose |
|---|---|---|
| `__str_from_ptr` | `(buf: u8?, len: usize) → str` | Synthesize str from raw buffer |
| `__char_at` | `(buf: u8?, i: usize) → str` | Single-character str |
| `__char_from_codepoint` | `(cp: u32) → str` | UTF-8 encode one codepoint |
| `__mem_eq` | `(a: u8?, ai: usize, b: u8?, bi: usize, n: usize) → bool` | Byte comparison |
| `__fmt_number` | `(n: Number) → str` | Number to str (monomorphized) |
| `__reinterpret_f64` | `(bits: i64) → f64` | f64.reinterpret_i64 |
| `__wasi_available` | `i32` global | Folded at compile time |
| `__stack_alloc` | `(n: usize) → usize` | Stack-frame allocation |
| `__stack_store_u32` | `(base: usize, off: usize, v: u32) → undefined` | Write to stack frame |
| `__stack_load_u32` | `(base: usize, off: usize) → u32` | Read from stack frame |
| `__stack_load_i64` | `(base: usize, off: usize) → i64` | Read i64 from stack frame |
| `__cstr_to_str` | `(ptr: usize) → str` | Null-terminated C string to str |
| `__u32_load` | `(addr: usize) → u32` | Bare u32 load |
| `__strref_alloc` | `(ptr: usize, len: usize, owner: i32) → i32` | Allocate StrRef. owner=0 for literals |
| `__jswat_alloc_raw` | `(n: usize) → usize` | Raw byte alloc for bridge string writes |
| `__jswat_free_raw` | `(ptr: usize) → undefined` | Free raw byte alloc |
| `__jswat_heap_base` | exported `i32` global | Start of heap — bridge cache boundary |
| `__jswat_exception_tag` | exported `WebAssembly.Tag` | Exception tag — captured by bridge at init |
| `__jswat_invoke_jsfn` | `(fnIdx: i32, ...args) → undefined` | Call JSFn from WASM |
| `__jswat_result_isErr` | `(ptr: i32) → i32` | Check Result error state |
| `__jswat_result_errPtr` | `(ptr: i32) → i32` | Extract error pointer from Result |
| `__jswat_result_unwrap_*` | varies per T | Extract ok value from Result |
| `__jswat_alloc_*Error` | `(msgPtr: usize, msgLen: usize) → i32` | Allocate error object for JS→WASM conversion |
| `unreachable` | statement | Emits WASM `unreachable` |

---

## CLI and Build Configuration

### Command Reference

```bash
# Compile — WASM targets
jswat compile src/main.js -o dist/main.wasm
jswat compile src/main.js --target wasm32-wasip1  -o dist/main.wasm
jswat compile src/main.js --target wasm32-unknown -o dist/main.wasm
jswat compile src/main.js --target wasm32-ld      -o dist/main.o
jswat compile src/main.js --target wasm32-component --world wasi:http/proxy -o dist/main.wasm

# Compile — JS targets
jswat compile src/main.js --target wasm32-js-esm    -o dist/main.js
jswat compile src/main.js --target wasm32-js-cjs    -o dist/main.cjs
jswat compile src/main.js --target wasm32-js-bundle -o dist/main.bundle.js

# Run — executes via Node.js (JS target only, no --target flag)
jswat run src/main.js
jswat run src/main.js -- arg1 arg2
jswat run -e 'console.log("hello")'

# Unified --emit (composable, multiple per invocation)
jswat compile src/main.js \
  --emit wasm:dist/main.wasm \
  --emit wat:dist/main.wat \
  --emit ast:dist/main.ast.json \
  --emit layout:dist/main.layout.json

# Type check only
jswat check src/main.js

# Inspect WASM binary
jswat inspect dist/main.wasm
jswat inspect dist/lib.wasm --emit-extern
jswat inspect dist/main.wasm --emit-wit

# Generate WIT bindings
jswat bindgen src/other.wit -o src/bindings.js

# Test pragmas
jswat compile src/main.test.js --test-pragmas --check
jswat compile src/main.test.js --test-pragmas -o dist/main.test.wasm

# Memory controls
jswat compile src/main.js --max-memory 64mb -o dist/main.wasm
jswat compile src/main.js --max-memory 1024 -o dist/main.wasm   # 1024 pages = 64MB
jswat compile src/main.js --base-address 65536 -o dist/main.wasm
jswat compile src/main.js --import-memory -o dist/main.wasm

# Linking
jswat compile src/main.js --link mathlib=dist/mathlib.wasm -o dist/app.wasm
jswat compile src/main.js --multi-memory --link-foreign physics=dist/physics.wasm -o dist/app.wasm
```

### `jswat run`

`jswat run` compiles the source in-process (the compiler is written in JS) and executes it directly via Node.js. No `--target` flag — target is an implementation detail of `run`. Use `jswat compile` when you need a specific output artifact or target.

```bash
jswat run src/main.js                 # compile + execute
jswat run src/main.js -- arg1 arg2   # pass args to the program
jswat run -e 'console.log("hello")'  # inline expression
```

Attempting to use `--target` with `run` is an error. For non-JS targets use `jswat compile` and invoke with the appropriate runtime.

### `jswat.json`

```json
{
  "entry":        "src/main.js",
  "output":       "dist/app.wasm",
  "target":       "wasm32-wasip1",
  "lib":          false,
  "link":         { "mathlib": "dist/mathlib.wasm" },
  "linkForeign":  { "physics": "dist/physics.wasm" },
  "world":        "",
  "memory": {
    "initial":     "4mb",
    "maximum":     null,
    "baseAddress": 0,
    "import":      false
  },
  "multiMemory":  false,
  "optimize":     true,
  "testPragmas":  false,
  "emit": [
    { "format": "wasm",   "output": "dist/main.wasm" },
    { "format": "wat",    "output": "dist/main.wat",  "stage": "opt" },
    { "format": "layout", "output": "dist/main.layout.json" }
  ],
  "binding": {
    "arrayMode":  "copy",
    "resultMode": "unwrap"
  }
}
```

---

## Compiler Internal Tests (`compiler::test`)

Test files begin with `//# compiler::test` as the first non-empty line. Directives are stripped from normal builds. `--test-pragmas` activates processing.

### Directive syntax

```
//# compiler::<namespace>.<assertion> [target] [op] [value]
```

Placed before a declaration: applies to that declaration. Placed inline: applies to that statement. Multiple directives may stack.

### `compiler::parse`

`parse.ok` — next declaration parses without error.
`parse.error` — next line rejected at parse phase.

### `compiler::type`

`type.infer {T}` — binding inferred as exactly `T`.
`type.expr {expr} {T}` — sub-expression type.
`type.param {T} {concrete}` — type variable resolved at call site.
`type.monomorphs {op} {n}` — monomorphization count for generic function.
`type.narrow {expr} {T}` — expression narrowed to `T` in enclosing block.
`type.noNarrow {expr}` — expression not narrowed.

### `compiler::error`

`error.expect {CE-XXX}` — expected compile error. Failure to produce it → CIT-003.
`error.expectWarn {CW-XXX}` — expected warning.

### `compiler::emit`

`emit.wat {pattern}` — WAT output contains substring.
`emit.watCount {instr} {op} {n}` — instruction count in function.
`emit.noCall {fn}` — no call to named internal function.
`emit.sig {sig}` — WASM type signature.
`emit.sret` / `emit.noSret` — return convention.

### `compiler::opt`

`opt.inlined` / `opt.notInlined` — call site inlining after binaryen.
`opt.constFolded {value}` — expression folded to specific value.
`opt.isConst` — compile-time evaluation confirmed.
`opt.branchElim {then|else}` — branch eliminated.
`opt.isDead` — function absent from final binary.

### `compiler::rc`

`rc.inc {op} {n}` / `rc.dec {op} {n}` — RC operation counts.
`rc.elided` — all RC operations eliminated.
`rc.balanced` — increment count equals decrement count.

### `compiler::alloc`

`alloc.count {op} {n}` — `__jswat_alloc` call count.
`alloc.stack` — allocation routed to stack frame.

### `compiler::layout`

`layout.field {name} {op} {n}` — field byte offset from object start (includes 12-byte header).
`layout.size {op} {n}` — total `$byteSize`.
`layout.variants {op} {n}` — sealed union variant count.
`layout.classId {op} {n}` — compiler-assigned class ID.

### `compiler::str`

`str.raw` — not promoted to StrRef.
`str.ref` — promoted to StrRef.
`str.literal` — originates from data segment.
`str.slice` — sub-slice of existing buffer.

### `compiler::link`

`link.exported {name}` — function present in WASM export table.
`link.treeShaken` — function absent from final binary.
`link.moduleSize {op} {n}` — binary size in bytes.

### CIT Error Codes

| Code | Condition |
|---|---|
| CIT-001 | `//# compiler::` directive without `//# compiler::test` header |
| CIT-002 | Test file compiled with `--release` |
| CIT-003 | `error.expect` / `error.expectWarn` — expected diagnostic did not occur |
| CIT-004 | `parse.error` — expected parse failure did not occur |
| CIT-005 | `parse.ok` — unexpected parse error |
| CIT-006 | `type.infer` / `type.expr` / `type.param` — type mismatch |
| CIT-007 | `type.narrow` / `type.noNarrow` — narrowing state mismatch |
| CIT-008 | `type.monomorphs` — count mismatch |
| CIT-009 | `emit.wat` — pattern absent |
| CIT-010 | `emit.watCount` / `emit.noCall` — count mismatch |
| CIT-011 | `emit.sig` — signature mismatch |
| CIT-012 | `emit.sret` / `emit.noSret` — convention mismatch |
| CIT-013 | `opt.inlined` / `opt.notInlined` — inlining mismatch |
| CIT-014 | `opt.constFolded` / `opt.isConst` — not folded or wrong value |
| CIT-015 | `opt.branchElim` — branch present when expected eliminated |
| CIT-016 | `opt.isDead` — function present when expected absent |
| CIT-017 | `rc.inc` / `rc.dec` — count mismatch |
| CIT-018 | `rc.elided` — RC operations not eliminated |
| CIT-019 | `rc.balanced` — counts differ |
| CIT-020 | `alloc.count` — allocation count mismatch |
| CIT-021 | `alloc.stack` — allocation not on stack |
| CIT-022 | `layout.field` — field offset mismatch |
| CIT-023 | `layout.size` — size mismatch |
| CIT-024 | `layout.variants` — variant count mismatch |
| CIT-025 | `layout.classId` — class ID mismatch |
| CIT-026 | `str.raw` / `str.ref` — representation mismatch |
| CIT-027 | `str.literal` / `str.slice` — provenance mismatch |
| CIT-028 | `link.exported` — function absent from export table |
| CIT-029 | `link.treeShaken` — function present when expected absent |
| CIT-030 | `link.moduleSize` — constraint not satisfied |
| CIT-031 | Unknown `//# compiler::` namespace or directive |

---

*End of Compise Compiler Reference*
