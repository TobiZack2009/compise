# js.wat Compiler Reference
### Version 1.9

> Implementation reference for the js.wat compiler.
> Covers WASM type mappings, object header layout, memory model,
> calling convention, runtime internals, tree-shaking, JS bridge
> architecture, `.jsbind.js` processing, CLI, and compiler test pragmas.

**v1.7 changes:** `wasm32-js-*` targets · JS bridge architecture · externref table · marshalling adapter pipeline · `.jsbind.js` compile-time processing · `JSValue` wire format · `SharedArrayBuffer` memory · unified `--emit` flag · `compiler::test` pragma system (CIT codes)

**v1.8 changes:** `.jsbind.js` processing rewritten — plain JS file copy pipeline, `import.meta.url` dynamic imports, `@jsbind funcName` link validation; marshalling adapter insulation (bridge internals adapter-only, CE-B09 enforced); `js { }` block split algorithm (declarations hoisted, statements post-init); `//# js.import` per-target resolution; `JSObject`/`JSValue`/`JSSymbol` bridge call shapes updated to instance-method dispatch model; `JSSymbol` externref table entry semantics; removed CE-T16/CE-T17

**v1.9 changes:** threading removed; `StringBuilder` removed; `String` empty/capacity constructors added; memory controls added (`--max-memory`, `--base-address`, `--import-memory`, `jswat.json` `"memory"` block); `SharedArrayBuffer` runtime detection in bridge init; JS-target compiler content reorganised under `## JavaScript Target`; see-also links updated to v1.9

*See also: [jswat-spec.md](jswat-spec.md) — Language Spec v1.9 | [jswat-std.md](jswat-std.md) — Standard Library v1.9*

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

| js.wat type | WASM type | Notes |
|---|---|---|
| `bool` | `i32` | 0 = false, 1 = true |
| `i8` | `i32` | sign-extended on load |
| `u8` | `i32` | zero-extended on load |
| `i16` | `i32` | sign-extended on load |
| `u16` | `i32` | zero-extended on load |
| `i32`, `u32` | `i32` | native |
| `i64`, `u64` | `i64` | native |
| `isize`, `usize` | `i32` (WASM32) | platform-sized |
| `f32` | `f32` | native |
| `f64` | `f64` | native |
| `str` | `(i32, i32)` | fat pointer: data_ptr + len. Null when data_ptr = 0 |
| `String` | `i32` | heap pointer or 0 |
| class instance | `i32` | heap pointer or 0 |
| array | `i32` | header pointer or 0 |
| `Box<T>` | `i32` | heap pointer or 0 |
| `List<T>` | `i32` | header pointer or 0 |
| `null` | `i32` | always 0 |
| `T?` (primitive optional) | `(T_wasm, i32)` | value + is_null flag |
| `ListView<T>` | `(i32, i32)` | data_ptr + length |
| function value | `(i32, i32)` | fn_index + env_ptr |
| `JSObject` | `i32` | externref table index, 0 = null |
| `JSFn<sig>` | `i32` | externref table index, 0 = null |
| `JSSymbol` | `i32` | externref table index, 0 = null |
| `JSValue` | `(i32, i64)` | tag + payload — see JSValue Wire Format |

**In memory (struct fields, array elements):**

| js.wat type | Memory size | Load | Store |
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
| `isize?` in struct | 8 bytes (4+4) | two loads | two stores |
| `f64?` in struct | 16 bytes (8+8) | two loads | two stores |
| `ListView<T>` in struct | 8 bytes (two usize) | two loads | two stores |
| `JSObject`/`JSFn`/`JSSymbol` in struct | 4 bytes | `i32.load` | `i32.store` |
| `JSValue` in struct | 12 bytes (4 + 8) | three loads | three stores |

---

## Calling Convention

**Simple scalars:**

```js
function add(a = 0, b = 0) { return a + b; }
// WASM: (func (param i32 i32) (result i32))
```

**Two-word values:**

```js
function takeStr(s = "") { return s.length; }
// WASM: (func (param i32 i32) (result i32))  — data_ptr + len

function sumOpts(a = isize(0)?, b = isize(0)?) { return (a ?? 0) + (b ?? 0); }
// WASM: (func (param i32 i32 i32 i32) (result i32))

function processVal(v = JSValue) { return v.isNullish(); }
// WASM: (func (param i32 i64) (result i32))  — tag + payload
```

**`JSObject`/`JSFn`/`JSSymbol` — single `i32`:**

```js
function handleEl(el = JSObject) { return el.getStr("id"); }
// WASM: (func (param i32) (result i32 i32))  — i32 extref in, str (i32,i32) out
```

**Multiple return values — sret pointer:**

When a function returns a class instance, the caller allocates space and passes a hidden sret pointer as the first parameter. Two-word values (`str`, `ListView<T>`, primitive optionals, `JSValue`, function values) return as multiple WASM return values natively — no sret needed.

**`JSFn` calls** generate a dedicated WASM import per call signature: `__jswat_call_jsfn_<encoded_sig>`. Different signatures produce different imports.

**RC across call boundary:** Passing a GC heap value to a function increments its RC at the call site and decrements after return. Manual objects (`0xFFFFFFFF` sentinel) — RC check skipped. `JSObject`/`JSFn`/`JSSymbol` — externref slot refcount incremented at call site, decremented after return.

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

## JavaScript Target

This section covers compiler internals specific to the `wasm32-js-esm`, `wasm32-js-cjs`, and `wasm32-js-bundle` targets: the JS bridge architecture, `JSValue` wire encoding, the marshalling adapter pipeline, `.jsbind.js` compile-time processing, and the JS-specific subsections of the runtime architecture (externref table, string codec, error conversion, bridge initialisation order).

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
| `JSBigInt` | 5 | `i64(value)` — truncating for out-of-range values |
| `JSString` | 6 | `(u32 ptr << 32) | u32 len` — packed i64 |
| `JSObj` | 7 | `i64(extref_index)` |
| `JSArr` | 8 | `i64(extref_index)` |

`JSInt` is produced when the JS `number` value passes `Number.isInteger(v) && v >= -2147483648 && v <= 2147483647`. Otherwise `JSNumber`.

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
// Returns [tag: number, payload: bigint] corresponding to (i32, i64) WASM return values
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

`JSString` cleanup: the `class_id` for `JSString` heap objects has a vtable `dispose_fn_idx` that calls `__jswat_free_raw(ptr)` to release the `str` allocation. For `JSObj`/`JSArr`, dispose calls `_extDel(idx)`.

---

### Marshalling Adapter Pipeline

For every `@jsbind funcName` declaration the compiler generates a marshalling adapter. The adapter is the only code that accesses bridge internals (`_readStr`, `_writeStr`, `_extGet`, `_extSet`, `_wrapJSValue`, `_unwrapJSValue`). The user's plain JS function receives and returns ordinary JS values. CE-B09 if user code references bridge internals directly.

### Adapter structure

Each adapter:

1. Receives raw WASM-level parameters from the WASM import slot
2. Unmarshals each parameter to its JS equivalent
3. Calls the user's plain JS function with the unmarshalled values
4. Marshals the JS return value back to its WASM-level encoding
5. Returns the WASM-encoded result

The adapter is keyed in `_imports` by the `@external` name. The user's function is called via the dynamic import handle of the plain JS file (`_lib_<module>`).

### Complete unmarshal table (WASM parameters → plain JS values)

| js.wat type | WASM-level params | Unmarshal operation | Plain JS value |
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

For `@jsbind.type` method adapters, `self` is the first WASM parameter — always an `i32` externref index, always unmarshalled via `_extGet(selfIdx)` and passed as the first argument to the plain JS function.

### Complete marshal table (plain JS return → WASM encoding)

| js.wat return type | Expected JS return | Marshal operation | WASM result |
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
| pointer / extref (null return) | `null` / `undefined` | `0` | `i32` |
| `JSValue` (null return) | `null` | `[1, 0n]` | `(1, 0n)` — JSNull |

### Generated adapter examples

**Standalone `@jsbind` function:**

```js
// .jsbind.js:
//   import { getElementById } from "./dom.js";
//   /** @external js.dom.getElementById  @jsbind getElementById */
//   function dom_getElementById(id = "") { }   // str → HTMLElement?

// Compiler-generated adapter in bridge:
_imports["js.dom.getElementById"] = (idPtr, idLen) => {
  const _a0 = _readStr(idPtr, idLen);              // str → JS string
  const _r  = _lib_dom.getElementById(_a0);        // call plain JS function
  return _r != null ? _extSet(_r) : 0;             // HTMLElement? → i32
};

// plain JS function in dom.js (no bridge knowledge):
export function getElementById(id) {
  return document.getElementById(id) ?? null;
}
```

**Method on `@jsbind.type` class:**

```js
// .jsbind.js:
//   /** @jsbind clearRect */
//   clearRect(x = 0.0, y = 0.0, w = 0.0, h = 0.0) { }   on Canvas2DContext

// Compiler-generated adapter:
_imports["js.Canvas2DContext.clearRect"] = (selfIdx, x, y, w, h) => {
  const _self = _extGet(selfIdx);                  // @jsbind.type → real JS object
  _lib_canvas.clearRect(_self, x, y, w, h);        // self passed as first argument
  // undefined return — nothing emitted
};

// plain JS function in canvas.js:
export function clearRect(ctx, x, y, w, h) {
  ctx.clearRect(x, y, w, h);
}
```

**Getter on `@jsbind.type` class:**

```js
// .jsbind.js:
//   /** @jsbind.get getFillStyle */
//   get fillStyle() { }   on Canvas2DContext   // → str

// Compiler-generated adapter:
_imports["js.Canvas2DContext.get_fillStyle"] = (selfIdx) => {
  const _self = _extGet(selfIdx);
  const _r = _lib_canvas.getFillStyle(_self);
  return _r != null ? _writeStr(_r) : [0, 0];     // str return → (i32, i32)
};

// plain JS function in canvas.js:
export function getFillStyle(ctx) {
  return ctx.fillStyle;   // plain JS string
}
```

**Setter on `@jsbind.type` class:**

```js
// .jsbind.js:
//   /** @jsbind.set setFillStyle */
//   set fillStyle(v = "") { }   on Canvas2DContext

// Compiler-generated adapter:
_imports["js.Canvas2DContext.set_fillStyle"] = (selfIdx, vPtr, vLen) => {
  const _self = _extGet(selfIdx);
  const _a0   = _readStr(vPtr, vLen);              // str → JS string
  _lib_canvas.setFillStyle(_self, _a0);
};

// plain JS function in canvas.js:
export function setFillStyle(ctx, v) {
  ctx.fillStyle = v;   // v is a plain JS string
}
```

**`JSSymbol` parameter:**

```js
// .jsbind.js:
//   /** @external js.obj.setSymbolProp  @jsbind setSymbolProp */
//   function setSymbolProp(obj = JSObject, sym = JSSymbol, val = JSValue) { }

// Compiler-generated adapter:
_imports["js.obj.setSymbolProp"] = (objIdx, symIdx, tag, payload) => {
  const _a0 = _extGet(objIdx);                     // JSObject → real JS object
  const _a1 = _extGet(symIdx);                     // JSSymbol → real JS Symbol
  const _a2 = _unwrapJSValue(tag, payload);        // JSValue → JS value
  _lib_obj.setSymbolProp(_a0, _a1, _a2);
};

// plain JS function:
export function setSymbolProp(obj, sym, val) {
  obj[sym] = val;   // sym is a real JS Symbol — standard property access
}
```

### `js { }` block split algorithm

The compiler processes `js { }` blocks as follows:

1. Parse the block content as a list of JS statements.
2. For each statement at the **top level of the block**:
   - `VariableDeclaration` (`const`, `let`) → **hoist**: emit at bridge module scope, before `_imports` construction.
   - `FunctionDeclaration` (`function f() {}`) → **hoist**: emit at bridge module scope.
   - Any other statement (expression statement, call, `if`, `for`, etc.) → **post-init**: collect in the post-init function, called after WASM instantiation (step 9 of bridge init sequence).
3. Nested statements inside hoisted declarations are not re-examined — only the top level determines classification.

Hoisted declarations are available to all adapter functions since they are in module scope. Post-init statements that call `_ex.*` exports are safe because `_ex` is populated before post-init runs (step 7 of bridge init sequence).

The algorithm is deterministic and purely syntactic — it does not perform dataflow analysis. If a `const` at the top level captures a closure that calls `_ex`, that is legal (the post-init ordering ensures `_ex` is available when the closure eventually executes).

### `//# js.import` resolution per target

| Directive | `wasm32-js-esm` | `wasm32-js-cjs` | `wasm32-js-bundle` |
|---|---|---|---|
| `//# js.import foo as F` | `import * as F from "foo"` at bridge top | `const F = require("foo")` at bridge top | CW-B01; bare specifier emitted (import map required) |
| `//# js.import foo@1.2 as F url "https://..."` | `import * as F from "foo"` (version stripped) | `const F = require("foo")` | `import * as F from "https://..."` |

The `@version` suffix is used only for deduplication: if two libraries both import `"gl-matrix"` at `@3.4.3`, they get one `import` statement. If versions differ — CW-B02, first-encountered version wins.

The alias declared in `//# js.import` is in scope inside `js { }` blocks for that binding file. It is not available in the user's plain JS file — plain JS files use their own standard `import` statements for third-party dependencies.

### Plain JS file copy pipeline

1. For each `.jsbind.js` file in the import graph, collect all `import { ... } from "./path.js"` statements referencing `.js` files (not `"std/*"` or other `.jsbind.js` files).
2. Resolve each path relative to the `.jsbind.js` file's location.
3. Copy each resolved JS file to `dist/lib/` preserving the relative path from the binding source root.
4. In the generated bridge, emit one dynamic import per copied file:
   ```js
   const _lib_dom    = await import(new URL("./lib/dom.js",    import.meta.url));
   const _lib_canvas = await import(new URL("./lib/canvas.js", import.meta.url));
   ```
5. Each adapter references the appropriate `_lib_*` handle.
6. For `wasm32-js-bundle`: instead of `import(new URL(...))`, each file's content is inlined as a Blob URL:
   ```js
   const _lib_dom = await import(URL.createObjectURL(
     new Blob([`/* contents of dom.js */`], { type: "text/javascript" })
   ));
   ```
7. For `wasm32-js-cjs`: `require()` at the top of the file instead of `await import()`.

If two `.jsbind.js` files in the import graph reference the same JS file (same resolved path), it is copied once and one `_lib_*` handle is shared.

---


### `.jsbind.js` Compile-Time Processing

`.jsbind.js` files are compile-time inputs only — processed during step 1 of the pipeline (parse + type-check). They are never loaded at runtime. The associated plain JS files are copied to the output `lib/` directory.

**Processing steps for each `.jsbind.js` file:**

1. Parse as a js.wat module. Type-check all function signatures. Verify `//# jsbind` and `//# module` headers — CE-B08 if `//# module` absent.
2. Collect `//# js.import <spec> as <alias> [url "..."]` directives. Record specifier, alias, optional CDN URL, and optional version suffix.
3. Collect plain JS file paths from `import { ... } from "./path.js"` statements (paths ending in `.js`, not `"std/*"`, not other `.jsbind.js` files). Resolve relative to the current `.jsbind.js` file. Assign each a bridge lib alias: `_lib_<basename_without_ext>`. Queue for copy.
4. Validate each `@jsbind funcName` declaration: `funcName` must appear as a named import collected in step 3 — CE-B01 if not found. Validate body is empty — CE-B02 if non-empty.
5. Parse each `js { }` block. Apply the split algorithm: top-level `VariableDeclaration` and `FunctionDeclaration` nodes → **hoist** list; all other top-level statements → **post-init** list.
6. For each `@jsbind funcName` standalone function: record `(jswat_sig, funcName, lib_alias, external_name)`. Generate marshalling adapter (see Marshalling Adapter Pipeline).
7. For each `@jsbind.type` class: record `(class_name, jsType_string)`. For each method/getter/setter in the class marked `@jsbind`/`@jsbind.get`/`@jsbind.set`: generate an adapter with `self` prepended as first WASM parameter.
8. For each `@jsbind.error` class: validate it extends `AppError` — CE-B07 if not. Generate a JS `Error` subclass in the bridge. Read `@jsbind.errorFields`; resolve byte offsets from class layout. Register `$classId → ErrorClass` in `_classIdToError`.
9. Deduplication across the full import graph:
   - Same hoisted declaration name from two files → CE-B04.
   - Same `//# js.import` specifier, same version → merge to one `import` statement.
   - Same `//# js.import` specifier, different versions → CW-B02; first-encountered version used.
   - Same resolved JS file path from two `.jsbind.js` files → share one `_lib_*` handle, copy once.
10. Copy all queued JS files to `dist/lib/` preserving relative path structure from the binding source root.
11. Emit bridge initialisation:
    a. `//# js.import` dependencies → static `import * as <alias> from "<specifier>"` at bridge module top (ESM) or `const <alias> = require("<specifier>")` (CJS). For bundle: `import * as <alias> from "<url>"`.
    b. One `await import(new URL("./lib/path.js", import.meta.url))` per copied JS file. For bundle: Blob URL inline. For CJS: `require("./lib/path.js")`.
    c. Emit hoisted `js { }` declarations at bridge module scope (before `_imports` construction).
    d. After WASM instantiation: emit post-init `js { }` statements in import order.

On non-`wasm32-js-*` targets: steps 2–11 skipped. All `@jsbind` functions become stubs returning `0`/`null`/`false`. CW-JS01 emitted once per file.

---


## Runtime Architecture

### Three-Layer Model

```
Layer 0  WASM primitives     memory.grow, memory.copy, memory.fill, atomic ops
Layer 1  Allocator (WAT)     size-classed free list, bump allocator, Arena, Pool
Layer 2  GC (WAT)            sentinel-aware rc_inc/rc_dec, dispose dispatch
─────────────────────────────────────────────────────────────────────────────
Layer 3  std (js.wat)        stdlib on top of Layers 1–2
Layer 4  JS bridge           externref table, string codec, adapters (JS targets only)
```

### Allocator

**Size classes:** 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096 bytes, plus large (>4096).

**Free list:** 11 heads at `heap_base`. Each free block reuses `rc_class` slot as next-pointer.

**Large allocations:** doubly-linked list, 12-byte header `[next:4 | prev:4 | size:4]`.

**Bump allocator:** new blocks from `$bump`, growing via `memory.grow` (or `memory.atomic.grow` when `SharedArrayBuffer` is active on JS targets). OOM → RT-01.

### Reference Counting

On `wasm32-js-*` targets when `SharedArrayBuffer` is active, RC operations use WASM atomic instructions (`i32.atomic.rmw.add` etc.) to be safe for any future multi-instance use. When SAB is unavailable, standard `i32` operations are used.

```wat
(func $__jswat_rc_inc (param $ptr i32)
  local.get $ptr
  i32.load          ;; or i32.atomic.load on JS targets
  i32.const -1
  i32.eq
  if return end     ;; manual sentinel — skip
  ;; increment refcount in bits 23–0
)
```

When refcount hits 0: call `Symbol.dispose` via vtable, return memory to free list.

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

When a `JSObject`/`JSFn`/`JSSymbol` is passed as a function argument: `_extInc(idx)` at call site, `_extDel(idx)` after return. On scope exit without a call: `_extDel(idx)`.

A `FinalizationRegistry` provides a safety net — calls `_extDel` if WASM drops a reference without cleanup.

### WebGL Handle Table

WebGL objects use a separate `WeakMap`-keyed handle table to avoid externref overhead for objects that are already effectively opaque integer IDs on the driver side:

```js
const _glObj = new Map();
const _glHandle = new WeakMap();
let _glNext = 1;
const _glStore = (o) => {
  if (!o) return 0;
  if (_glHandle.has(o)) return _glHandle.get(o);
  const i = _glNext++;
  _glHandle.set(o, i); _glObj.set(i, o); return i;
};
const _glLoad  = (i) => _glObj.get(i) ?? null;
const _glDel   = (i) => { const o = _glObj.get(i); if (o) { _glObj.delete(i); _glHandle.delete(o); } };
```

### String Codec

```js
const _enc = new TextEncoder();
const _dec = new TextDecoder();
const _scratch = new Uint8Array(4096);
const _strCache = new Map();  // (ptr*65536+len)|0 → string, for data-segment strings

const _writeStr = (s) => {
  if (!s) return [0, 0];
  // fast path: pure ASCII
  let ascii = true;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) { ascii = false; break; }
  if (ascii) {
    const ptr = _ex.__jswat_alloc_raw(s.length);
    const m = new Uint8Array(_ex.memory.buffer);
    for (let i = 0; i < s.length; i++) m[ptr + i] = s.charCodeAt(i);
    return [ptr, s.length];
  }
  // encodeInto fast path for strings ≤4096 bytes
  const r = _enc.encodeInto(s, _scratch);
  if (r.written <= 4096) {
    const ptr = _ex.__jswat_alloc_raw(r.written);
    new Uint8Array(_ex.memory.buffer).set(_scratch.subarray(0, r.written), ptr);
    return [ptr, r.written];
  }
  // fallback: large string
  const b = _enc.encode(s);
  const ptr = _ex.__jswat_alloc_raw(b.length);
  new Uint8Array(_ex.memory.buffer).set(b, ptr);
  return [ptr, b.length];
};

const _readStr = (ptr, len) => {
  if (ptr === 0) return null;
  if (ptr < _heapBase) {  // data segment — cache
    const k = (ptr * 65536 + len) | 0;
    if (_strCache.has(k)) return _strCache.get(k);
    const s = _dec.decode(new Uint8Array(_ex.memory.buffer, ptr, len));
    _strCache.set(k, s); return s;
  }
  return _dec.decode(new Uint8Array(_ex.memory.buffer, ptr, len));
};
```

### Error Conversion

**`_wrapJswatError(wasmEx)` — converts outbound js.wat exception to JS `Error`:**

```js
function _wrapJswatError(wasmEx) {
  const ptr = wasmEx.getArg(_jswatTag, 0);
  const classId = new Uint32Array(_ex.memory.buffer)[(ptr + 8) >> 2];
  // read message field: str at offset 12 (ptr:4) and 16 (len:4)
  const mem32 = new Uint32Array(_ex.memory.buffer);
  const msgPtr = mem32[(ptr + 12) >> 2];
  const msgLen = mem32[(ptr + 16) >> 2];
  const message = msgPtr ? _readStr(msgPtr, msgLen) : "(no message)";
  // read @jsbind.errorFields if present (offsets from layout data)
  const ErrorClass = _classIdToError.get(classId) ?? JswatError;
  const err = _buildJswatError(ErrorClass, classId, ptr, message);
  _ex.__jswat_rc_dec(ptr);
  return err;
}
```

**`_jsErrorToJswat(e)` — converts inbound JS exception to js.wat AppError:**

```js
function _jsErrorToJswat(e) {
  // if it's a JswatError that originated in js.wat, reuse original pointer
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

Every `@export` wrapper catches `WebAssembly.Exception`:

```js
export const processLine = (line) => {
  const [ptr, len] = _writeStr(line);
  try {
    return _ex.process_line(ptr, len);
  } catch (e) {
    _ex.__jswat_free_raw(ptr);
    if (e instanceof WebAssembly.Exception && e.is(_jswatTag))
      throw _wrapJswatError(e);
    throw e;  // non-jswat exception — pass through unchanged
  } finally {
    // str alloc freed in catch or by WASM (if no exception)
  }
};
```

Every `JSFn` invocation from WASM (`__jswat_invoke_jsfn`) catches JS exceptions:

```js
__jswat_invoke_jsfn: (fnIdx, ...args) => {
  try {
    return _extGet(fnIdx)(...args.map(_unwrapArg));
  } catch (e) {
    const ptr = _jsErrorToJswat(e);
    throw new WebAssembly.Exception(_jswatTag, [ptr]);
  }
}
```

### Debug Poison

| Pattern | Meaning |
|---|---|
| `0xDEADDEAD` | Freed manual object |
| `0x00FACADE` | Freed GC object |
| `0xABABABAB` | Arena-reset region |
| `0xFEEDFEED` | Freed pool slot |

### Initialisation Sequences

**`wasm32-wasip1`:**

```wat
(func $_start (export "_start")
  call $__jswat_init
  call $__random_init
  call $__static_init
)
```

**`wasm32-unknown` / `wasm32-js-*`:**

```wat
(global $__jswat_inited (mut i32) (i32.const 0))
(func $__jswat_init (export "__jswat_init")
  (if (i32.eqz (global.get $__jswat_inited))
    (then
      global.set $__jswat_inited (i32.const 1)
      call $__jswat_heap_init
      call $__static_init
    )
  )
)
(func $user_fn (export "user_fn")
  call $__jswat_init   ;; once-guard
  ...
)
```

**JS bridge initialisation order:**

1. (Module top) Static `import` statements for `//# js.import` third-party dependencies (ESM) or `const require()` calls (CJS).
2. Define all bridge utilities (`_ext*`, `_gl*`, `_enc`, `_dec`, `_writeStr`, `_readStr`, `_wrapJSValue`, `_unwrapJSValue`).
3. Dynamically import plain JS lib files: `const _lib_dom = await import(new URL("./lib/dom.js", import.meta.url))` — one per copied plain JS file.
4. Emit hoisted declarations from all `js { }` blocks (in import order) at module scope.
5. **Detect `SharedArrayBuffer` availability and allocate memory:**
   ```js
   const _sabAvailable = typeof SharedArrayBuffer !== "undefined";
   const _memory = _sabAvailable
     ? new WebAssembly.Memory({ initial: _initialPages, maximum: _maxPages, shared: true })
     : new WebAssembly.Memory({ initial: _initialPages });
   ```
   `_initialPages` and `_maxPages` are derived from the `--max-memory` / `jswat.json` `"memory"` settings. When SAB is unavailable, `maximum` is omitted (not required for non-shared memory). `isSABAvailable` is exported as a JS boolean alongside `@export` wrappers.
6. Construct `_imports` object with all compiler-generated `@jsbind` adapters and std hooks. Pass `_memory` as `env.memory` (always, regardless of `--import-memory`; when `--import-memory` is set the host provides it and this step is skipped).
7. Instantiate WASM: `await WebAssembly.instantiateStreaming(fetch(wasmUrl), _imports)` (or inline bytes for bundle).
8. Capture `_ex = instance.exports` and `_heapBase = _ex.__jswat_heap_base`.
9. Capture `_jswatTag = _ex.__jswat_exception_tag`.
10. Run post-init statements from all `js { }` blocks (in import order).
11. Call `_ex.__jswat_init()`.
12. Export `@export` wrappers and `isSABAvailable`.
13. Run environment detection block (Node.js vs browser).

### Vtable Dispatch

Every class implementing any `@symbol` method gets a vtable at `ptr+4`. Zero if no symbol methods.

```
[ dispose_fn_idx | compare_fn_idx | hash_fn_idx | tostr_fn_idx | ... ]
```

`JSString`, `JSObj`, `JSArr` variants have vtables with dispose entries.

---

## Tree-Shaking

Five levels, automatic. No annotations required.

**Level 1** — User module DCE: unreachable from `@export` + `_start`.
**Level 2** — Stdlib DCE: same analysis on stdlib.
**Level 3** — Runtime DCE after `wasm-merge` + `wasm-opt --dce`.
**Level 4** — RC elimination: binaryen `-O3` escape analysis.
**Level 5** — Target branch folding: all `__target_*` globals folded. On `wasm32-js-*`, `__target_js = 1` eliminates all non-JS branches.

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

# Unified --emit (composable, multiple per invocation)
# Formats: wasm | wat | bir | ast | layout | extern | wit | js | c
# Stages:  parse | lower | opt (default: opt)
jswat compile src/main.js \
  --emit wasm:dist/main.wasm \
  --emit wat:dist/main.wat --emit-stage opt \
  --emit ast:dist/main.ast.json \
  --emit layout:dist/main.layout.json

# Test pragmas
jswat compile src/main.test.js --test-pragmas --check
jswat compile src/main.test.js --test-pragmas -o dist/main.test.wasm

# Other
jswat check  src/main.js
jswat inspect dist/main.wasm
jswat inspect dist/lib.wasm --emit-extern
jswat inspect dist/main.wasm --emit-wit
jswat bindgen src/other.wit -o src/bindings.js

# Memory controls
jswat compile src/main.js --max-memory 64mb -o dist/main.wasm
jswat compile src/main.js --max-memory 1024 -o dist/main.wasm   # 1024 pages = 64MB
jswat compile src/main.js --base-address 65536 -o dist/main.wasm
jswat compile src/main.js --import-memory -o dist/main.wasm

# Linking
jswat compile src/main.js --link mathlib=dist/mathlib.wasm -o dist/app.wasm
jswat compile src/main.js --multi-memory --link-foreign physics=dist/physics.wasm -o dist/app.wasm
```

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

Test files begin with `//# compiler::test` as the first non-empty line. Directives are stripped from normal builds. `--test-pragmas` activates processing. Without it, test files are excluded from the module graph entirely.

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

*End of js.wat Compiler Reference v1.7*