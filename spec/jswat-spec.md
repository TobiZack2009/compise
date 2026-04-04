# js.wat Language Specification
### Version 1.9

> A statically-typed compiled language with JavaScript syntax targeting WebAssembly.
> No eval. No hidden classes. No surprises.

**v1.6 changes:** `str` fat pointer · nullable `str` · StrRef GC promotion · `@ordered` field-declaration-order · `alloc` always in scope · `CE-CF07` · `CE-M*` disambiguation · `undefined` replaces `void` · `.raise()` replaces `?` propagation

**v1.7 changes:** `wasm32-js-*` targets · `JSObject`, `JSValue`, `JSFn`, `JSSymbol` types · `.jsbind.js` binding format · `SharedArrayBuffer` linear memory · JS casting semantics · `@export.jsName`, `@export.rawResult` · `@jsbind.*` pragma family · CE-T20/CE-T21/CE-B*/CW-JS01/CW-B* error codes · CIT compiler test pragma system

**v1.8 changes:** `.jsbind.js` redesign — plain JS files are standard ES modules, binding imports them and uses `@jsbind funcName` to link; marshalling insulation (user JS functions receive/return plain JS values, adapters own all bridge internals); `js { }` block unifies helper and init; `//# js.import` for third-party JS deps; `JSObject` and `JSValue` methods are instance methods; `JSSymbol` semantics defined (`jsSymbol`, `jsSymbolFor`, well-known constants, use as object keys); JS casting rules clarified; removed CE-T16/CE-T17 (standard type errors apply)

**v1.9 changes:** `StringBuilder` removed — `String` is the only string-building type; `new String()` and `new String(capacity)` constructors added; JS-target content reorganised under `## JavaScript Target`; threading removed; `SharedArrayBuffer` optional at runtime (SAB detection, graceful fallback); memory controls added (`--max-memory`, `--base-address`, `--import-memory`); `Fn`/`JSFn` nullable notation corrected (no trailing `?` in code blocks)

*See also: [jswat-std.md](jswat-std.md) — Standard Library v1.8 | [jswat-compiler.md](jswat-compiler.md) — Compiler Reference v1.8*

---

## Targets

js.wat supports seven compile targets set via `--target`.

| Target | Output | WASI | Use case |
|---|---|---|---|
| `wasm32-wasip1` | Core WASM module | WASIp1 imports | WASI runtimes, CLI tools. **Default.** |
| `wasm32-unknown` | Core WASM module | None | Custom host, raw WASM runtimes |
| `wasm32-ld` | Relocatable object | WASIp1 linker-resolved | Mixed-language linking with wasm-ld |
| `wasm32-component` | WASM component | WASIp2 via WIT | Wasmtime, Spin, cross-language composition |
| `wasm32-js-esm` | JS ESM + `.wasm` sidecar | JS bridge | Browser, Node ESM, bundlers |
| `wasm32-js-cjs` | JS CJS + `.wasm` sidecar | JS bridge | Node.js CJS |
| `wasm32-js-bundle` | Single JS file, WASM inlined | JS bridge | CDN, `<script>` tag, single-file distribution |

```bash
jswat compile src/main.js --target wasm32-wasip1   -o dist/main.wasm  # default
jswat compile src/main.js --target wasm32-unknown  -o dist/main.wasm
jswat compile src/main.js --target wasm32-ld       -o dist/main.o
jswat compile src/main.js --target wasm32-component --world wasi:http/proxy -o dist/main.wasm
jswat compile src/main.js --target wasm32-js-esm   -o dist/main.js
jswat compile src/main.js --target wasm32-js-cjs   -o dist/main.cjs
jswat compile src/main.js --target wasm32-js-bundle -o dist/main.bundle.js
```

**`wasm32-wasip1`:** All `wasi_snapshot_preview1.*` imports emitted as needed. `_start` exported. `std/io`, `std/fs`, `std/clock`, `std/process`, `std/random` fully functional. Global RNG seeded from `wasi_random_get`. Runs on Wasmtime, WAMR, wazero, Node.js WASI, Deno.

**`wasm32-unknown`:** Zero WASI imports. No `_start`. `std/io` writes are no-ops by default; host injects implementations via `@external` hooks. `std/fs`, `std/clock`, `std/process` degrade silently. `std/random` seed = 0 unless host provides one.

**`wasm32-ld`:** wasm-ld-compatible relocatable object. Memory and function table imported from environment. `wasi_snapshot_preview1.*` imports emitted unresolved — linker resolves them. Use for mixing with C, Rust, or any wasm-ld-compatible objects.

**`wasm32-component`:** WASM component wrapping a core module with Canonical ABI adapters and a WIT world declaration. System calls go through WIT interfaces. `--world` specifies the WIT world.

**`wasm32-js-esm` / `wasm32-js-cjs` / `wasm32-js-bundle`:** Produce a generated JS bridge alongside the WASM binary (or inlined for bundle). The bridge runs identically in browser, Node.js, and Deno. When `SharedArrayBuffer` is available, WASM linear memory is allocated as a shared buffer enabling WASM atomic instructions. Browser environments that need SAB must be served with COOP/COEP headers. The bridge detects SAB availability at runtime and falls back to non-shared memory gracefully — see *Shared Memory*.

**All targets are WASM32:** `isize`/`usize` are 32-bit on all targets.

---

## Variables

### `let`

`let` declares a mutable, block-scoped binding. `var` is banned — CE-V06.

```js
let x = 42;
let s = "hello";
```

### `const`

`const` declares an immutable binding. Compile-time evaluable expressions are inlined everywhere. Otherwise evaluated once at program start.

```js
const PI = 3.14159;        // compile-time — inlined everywhere
const MAX = 100 * 4;       // compile-time
const START = Clock.now(); // runtime constant — evaluated once at startup
const RNG = new Random(42);
```

`const` means the binding is immutable, not the value it points to:

```js
const x = 42;
x = 10;          // ❌ CE-V01
const p = new Player;
p.score += 1;    // ✅ mutating the object is fine
```

### `static` (class-level)

Static fields are shared across all instances — one allocation in linear memory, globally accessible via class name.

| Keyword | Scope | Mutable | Compile-time? |
|---|---|---|---|
| `const` | block | ❌ binding | if possible |
| `let` | block | ✅ | ❌ |
| `static` (class) | global | ✅ | ❌ |

---

## Types

### Numeric Type Hierarchy

`Number`, `Integer`, and `Float` are **abstract** — usable as type variable constraints and parameter defaults, never directly instantiable.

```
Number
├── Integer
│   ├── i8, u8, i16, u16, i32, u32, i64, u64
│   ├── isize     — pointer-sized signed   (i32 on WASM32)
│   └── usize     — pointer-sized unsigned (u32 on WASM32)
└── Float
    ├── f32
    └── f64
```

All numeric types and `bool` are never nullable. Defaults: `42` → `isize`, `3.14` → `f64`.

### Casting

Constructor-style casts only — no implicit coercion:

```js
i8(x)  u8(x)  i16(x)  u16(x)  i32(x)  u32(x)
i64(x) u64(x) isize(x) usize(x) f32(x) f64(x)
```

Mixed arithmetic without an explicit outer cast is CE-T02. Inside a cast, operands promote to the highest precision present, then the result is cast. Promotion order:

```
i8 → u8 → i16 → u16 → i32 → u32 → i64 → u64 → isize → usize → f32 → f64
```

Float always wins. Overflow wraps for all integer types. `bool` never casts to a number — use a ternary.

**JS-type casting** is covered in *JS Types — Casting*.

### Type Propagation

Once a variable's type is established, subsequent untyped literals adapt:

```js
let x = u8(4);
x = 44;    // ✅ adapts to u8
x = 256;   // ❌ CE-T01: out of range
x += 1;    // ✅
```

Propagation chains through assignments, returns, ternary branches, array elements, and function arguments. Never crosses Integer/Float boundary.

### Strings: `str` and `String`

**`str` — immutable string slice. Nullable. Zero allocation on the non-escaping path.**

`str` is a fat pointer `(ptr: usize, len: usize)`. String literals live in the WASM data segment as raw UTF-8 bytes — no header prefix at the pointed-to address.

**`str` null representation:** `ptr == 0`. An empty non-null `str` has `ptr != 0, len == 0`. Identical layout to `ListView<T>` — consistent null sentinel across all fat-pointer types.

**`str` lifetime and GC promotion.** When a `str` is provably non-escaping — used only within its source's lexical scope — it is a raw fat pointer with zero overhead. When the compiler detects escape, it automatically promotes `str` to a compiler-internal `StrRef`: a heap-allocated RC object holding `(ptr, len)` and a strong RC reference to the owning `String`. Promotion is invisible to the programmer.

The compiler promotes `str` to `StrRef` when any of the following is detected:
- Assignment to a class field
- Capture in a closure
- Return from a function
- Storage into an array or collection
- Assignment to a `let` binding that outlives the source `String`'s lexical scope

`str` from a literal always points to the permanently-live data segment — promotion is a no-op. `StrRef` is compiler-internal and never appears in user-visible signatures or error messages. The calling convention for `str` is always `(i32, i32)` regardless of StrRef backing.

```js
class Post {
  title;
  constructor(t = "") {
    this.title = t;   // str escapes into a field — StrRef allocated automatically
  }
}

function greet(name = "") {
  console.log(`Hello, ${name}`);  // str used locally — raw fat pointer, no allocation
}
```

**`String` — heap-allocated mutable string. Nullable by default. RC-managed. In the implicit prelude.**

`String` is the only string-building type. There is no separate builder — append directly to a `String`.

```js
// construction
new String()                   // empty String, default capacity
new String(capacity = usize(0)) // empty String with capacity hint — avoids reallocation
new String("hello")            // String from str literal
`hello, ${name}`               // String from template literal

// read (available on both str and String)
s.length                              // usize
s.at(n = usize(0))                    // str — single character
s.slice(start = usize(0), end = usize(0))  // str (str source) / String (String source)
s.indexOf(sub = "")                   // isize? — null if not found
s.lastIndexOf(sub = "")              // isize?
s.includes(sub = "")                 // bool
s.startsWith(pre = "")              // bool
s.endsWith(suf = "")                // bool
s.trim()                             // str / String
s.trimStart()                        // str / String
s.trimEnd()                          // str / String
s.toUpperCase()                      // String — allocates
s.toLowerCase()                      // String — allocates
s.replace(from = "", to = "")        // String — allocates
s.replaceAll(from = "", to = "")     // String — allocates
s.split(sep = "")                    // str[] — no allocation
s.padStart(n = usize(0), fill = "")  // String — allocates
s.padEnd(n = usize(0), fill = "")    // String — allocates
s.repeat(n = usize(0))               // String — allocates

// mutation (mutable unaliased let binding only)
s.append(other = "")           // undefined — CE-S01 if aliased, CE-S03 if const
s.set(i = usize(0), ch = "")  // undefined — single character replacement

// low-level
s.$asView()    // str — zero-copy view into String's buffer; compiler promotes if escaping
s.$dataPtr()   // usize — raw UTF-8 buffer address
s.$capacity    // usize
```

Static:

```js
String.fromCodePoint(cp = u32(0))   // String — heap
```

`s.$asView()` returns a `str` pointing into the `String`'s heap buffer. If that `str` escapes, the compiler emits a `StrRef` and bumps the `String`'s RC — no manual lifetime management needed.

**Incremental construction pattern:**

```js
let s = new String(usize(256));   // pre-allocate capacity
s.append("Name: ");
s.append(name);
s.append(", score: ");
s.append(`${score}`);
// s is the complete string — no intermediate allocations if capacity was sufficient
```

**Template literals always produce `String`.** Interpolatable: integers, floats, `bool`, `str`, `String`, any class implementing `Symbol.toStr`.

| Type | Template output |
|---|---|
| Integer subtypes | Decimal, `-` for negatives |
| Float subtypes | Shortest round-trip (Ryu) |
| `bool` | `"true"` or `"false"` |
| `str` | Direct — zero copy |
| `String` | Copies content |
| Class with `Symbol.toStr` | Calls `toStr()` |

### Nullability

Class instances, arrays, `String`, `Box<T>`, `List<T>`, and `str` are nullable by default. Numeric types and `bool` are never nullable. `JSObject`, `JSFn`, and `JSSymbol` are nullable (index 0).

**Primitive optionals** — `isize?`, `u8?`, `f64?`, `bool?` etc. — two-word `(value, is_null)` representation. No boxing. `??` compiles to `i32.select` — branchless.

| Type | Null representation |
|---|---|
| Class, array, `String`, `Box<T>`, `List<T>` | `ptr = 0x00000000` |
| `str` | `ptr = 0x00000000` (first word of fat pointer) |
| `JSObject`, `JSFn`, `JSSymbol` | externref table index = 0 |
| `i8?`–`usize?` | `(value: i32, is_null: i32)` |
| `i64?`, `u64?` | `(value: i64, is_null: i32)` |
| `f32?` | `(value: f32, is_null: i32)` |
| `f64?` | `(value: f64, is_null: i32)` |
| `bool?` | `(value: i32, is_null: i32)` |

```js
p?.x;            // safe — null propagates
p.x;             // fast — UB if null in release, RT-06 in debug
p?.x ?? 0.0;     // fallback
p ??= new Point; // assign if null
```


### JS Types

`JSObject`, `JSValue`, `JSFn`, and `JSSymbol` are defined in full in the *JavaScript Target* section below. They are importable on all targets; on non-`wasm32-js-*` targets all values are null/no-op (CW-JS01).



## Classes

Every object is a named class instance. Purely nominal type system. Classes are sealed at definition — no open-ended extension.

**Construction forms:**

```js
new Vec2(1.0, 2.0)             // positional
new Vec2({ x: 1.0, y: 2.0 })  // named argument block — not an object literal
new Vec2                        // all defaults
```

Named argument blocks require all keys to match constructor parameter names and types exactly. Unknown keys — CE-C01. Type mismatches — CE-C02.

**Private fields:** compile-time only. Zero runtime overhead. Not accessible from subclasses.

**Static members:** no `this`, accessed via class name only. Inherited by subclasses. Static-only classes cannot be instantiated — CE-C04.

**Getters** allowed with or without setter. **Setters without getter — CE-C07.**

**Inheritance:** single only. Child adds fields only. `super()` required before `this` in child constructors — CE-C09/CE-C06.

**`@derive` pragma:** `toStr`, `hash`, `compare`. `@derive hash` uses FNV-1a over all fields in declaration order. `@derive compare` is lexicographic in field declaration order. A manually implemented symbol overrides the derived one.

**`@ordered` pragma:** fields stored in **field declaration order** — top to bottom in the class body. Constructor assignment order is irrelevant. Use for network protocols, binary formats, FFI.

---

## Sealed Unions — `static $variants`

A class with `static $variants = []` is a sealed union base. The compiler scans the same file, collects every `class X extends Base`, and treats those as the complete variant set. Never assign to `$variants` — CE-C15.

```js
class Shape { static $variants = []; }
class Circle extends Shape {
  radius;
  constructor(r = 0.0) { super(); this.radius = r; }
}
class Rect extends Shape {
  w; h;
  constructor(w = 0.0, h = 0.0) { super(); this.w = w; this.h = h; }
}
```

Switch on a sealed union must be exhaustive — no `default`. `case ClassName:` performs `class_id` narrowing. `extends SealedBase` outside the defining file — CE-C11.

`JSValue` is a compiler-defined sealed union. User code cannot extend it — CE-C11.

---

## Memory Layout

**Object header — 12-byte prefix on every heap object:**

```
Offset 0   rc_class   [ bit 31 = manual sentinel | bit 30 = reserved |
                        bits 29–24 = size-class (0–63) | bits 23–0 = refcount (max 16M) ]
           0xFFFFFFFF = manual sentinel — RC skipped entirely
Offset 4   vtable_ptr [ pointer to vtable, 0 if no symbol methods ]
Offset 8   class_id   [ unique u32 per class, compiler-assigned ]
Offset 12  fields...
```

**Compact field layout (default):** sorted by descending size to minimise padding:

```
Sort order: f64/i64/u64 (8) → f32/i32/u32/isize/usize/ptr (4) → i16/u16 (2) → i8/u8/bool (1)
```

**`@ordered` layout:** fields in field declaration order. Header at offset 0. Field 0 = first field in class body.

**Inheritance layout:** parent fields always form a prefix of child layout.

**`JSValue` heap layout** (when stored to a field or collection):

```
Offset 0   rc_class    4    — GC managed
Offset 4   vtable_ptr  4    — dispose frees JSString str alloc or calls _extDel
Offset 8   class_id    4    — one per variant
Offset 12  tag         4    — variant tag (0–8)
Offset 16  payload     8    — variant payload
```

**Compiler-generated `$`-prefixed properties:**

| Property | Description |
|---|---|
| `T.$byteSize` | Total allocation size including header |
| `T.$stride` | Element step for array traversal |
| `T.$headerSize` | Always `usize(12)` |
| `T.$classId` | Compiler-assigned `u32`, stable within a build |
| `T.$offset(n)` | Byte offset of nth declared field from object start (declaration order) |
| `T.$dataOffset(n)` | Byte offset of nth declared field from data start (declaration order) |
| `e.$addr` | Base address of any heap object — read-only |

`T.$offset(n)` uses declaration order as the index. Out-of-range — CE-C10. User identifiers starting with `$` — CE-V05.

**Debug poison patterns:**

| Pattern | Meaning |
|---|---|
| `0xFFFFFFFF` | Live manual object (sentinel) |
| `0xDEADDEAD` | Freed manual object |
| `0x00FACADE` | Freed GC object |
| `0xABABABAB` | Arena-reset region |
| `0xFEEDFEED` | Freed pool slot |

---

## Arrays, List, ListView, Box

**Arrays** — typed, homogeneous, dynamic. Nullable. Element type inferred from literal or first `push`. `pop()` returns `T?`.

```js
let bytes = [u8(0)];
bytes.push(44);       // ✅ adapts to u8
bytes[usize(0)] = 255;
bytes.length;         // usize
bytes.pop();          // u8? — null if empty
bytes.$ptr;           // usize — data buffer address
bytes.$capacity;      // usize
```

Layout: `[ rc_class:4 | vtable_ptr:4 | class_id:4 | length:4 | capacity:4 | *data:4 ]` + separate data buffer.

**`List<T>`** — fixed-size contiguous buffer. One allocation. Inline data after header. Element type must be numeric primitive or `bool` — CE-A11 otherwise.

```js
const buf = new List(f32, usize(256));            // GC-managed
const buf = alloc.create(List, f32, usize(256));  // manually managed

buf[usize(0)]             // f32
buf[usize(0)] = f32(1.0)  // write
buf.length                // usize — fixed
buf.$ptr                  // usize — address of first element
buf.$byteSize             // usize — total data bytes
```

Layout: `[ rc_class:4 | vtable_ptr:4 | class_id:4 | length:4 | elem_0 | ... ]`. Total: `16 + length × T.$byteSize` padded to alignment of `T`.

On `wasm32-js-*` targets, `List<f32>` / `List<u8>` etc. can be returned to the bridge as zero-copy `TypedArray` views into linear memory (shared or non-shared).

**`ListView<T>`** — untracked typed view. Value type `(data_ptr: usize, length: usize)`. No heap allocation, no RC. Range arguments are in bytes — must divide evenly by `T.$byteSize` (CE-A10 compile-time, RT-10 runtime). Views on manually allocated lists — CE-A12.

**`Box<T>`** — heap-allocates any value. GC-managed, RC'd. Builtin.

```js
let b = box(isize(5));
b.$val++;
b.$addr;   // usize — header address
```

---

## Functions and Closures

Every parameter requires a default value as its type contract.

**`Fn` type syntax:**

```js
Fn(isize => bool)              // one param, returns bool
Fn(isize, isize => isize)      // two params
Fn(() => undefined)            // no params, no return
Fn(isize => bool)             // nullable function value
Fn(n: isize => bool)           // named param — documentation only
```

`undefined` in `Fn()` return position means "no return value." `undefined` elsewhere as a type annotation — CE-T11.

**Non-capturing arrows:** zero allocation. Represented as `(fn_index, env_ptr=0)`.

**Capturing closures:** heap allocated, RC'd. Capture rules:
- Scalars — captured by value copy
- Heap types — captured by RC reference
- `str` — captured by value; compiler emits StrRef if backed by heap `String`
- `ListView<T>` — captured by value; lifetime is programmer's responsibility
- Mutable `let` captured — CE-F11; use `box()` for shared mutable state
- Recursive arrow closures — CE-F12; use named function declarations

**`JSFn` vs `Fn`:** `JSFn<sig>` holds a JS function in the externref table. `Fn(...)` holds a js.wat closure as `(fn_index, env_ptr)`. They are not interchangeable — CE-T01.

---

## Generics and Type Variables

Classes and functions monomorphize per unique type combination. Type variables link multiple positions to the same inferred type and are erased at call sites.

```js
function map(arr = [T], fn = Fn(T => T), T = Integer) { }
map([u8(0)], n => u8(n * u8(2)));  // T=u8
```

Constraint syntax: `T = Integer`, `T = Float`, `T = Number`, `T = any`, `T = Comparable`, `T = Hashable & Equatable`. `&` valid only in type variable default — CE-T13 elsewhere. `any` as a value — CE-T14.

Type variables declared in a constructor are in scope for all instance methods.

---

## Type Narrowing

**Switch:** `case ClassName:` performs `class_id` narrowing. Not value equality. Exhaustive for sealed unions. Non-sealed switch requires `default` — CE-CF08.

**`instanceof`:** same `class_id` check. Works on sealed and non-sealed classes, and on `JSValue` variants.

**Null checks:** `if (p != null) { p.x; }` — `p` narrowed to non-null inside the block.

---

## Symbols and Traits

| Symbol | Purpose | Return type |
|---|---|---|
| `Symbol.iterator` | `for...of` support | class implementing `Symbol.next` |
| `Symbol.next` | iterator step | `IteratorResult<T>` |
| `Symbol.toStr` | template literal interpolation | `String` |
| `Symbol.compare` | ordering for sort | `isize` |
| `Symbol.hash` | hash for Map/Set | `isize` |
| `Symbol.equals` | equality for Map/Set | `bool` |
| `Symbol.dispose` | cleanup on free | `undefined` |

---

## Destructuring

```js
const { x, y } = new Point(1.0, 2.0);
const { x: myX } = new Point(1.0, 2.0);
const [first, ...rest] = nums;
```

Nested destructuring — CE-A04. Nullable without null check — CE-A05.

---

## Control Flow

Standard JS: `if/else`, `for`, `while`, `do/while`, `switch`, `break/continue`, `return`, `throw/try/catch/finally`. `for...of` over arrays, strings, `Symbol.iterator` implementors. `for...in` banned — CE-CF01.

**`throw`/`catch`:** class instances only. WASM exception instructions. `instanceof` narrowing in catch. `else throw e` required unless last branch handles `AppError` — CE-CF09.

**Exceptions crossing the JS boundary** on `wasm32-js-*` targets: the bridge converts automatically — see *JS Targets — Error Handling at the Boundary*.

---

## JSDoc Annotations

Annotations are optional — the compiler infers from defaults. Required only when inference is ambiguous.

### `@returns`

Required when: return type is ambiguous (CW-F01 if missing), recursive function (CE-F07), `@export` with ambiguous return (CE-F08), function uses `.raise()` (CE-F07). Nullable types: `{isize?}`, `{Player?}`.

### `@param`

Optional. Cross-checked against inferred type — CE-F09 if conflicts. CW-F03 if redundant.

### Pragma tags

| Tag | Applies to | Effect |
|---|---|---|
| `@export name` | function, static method | Exports to WASM host with given name |
| `@export.jsName name` | function | Override the JS-facing wrapper function name in the bridge |
| `@export.rawResult` | `Result<T>` function | Bridge returns `{ok, err}` object instead of throwing |
| `@external mod.fn` | function declaration | Declares a host-provided function |
| `@symbol Symbol.X` | method | Implements well-known symbol |
| `@ordered` | class | Field layout in declaration order |
| `@derive toStr, hash, compare` | class | Auto-generate symbol implementations |
| `@jsbind funcName` | `@external` function declaration | Links to named JS export — see *JS Bindings* |
| `@jsbind.get funcName` | getter in `@jsbind.type` class | Getter linked to named JS export |
| `@jsbind.set funcName` | setter in `@jsbind.type` class | Setter linked to named JS export |
| `@jsbind.type` | class extending `JSObject` | Declares a JS-backed opaque type |
| `@jsbind.jsType "Name"` | `@jsbind.type` class | JS constructor name for `instanceof` checks |
| `@jsbind.error` | `AppError` subclass | JS-representable error |
| `@jsbind.errorFields f:T,...` | `@jsbind.error` class | Extra fields to extract when converting to JS Error |

---

## Host Interop

### `@external`

```js
/**
 * @external env.platform_log
 * @returns {undefined}
 */
function platformLog(msg = "") { }
```

### `@export`

```js
/** @export on_tick */
function tick(dt = 0.0) { }

class Game {
  /** @export game_update */
  static update(dt = 0.0) { }
}
```

`export` keyword = inter-module visibility for other js.wat files. `@export` = WASM host visibility. Orthogonal.

**`@export.jsName`** — override the exported wrapper name in the JS bridge. Useful when the js.wat function name conflicts with a JS reserved word or existing API:

```js
/**
 * @export tick
 * @export.jsName onTick
 */
function tick(dt = 0.0) { }
// bridge exports: export const onTick = (dt) => { ... }
```

**`@export.rawResult`** — for `@export` functions returning `Result<T>`. Default mode throws a JS error on `Err`. `rawResult` mode returns `{ok: T|null, err: Error|null}` without throwing:

```js
/**
 * @export parse_json
 * @export.rawResult
 * @returns {Result<String>}
 */
function parseJson(input = "") { ... }
// bridge: export const parse_json = (s) => { ...returns {ok, err}... }
```

### `wasm32-unknown` Host Hooks

| Hook | Signature | Purpose |
|---|---|---|
| `__jswat_io_write` | `(ptr: usize, len: usize, fd: i32)` | stdout/stderr |
| `__jswat_io_read` | `(ptr: usize, maxLen: usize) → usize` | stdin |
| `__jswat_clock_now` | `() → i64` | wall clock nanoseconds |
| `__jswat_random_get` | `(ptr: usize, len: usize)` | entropy fill |
| `__jswat_process_exit` | `(code: i32)` | process exit |

---


## JavaScript Target

This section covers everything specific to the `wasm32-js-esm`, `wasm32-js-cjs`, and `wasm32-js-bundle` compile targets. On other targets, `JSObject`, `JSValue`, `JSFn`, and `JSSymbol` are available as importable types but all values are null/no-op and CW-JS01 fires once per file.

---

### JS Types

The following four types are available on all targets. On non-`wasm32-js-*` targets they degrade gracefully — all values are null/zero/no-op. CW-JS01 fires once per file that imports or uses them on a non-JS target.

#### `JSObject`

An opaque reference to any JS heap value — object, array, function, DOM node, Map, Date, or any non-primitive. Represented as `i32` externref table index. Nullable — index 0 is null.

`JSObject` has reference identity. Two `JSObject` values are equal iff they refer to the same JS object (`===`). No structural equality.

**Lifetime.** The externref table holds a strong JS reference preventing GC of the JS value. Each table slot carries a reference count: incremented when the index is passed to a function, decremented when the callee returns. When the count reaches zero the slot is freed and the strong JS reference released. A `FinalizationRegistry` safety net calls `_extDel` if the WASM module drops a reference without explicit cleanup.

**JS null vs WASM null.** A `JSObject` at WASM index 0 means the slot is empty — that is WASM-null. A non-null `JSObject` that holds the JS value `null` is different — use `.isJSNull()` to test. Likewise `.isUndefined()` tests for the JS `undefined` value.

**All operations on `JSObject` are instance methods:**

```js
// property access
// typed variants (getStr, getF64, etc.) throw a JS TypeError if actual value doesn't match
// untyped get returns JSValue and always succeeds
obj.get(key = "")                           // JSValue
obj.getStr(key = "")                        // str
obj.getF64(key = "")                        // f64
obj.getI32(key = "")                        // i32
obj.getBool(key = "")                       // bool
obj.getObj(key = "")                        // JSObject?

// property set
obj.set(key = "", val = JSValue)            // undefined
obj.setStr(key = "", val = "")              // undefined
obj.setF64(key = "", val = 0.0)            // undefined
obj.setI32(key = "", val = i32(0))         // undefined
obj.setBool(key = "", val = false)         // undefined

// Symbol-keyed access — JSSymbol is a distinct type from str (see JSSymbol section)
obj.getSymbol(key = JSSymbol)               // JSValue
obj.setSymbol(key = JSSymbol, val = JSValue) // undefined
obj.hasSymbol(key = JSSymbol)               // bool
obj.deleteSymbol(key = JSSymbol)            // bool
obj.callSymbol(key = JSSymbol, ...)         // JSValue

// method calls
// typed variants (callStr, callF64, etc.) throw JS TypeError if return doesn't match
obj.call(method = "", ...)                  // JSValue
obj.callStr(method = "", ...)               // str
obj.callF64(method = "", ...)               // f64
obj.callI32(method = "", ...)               // i32
obj.callBool(method = "", ...)              // bool
obj.callObj(method = "", ...)               // JSObject?
obj.callVoid(method = "", ...)              // undefined

// type introspection
obj.typeof()                                // str — "object", "function", "number" etc.
obj.instanceof(ctor = JSObject)             // bool
obj.isArray()                               // bool
obj.isJSNull()                              // bool — JS null (distinct from WASM null)
obj.isUndefined()                           // bool — JS undefined

// conversion to js.wat primitives
obj.toStr()                                 // String — calls JS toString()
obj.toF64()                                 // f64 — calls JS Number()
obj.toI32()                                 // i32 — JS Number() then | 0
obj.toBool()                                // bool — JS truthy coercion

// identity
obj.eq(other = JSObject)                    // bool — ===
```

**Static:**

```js
JSObject.new(ctor = JSObject, ...)          // JSObject — new ctor(...)
jsGlobal(name = "")                         // JSObject — globalThis[name]
jsGlobalThis()                              // JSObject — globalThis itself
```

On non-`wasm32-js-*` targets: every method is a no-op returning zero/null/false/"". CW-JS01 emitted once per file.

#### `JSValue`

A sealed union representing any value JS can produce. Used as the return type of JS operations whose static type is unknown. `JSValue` is **never WASM-nullable** — `JSNull` and `JSUndefined` variants cover JS's own absence cases.

**Variants:**

```js
class JSValue { static $variants = []; }  // compiler-sealed, never user-extendable

class JSUndefined extends JSValue { }
class JSNull      extends JSValue { }
class JSBool      extends JSValue { value; constructor(v = false)    { } }
class JSInt       extends JSValue { value; constructor(v = i32(0))   { } }
class JSNumber    extends JSValue { value; constructor(v = 0.0)      { } }
class JSBigInt    extends JSValue { value; constructor(v = i64(0))   { } }
class JSString    extends JSValue { value; constructor(v = "")       { } }  // str
class JSObj       extends JSValue { value; constructor(v = JSObject) { } }
class JSArr       extends JSValue {
  value;    // JSObject — the underlying JS array
  length;   // usize — populated eagerly when the variant is constructed
  constructor(v = JSObject) { }
}
```

`JSInt` is produced when a JS `number` is an integer in the i32 range (`Number.isInteger(v) && v >= -2^31 && v <= 2^31-1`). Otherwise `JSNumber`. This avoids unnecessary f64 round-trips for DOM queries and array indices.

`JSString.value` is a `str` pointing into WASM linear memory allocated by the bridge. It is freed when the `JSString` variant goes out of scope.

`JSObj.value` and `JSArr.value` are `JSObject` externref handles, released via `_extDel` on scope exit.

**Narrowing — switch must be exhaustive:**

```js
function describe(val = JSValue) {
  switch (val) {
    case JSUndefined: return "undefined";
    case JSNull:      return "null";
    case JSBool:      return val.value ? "true" : "false";
    case JSInt:       return `int:${val.value}`;
    case JSNumber:    return `num:${val.value}`;
    case JSBigInt:    return `big:${val.value}n`;
    case JSString:    return val.value;
    case JSObj:       return "[object]";
    case JSArr:       return `[array(${val.length})]`;
  }
}
```

After narrowing, `val.value` is directly accessible at the correct type — no additional cast.

**All operations on `JSValue` are instance methods (base class, dispatch by variant):**

```js
// narrowing helpers — static dispatch, no bridge call
val.isNullish()              // bool — JSNull or JSUndefined
val.isTruthy()               // bool — JS truthiness semantics
val.isString()               // bool — JSString variant
val.isNumber()               // bool — JSNumber or JSInt
val.isBool()                 // bool
val.isObject()               // bool — JSObj or JSArr
val.isArray()                // bool — JSArr only
val.isBigInt()               // bool

// extraction with fallbacks (no coercion — type-match or fallback)
val.asStr(fallback = "")            // str   — JSString.value or fallback
val.asF64(fallback = 0.0)          // f64   — JSNumber or JSInt coerced, else fallback
val.asI32(fallback = i32(0))       // i32   — JSInt, or truncated JSNumber, else fallback
val.asBool(fallback = false)       // bool  — JSBool.value, else fallback
val.asObj()                         // JSObject? — JSObj/JSArr .value, else null
val.asBigInt(fallback = i64(0))    // i64   — JSBigInt.value, else fallback

// JS coercion — mirrors JS's own type coercion rules exactly
// coerce* for JSObj/JSArr makes a bridge call; all other variants are static dispatch
val.coerceStr()              // String — JS String(value) semantics
val.coerceF64()              // f64   — JS Number(value) semantics
val.coerceI32()              // i32   — JS (value | 0) semantics
val.coerceBool()             // bool  — JS Boolean(value) semantics
```

**`as*` vs `coerce*`:** `as*` extracts only if the variant matches, returning the fallback otherwise — no type conversion. `coerce*` applies full JS coercion rules: `coerceStr()` on `JSInt(42)` returns `"42"`; `coerceF64()` on `JSBool(true)` returns `1.0`; `coerceI32()` on `JSString("42")` returns `42`.

**Coercion rules in full:**

`coerceStr()`: `JSNull`→`"null"`, `JSUndefined`→`"undefined"`, `JSBool(true)`→`"true"`, `JSBool(false)`→`"false"`, integers→decimal, `JSNumber`→shortest round-trip, `JSBigInt`→decimal without `n`, `JSString`→identity, `JSObj`/`JSArr`→bridge call to JS `String(obj)`.

`coerceF64()`: `JSNull`/`JSBool(false)`/`JSString("")`→`0.0`, `JSUndefined`/unparseable string→NaN, `JSBool(true)`→`1.0`, `JSInt`/`JSNumber`→identity, `JSBigInt`→f64 (may lose precision), `JSString`→parse as number, `JSObj`/`JSArr`→bridge call to JS `Number(obj)`.

`coerceI32()`: `coerceF64()` then `| 0` (JS bitwise truncation to signed 32-bit).

`coerceBool()`: `JSUndefined`, `JSNull`, `JSBool(false)`, `JSInt(0)`, `JSNumber(0.0)`, `JSNumber(NaN)`, `JSBigInt(0)`, `JSString("")` → `false`; everything else → `true`.

**Static factory methods:**

```js
JSValue.fromStr(v = "")           // JSValue — JSString variant
JSValue.fromF64(v = 0.0)         // JSValue — JSNumber variant
JSValue.fromI32(v = i32(0))      // JSValue — JSInt variant
JSValue.fromBool(v = false)      // JSValue — JSBool variant
JSValue.fromBigInt(v = i64(0))   // JSValue — JSBigInt variant
JSValue.fromObj(v = JSObject)    // JSValue — JSObj variant
JSValue.null()                    // JSValue — JSNull variant
JSValue.undefined()               // JSValue — JSUndefined variant
```

**`JSArr` additional instance methods:**

```js
arr.at(i = usize(0))                          // JSValue
arr.push(val = JSValue)                       // undefined
arr.forEach(fn = JSFn(JSValue => undefined))  // undefined
```

On non-`wasm32-js-*` targets: all `JSValue` instances are `JSNull`. All `coerce*` and `as*` return their zero-value fallback. `JSValue.from*` factories return `JSNull`. Switch narrowing on `JSValue` executes the `JSNull` branch.


#### `JSFn<sig>`

A typed reference to a JS function. Represented as `i32` externref table index. Nullable. Distinct from js.wat `Fn(...)` — CE-T01 if used interchangeably.

```js
JSFn(isize => bool)           // one parameter, one return
JSFn(str, f64 => JSValue)     // two parameters
JSFn(() => undefined)         // no parameters, no return
JSFn(JSObject => JSObject)   // nullable JSFn
```

Calling a `JSFn` compiles to a dedicated bridge import per signature: `__jswat_call_jsfn_<encoded_sig>`. One import per distinct `JSFn` signature used in the program. The bridge unmarshals WASM-level parameters to plain JS values, calls the function, and marshals the return back.

`JSFn` widening to `JSObject`: `JSObject(fn)` — valid because JS functions are objects. `JSObject` narrowing to `JSFn`: requires explicit `@returns` annotation — no runtime check, JS TypeError if the object is not callable.

#### `JSSymbol`

An opaque reference to a JS `Symbol` value. Represented as `i32` externref table index. Nullable. Distinct from `JSObject` — the compiler treats them as unrelated types. Passing a `JSSymbol` where `JSObject` is expected (or vice versa) is CE-T01.

A JS `Symbol()` is a unique unforgeable identity token. Descriptions are documentation only — two `Symbol("tag")` calls produce different symbols even with the same description string.

**Creating symbols:**

```js
import { jsSymbol, jsSymbolFor } from "std/js";

// Module-scope const — create once, use everywhere
const MY_TAG  = jsSymbol("my-tag");          // fresh Symbol("my-tag") — unique per call
const APP_KEY = jsSymbolFor("com.app.key");  // Symbol.for("com.app.key") — global registry
```

`jsSymbol(desc)` is equivalent to JS `Symbol(desc)` — creates a new unique symbol on every call. **Always call at module scope as a `const`**, not inside functions. Calling inside a function creates a new symbol on every invocation, which is almost always a bug.

`jsSymbolFor(key)` returns the global registry symbol for `key` — the same symbol is returned for the same key anywhere in the JS runtime, including across module boundaries.

**Well-known symbol constants** — pre-acquired at bridge init, available from `std/js`:

```js
JS_SYMBOL_ITERATOR        // Symbol.iterator
JS_SYMBOL_ASYNC_ITERATOR  // Symbol.asyncIterator
JS_SYMBOL_TO_PRIMITIVE    // Symbol.toPrimitive
JS_SYMBOL_TO_STRING_TAG   // Symbol.toStringTag
JS_SYMBOL_HAS_INSTANCE    // Symbol.hasInstance
JS_SYMBOL_DISPOSE         // Symbol.dispose
```

**Instance method:**

```js
sym.eq(other = JSSymbol)   // bool — same Symbol? (===)
```

**Using `JSSymbol` as an object key:**

```js
// Symbol-keyed property access on JSObject
obj.getSymbol(key = JSSymbol)                     // JSValue
obj.setSymbol(key = JSSymbol, val = JSValue)      // undefined
obj.hasSymbol(key = JSSymbol)                     // bool
obj.deleteSymbol(key = JSSymbol)                  // bool
obj.callSymbol(key = JSSymbol, ...)               // JSValue — calls obj[sym](...)
```

Example — iterating any JS iterable using `Symbol.iterator`:

```js
import { JS_SYMBOL_ITERATOR } from "std/js";

function iterateJS(collection = JSObject) {
  const iter = collection.callSymbol(JS_SYMBOL_ITERATOR);   // JSValue
  const iterObj = iter.asObj();                              // JSObject?
  if (iterObj == null) return;
  let done = false;
  while (!done) {
    const result = iterObj.callObj("next");                  // JSObject?
    done = result?.getBool("done") ?? true;
    if (!done) {
      const val = result?.get("value");                      // JSValue?
      // handle val
    }
  }
}
```

**`JSSymbol` in `@jsbind` functions:** when a js.wat function has a `JSSymbol` parameter, the adapter extracts the real `Symbol` from the externref table and passes it to the JS function, which can use it as `obj[symbol] = value` naturally. The JS function never sees externref indices.

On non-`wasm32-js-*` targets: `jsSymbol` and `jsSymbolFor` return null. All `JSSymbol` operations are no-ops. CW-JS01 emitted once per file.

### JS Types — Casting

js.wat's constructor-cast system extends naturally to JS types.

**`JSValue(x)` — wrap any js.wat primitive or JS-world value as `JSValue`:**

```js
JSValue(isize(42))   // JSInt variant — via JSValue.fromI32
JSValue(3.14)        // JSNumber variant — via JSValue.fromF64
JSValue(true)        // JSBool variant — via JSValue.fromBool
JSValue("")          // JSString variant — via JSValue.fromStr
JSValue(myObj)       // JSObj variant — myObj must be JSObject
JSValue(null)        // JSNull variant
```

The compiler selects the correct `JSValue.from*` static based on the static type of `x`. This is a compile-time selection — no runtime dispatch.

**`f64(v)`, `i32(v)`, `str(v)`, `bool(v)` — extract from `JSValue`:**

These use `as*` semantics — type-match or zero fallback, no JS coercion:

```js
f64(myVal)    // myVal.asF64(0.0)   — 0.0 if not JSNumber/JSInt
i32(myVal)    // myVal.asI32(0)     — 0 if not JSInt/JSNumber
str(myVal)    // myVal.asStr("")    — "" if not JSString (no coercion)
bool(myVal)   // myVal.asBool(false)
```

For JS-semantic coercion use the `coerce*` instance methods explicitly:

```js
myVal.coerceF64()    // JS Number() semantics — parses strings, coerces objects
myVal.coerceStr()    // JS String() semantics — converts anything
myVal.coerceI32()    // JS (value | 0) semantics
myVal.coerceBool()   // JS Boolean() semantics — JS truthiness
```

**`JSObject(fn)` — widen `JSFn` to `JSObject`:**

JS functions are objects. Always valid. Zero cost — same externref index, different static type.

```js
const fn = getParser(raw);          // JSFn(str => f64)
const obj = JSObject(fn);           // JSObject — valid widening
const name = obj.getStr("name");    // function.name property
```

**`JSObject` → `JSFn<sig>` — narrowing:**

Requires an explicit `@returns` annotation at the call site. No runtime check — if the `JSObject` is not callable, the bridge throws a JS `TypeError` when the `JSFn` is eventually called.

```js
/** @returns {JSFn(str => f64)} */
function getParser(obj = JSObject) {
  return obj;
}
```

**`T(obj)` — reinterpret `JSObject` as `@jsbind.type T`:**

Same externref index, different static type. Zero cost. No runtime check. If the JS object is not of the expected type, subsequent method calls produce JS errors.

```js
const raw = jsGlobal("document").callObj("getElementById", ...);  // JSObject?
const el  = HTMLElement(raw);   // HTMLElement? — reinterpret, programmer's responsibility
```

Checked cast using `.instanceof`:

```js
const elCtor = jsGlobal("HTMLElement");
const el = raw?.instanceof(elCtor) ? HTMLElement(raw) : null;
```

**`JSObject(t)` — widen `@jsbind.type T` to `JSObject`:**

Always valid — all `@jsbind.type` classes are subtypes of `JSObject`.

**`JSValue` variant narrowing via `instanceof`:**

After `instanceof` narrowing, the `.value` field is accessible at the correct type without further cast:

```js
if (myVal instanceof JSString) {
  const s = myVal.value;   // str — no cast needed
}
if (myVal instanceof JSObj) {
  const o = myVal.value;   // JSObject — can call instance methods
}
```

**Forbidden cross-JS-type casts:**

```js
JSSymbol(obj)    // CE-T01 — JSObject and JSSymbol are unrelated types
JSObject(sym)    // CE-T01 — cannot widen JSSymbol to JSObject
```

`JSSymbol` and `JSObject` are distinct opaque types. There is no valid cast between them.

**Complete casting table:**

| From | To | How | Runtime check |
|---|---|---|---|
| js.wat primitive | `JSValue` | `JSValue(x)` — compile-time dispatch | ❌ |
| `JSValue` | js.wat primitive (extract) | `f64(v)`, `i32(v)` etc. — `as*` semantics | ❌ — zero fallback |
| `JSValue` | js.wat primitive (JS coerce) | `v.coerceF64()` etc. | ❌ for primitives; bridge call for JSObj/JSArr |
| `JSValue` variant | `.value` field | `instanceof` narrowing | ✅ compile-time exhaustiveness |
| `JSFn` | `JSObject` | `JSObject(fn)` — widening | ❌ — always valid |
| `JSObject` | `JSFn<sig>` | `@returns` annotation | ❌ — JS TypeError if not callable |
| `JSObject` | `@jsbind.type T` | `T(obj)` — reinterpret | ❌ — programmer responsibility |
| `@jsbind.type T` | `JSObject` | `JSObject(t)` — widening | ❌ — always valid |
| `JSObject` | `JSSymbol` | CE-T01 — not allowed | — |
| `JSSymbol` | `JSObject` | CE-T01 — not allowed | — |

**On non-`wasm32-js-*` targets:** all JS-type casts fold to zero/null at compile time via Level 5 DCE. `JSValue(x)` → `JSNull`. `f64(jsVal)` → `0.0`. `JSObject(fn)` → null. `T(raw)` → null. Code compiles and runs — JS-world operations simply return zero values.

---

---


### Shared Memory

On `wasm32-js-*` targets, the bridge detects `SharedArrayBuffer` availability at runtime before instantiating the WASM module:

```js
const sabAvailable = typeof SharedArrayBuffer !== "undefined";
const memory = sabAvailable
  ? new WebAssembly.Memory({ initial: 256, maximum: _maxPages, shared: true })
  : new WebAssembly.Memory({ initial: 256 });
```

If SAB is available, memory is shared and all WASM atomic instructions (`i32.atomic.*`, `i64.atomic.*`) operate on the shared buffer. If SAB is unavailable (no COOP/COEP headers in browser, or older environment), the module instantiates with non-shared memory and runs normally — no crash, no silent failure. Features that require shared memory are simply unavailable.

Browser environments that need SAB must be served with:
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

Node.js has SAB unconditionally. The bridge exposes `isSABAvailable()` as a JS-side export so the calling application can check at runtime.

When `--max-memory` is set, `_maxPages` is derived from it. When SAB is in use, `maximum` is required by the spec — if `--max-memory` is not set and the bridge detects SAB, it defaults to `65536` pages (4GB, the WASM32 maximum). Set `--max-memory` explicitly to constrain heap growth.

### Standard Library Bridges

On `wasm32-js-*` targets, system hooks are implemented in the generated bridge:

- `__jswat_random_get` → `crypto.getRandomValues`
- `__jswat_clock_now` → `Date.now() × 1_000_000n` (ms→ns as i64)
- `__jswat_clock_monotonic` → `performance.now() × 1_000_000`
- `__jswat_io_write` → `console.log` (fd=1) / `console.error` (fd=2)
- `__jswat_fs_*` → Node.js `fs` (Node) / null returns (browser)
- `__jswat_process_args` → `process.argv` (Node) / empty array (browser)
- `__jswat_process_env` → `process.env[key]` (Node) / null (browser)

### Error Handling at the Boundary

**js.wat → JS (outbound, every `@export`):** A `WebAssembly.Exception` bearing the js.wat tag is caught, the `class_id` read from linear memory, the error converted to a JS `Error` subclass, the WASM object RC-decremented, and the JS error thrown. Generated `JswatError` subclasses:

```js
class JswatError    extends Error { }
class ValueError    extends JswatError { }
class RangeError    extends JswatError { }
class IOError       extends JswatError { }
class ParseError    extends JswatError { }
class NotFoundError extends JswatError { }
```

`@jsbind.error` classes generate additional subclasses. `@jsbind.errorFields` fields are read from linear memory at conversion time and set on the JS Error object.

**JS → js.wat (inbound, every `JSFn` call):** JS exceptions from `JSFn` callbacks are caught in the bridge, wrapped as an `AppError` (or appropriate subclass) allocated on the WASM heap, and rethrown using the WASM exception tag so js.wat `catch` handles them normally.

**Round-trips:** A `JswatError` that escaped js.wat → JS and re-enters js.wat is unwrapped back to its original WASM pointer — no information lost.

**Pass-through:** Non-js.wat exceptions crossing a `catch_all` in WASM are rethrown unchanged.

---

### JS Bindings — `.jsbind.js` Format

A `.jsbind.js` file declares the bridge between js.wat and a plain JS module. The plain JS module is a standard ES module with no js.wat knowledge. The `.jsbind.js` file is a **compile-time specification only** — it is never loaded at runtime.

#### The two-file model

Every binding consists of two files:

**The plain JS file** — a standard ES module. Exports named functions. Receives and returns plain JS values. Has zero knowledge of WASM, the bridge, or bridge internals (`_readStr`, `_writeStr`, `_extGet`, `_extSet` etc. are invisible and forbidden). Third-party imports are standard ES imports — the consumer's bundler or import map resolves them.

```js
// dom.js — plain ES module, no js.wat knowledge

import * as someLib from "some-third-party-lib";   // standard — resolved by bundler

export function getElementById(id) {
  return document.getElementById(id) ?? null;
}

export function setAttribute(el, name, value) {
  el.setAttribute(name, value);   // el is the real DOM element
}

export function measureText(ctx, text) {
  return ctx.measureText(text).width;   // ctx is the real CanvasRenderingContext2D
}
```

**The `.jsbind.js` file** — a js.wat module that imports from the plain JS file and declares links between js.wat functions and JS exports.

```js
//# jsbind
//# module "my-dom"

import { getElementById, setAttribute, measureText } from "./dom.js";

/**
 * @external js.dom.getElementById
 * @jsbind getElementById
 */
function dom_getElementById(id = "") { }        // str → HTMLElement?

/**
 * @external js.dom.setAttribute
 * @jsbind setAttribute
 */
function dom_setAttribute(el = HTMLElement, name = "", value = "") { }

/**
 * @external js.dom.measureText
 * @jsbind measureText
 */
function dom_measureText(ctx = Canvas2DContext, text = "") { }   // → f64
```

#### File header

```js
//# jsbind
//# module "my-lib"
```

`//# jsbind` marks the file as a binding spec. `//# module` is required — CE-B08 if absent.

#### `@jsbind funcName`

Links a js.wat function declaration to a named export from the file's JS imports. The **js.wat function signature** is the complete and sole specification of marshalling. Rules:

- `funcName` must match exactly one named import in the file's import statements — CE-B01 if not found
- The js.wat function body must be empty — CE-B02 if non-empty
- The function must also have `@external` — `@jsbind` names which JS export to call; `@external` names the WASM import slot

The compiler generates a marshalling adapter that sits between the raw WASM import and the plain JS function. The adapter handles all WASM-level concerns. The plain JS function receives and returns ordinary JS values with no awareness of bridge internals.

CE-B09 if a user's JS file references `_readStr`, `_writeStr`, `_extGet`, `_extSet`, or any other bridge internals. These are adapter-only — they are injected by the compiler, not available to user code.

**The marshalling insulation principle:** if the calling convention changes — new string encoding, different externref table design, WASM-GC externref — no user-written JS files need to change.

**Marshalling table — what the plain JS function receives (WASM → JS):**

| js.wat parameter type | Plain JS function receives |
|---|---|
| `str` / `String` | JS `string` — adapter calls `_readStr(ptr, len)` |
| `JSObject` / `@jsbind.type T` | real JS object — adapter calls `_extGet(idx)` |
| `JSSymbol` | real JS `Symbol` — adapter calls `_extGet(idx)` |
| `JSFn<sig>` | real JS `Function` — adapter calls `_extGet(idx)` |
| `JSValue` | unwrapped JS value — adapter calls `_unwrapJSValue(tag, payload)` |
| `bool` | JS `boolean` — adapter converts `i32 !== 0` |
| integer types (`i32`, `u8`, etc.) | JS `number` |
| `i64` / `u64` | JS `bigint` |
| float types (`f32`, `f64`) | JS `number` |

**Marshalling table — what the adapter does with the plain JS return (JS → WASM):**

| Plain JS function returns | js.wat return type | Adapter action |
|---|---|---|
| `string` | `str` / `String` | `_writeStr(v)` → `(i32 ptr, i32 len)` |
| `number` (float) | `f64` / `f32` | passthrough |
| `number` (integer range) | integer type | passthrough / truncate |
| `bigint` | `i64` / `u64` | passthrough |
| `boolean` | `bool` | `v ? 1 : 0` |
| JS object | `JSObject` / `@jsbind.type T` | `v != null ? _extSet(v) : 0` |
| JS `Symbol` | `JSSymbol` | `v != null ? _extSet(v) : 0` |
| JS `Function` | `JSFn<sig>` | `v != null ? _extSet(v) : 0` |
| any | `JSValue` | `_wrapJSValue(v)` → `(i32 tag, i64 payload)` |
| `null` / `undefined` | pointer / extref types | `0` |
| nothing / `undefined` | `undefined` return | nothing emitted |

**Generated adapter example:**

```js
// .jsbind.js:
//   import { getElementById } from "./dom.js";
//   @jsbind getElementById
//   function dom_getElementById(id = "") { }   // str → HTMLElement?
//
// Compiler-generated adapter in bridge:
"js.dom.getElementById": (idPtr, idLen) => {
  const _a0 = _readStr(idPtr, idLen);            // str → JS string
  const _r  = _lib_dom.getElementById(_a0);      // call user function — plain JS
  return _r != null ? _extSet(_r) : 0;           // HTMLElement? → i32
},

// user-written in dom.js — no bridge knowledge:
export function getElementById(id) {
  return document.getElementById(id) ?? null;
}
```

#### `@jsbind.type`

Declares a JS-backed opaque type. The class extends `JSObject`, is represented as `i32` externref index, and cannot be instantiated with `new` — CE-B03.

```js
/**
 * @jsbind.type
 * @jsbind.jsType "HTMLElement"
 */
class HTMLElement extends JSObject { }
```

Methods in the class body can be marked `@jsbind methodName` — the compiler generates adapters for them with `self` as the first implicit parameter. `self` in the adapter is `_extGet(selfIdx)` — the real JS object. The plain JS export receives `self` as its first argument:

```js
// .jsbind.js:
/**
 * @jsbind.type
 * @jsbind.jsType "CanvasRenderingContext2D"
 */
class Canvas2DContext extends JSObject {
  /**
   * @jsbind clearRect
   */
  clearRect(x = 0.0, y = 0.0, w = 0.0, h = 0.0) { }

  /**
   * @jsbind.get getFillStyle
   */
  get fillStyle() { }   // → str

  /**
   * @jsbind.set setFillStyle
   */
  set fillStyle(v = "") { }
}

// canvas.js — plain ES module:
export function clearRect(ctx, x, y, w, h) {
  ctx.clearRect(x, y, w, h);   // ctx is the real CanvasRenderingContext2D
}
export function getFillStyle(ctx) {
  return ctx.fillStyle;         // return a plain JS string
}
export function setFillStyle(ctx, v) {
  ctx.fillStyle = v;            // v is a plain JS string
}
```

`@jsbind.get` — links a getter. The JS export receives `self` and returns the value. `@jsbind.set` — links a setter. The JS export receives `self` and the new value.

#### How JS files are copied and imported

At compile time, for each `.jsbind.js` file:

1. The compiler collects all `import { ... } from "./path.js"` statements targeting plain JS files.
2. Those JS files are copied to the output `lib/` directory, preserving relative paths.
3. The bridge generates `await import(new URL("./lib/path.js", import.meta.url))` for each file.

```
dist/
├── main.wasm
├── main.js          ← generated bridge
└── lib/
    ├── dom.js       ← copied from binding source
    └── canvas.js    ← copied from binding source
```

The `import.meta.url` approach ensures the bridge works wherever it is served — no hardcoded paths. The files travel together.

For `wasm32-js-bundle`: plain JS files are inlined as Blob URLs inside the single output file.
For `wasm32-js-cjs`: dynamic `require()` calls are used instead of `import()`.

#### The `js { }` block

A top-level `js { }` block in a `.jsbind.js` file contains arbitrary JS code injected into the generated bridge. A single block handles both setup utilities and post-init side effects — there is no distinction between "helpers" and "init" code.

**Declaration hoisting:** `const`, `let`, and `function` declarations at the top level of the block are lifted to bridge module scope. They are available to all adapters generated from this binding library.

**Post-init statements:** expression statements and calls (anything not a declaration) run after WASM instantiation in the bridge initialisation sequence.

The compiler determines which is which by inspecting each top-level statement in the block:

```js
js {
  // Declaration — lifted to module scope; available to all adapters
  const _contexts = new Map();
  let _nextId = 1;
  function _getCtx(id) { return _contexts.get(id) ?? null; }

  // Expression statement — runs after WASM instantiation
  window?.addEventListener("resize", () => {
    _ex.on_resize(window.innerWidth, window.innerHeight);
  });
}
```

Multiple `js { }` blocks in one file are processed in order. Blocks from different binding files are concatenated in import order. Declaration name collisions across libraries — CE-B04.

**Important:** `_readStr`, `_writeStr`, `_extGet`, `_extSet` and other bridge utilities are **not available** inside `js { }` blocks. They are adapter-only internals. `js { }` blocks are for library-level JS setup — context maps, event listeners, timers. CE-B09 if bridge internals are referenced.

#### Third-party JS imports — `//# js.import`

When a plain JS file imports a third-party library, that import travels with the copied JS file and is resolved by the consumer's bundler. No special handling needed for `wasm32-js-esm` and `wasm32-js-cjs` targets.

For `wasm32-js-bundle` (no bundler), bare specifiers cannot be resolved without a URL. The `//# js.import` directive in the `.jsbind.js` file declares a URL form for bundle targets:

```js
//# jsbind
//# module "my-physics"
//# js.import gl-matrix@3.4.3 as glMatrix url "https://cdn.jsdelivr.net/npm/gl-matrix@3.4.3/esm/index.js"

import { makeBody, stepWorld } from "./physics.js";
```

Directive syntax: `//# js.import <specifier> as <alias>` or with URL: `//# js.import <specifier> as <alias> url "<cdn-url>"`.

The `@version` suffix is used for deduplication only; stripped from the bare specifier emitted for bundler targets.

Target-specific behaviour:

- `wasm32-js-esm` / `wasm32-js-cjs`: emits `import * as glMatrix from "gl-matrix"` — resolved by bundler or Node.
- `wasm32-js-bundle`: uses the `url` form — emits `import(url)` or inlines as Blob URL. CW-B01 if no URL provided.
- Version conflict across two libraries importing the same specifier at different versions — CW-B02.

The alias declared in `//# js.import` is available inside `js { }` blocks:

```js
js {
  const _tmpMat4 = glMatrix.mat4.create();
}
```

#### `@jsbind.error`

Marks an `AppError` subclass as representable at the JS boundary. The bridge generates a corresponding `Error` subclass and reads the annotated fields from linear memory when converting outbound WASM exceptions.

```js
/**
 * @jsbind.error
 * @jsbind.errorFields statusCode: i32
 */
class NetworkError extends AppError {
  statusCode;
  constructor(msg = "", code = i32(0)) {
    super(msg);
    this.statusCode = code;
  }
}
```

Generates a `NetworkError extends JswatError` in the bridge. At exception conversion time the bridge reads `statusCode` from linear memory at the field's layout offset. CE-B07 if class does not extend `AppError`.

#### JS function name resolution

`@jsbind funcName` — `funcName` must match exactly one named import in the `.jsbind.js` file's import statements. Validated statically at compile time — CE-B01 if not found. Whether the plain JS file actually exports that name is not verified by the compiler (the JS file is not parsed). A mismatch surfaces as a module load failure at runtime.

For methods on `@jsbind.type` classes, `funcName` must match a named import in the same file. The compiler prepends `self` (the real JS object) as the first argument to the JS function call.

---


## Manual Memory Management

`alloc` is a compiler builtin — always in scope, no import required.

| Call | Returns | Purpose |
|---|---|---|
| `alloc.create(Type)` | `T` | single manual allocation, all defaults |
| `alloc.create(Type, ...args)` | `T` | positional args |
| `alloc.create(Type, { key: val })` | `T` | named arg block |
| `alloc.free(e)` | `undefined` | calls `Symbol.dispose`, frees — consumes binding |
| `alloc.arena(size = usize(0))` | `Arena` | bump arena — 0 = growable |
| `alloc.pool(Type, capacity = usize(0))` | `Pool<T>` | free-list pool |

**Compiler tracking:**
- `alloc.free(e)` — consumes binding. CE-MM02 on subsequent use.
- `this.#field = e` — marks escaped. CE-MM03 if `alloc.free` called after.
- `const f = e` (direct alias) — CE-MM04.
- Binding exits scope without `alloc.free` or field escape — CE-MM01.

**Raw byte operations** — via explicit import from `std/mem`:

```js
import { rawAlloc } from "std/mem";
rawAlloc.bytes(n)               // u8? — zeroed
rawAlloc.realloc(buf, newSize)  // u8? — resize
rawAlloc.copy(dst, src, n)      // undefined
rawAlloc.fill(dst, value, n)    // undefined
```

---

## `Result<T>`

```js
import { Result } from "std/result";

Result.ok(value)           // Result<T>
Result.err(error)          // Result<T>

result.ok                  // T? — null if error
result.err                 // AppError? — null if ok
result.unwrap()            // T — throws if error
result.unwrapOr(fallback)  // T
result.isOk()              // bool
result.isErr()             // bool
result.raise()             // T — inside @returns {Result<T>}: early return on Err.
                           //     outside: throws on Err, returns T on Ok.
```

`.raise()` is valid JS at runtime. The compiler generates early-return code only when inside a `@returns {Result<T>}` function.

---

## Modules

**Resolution order:** `"std/*"` → compiler builtin; `"./foo.wasm"` → WASM binary; `"./foo"` / `"./foo.js"` / `"./foo.jsbind.js"` → relative file; `"./dir"` → `./dir/index.js`. No bare specifiers — CE-M07.

**Initialisation order:** topological sort, leaf modules first. Cycles — CE-M06.

---

## WASM Memory

Linear memory: `[ data segment | heap (GC + manual) ]`. Allocated in 64KB pages. Grows via `memory.grow`. On `wasm32-js-*` targets when `SharedArrayBuffer` is available, memory is allocated as shared and grows via `memory.atomic.grow`; when SAB is unavailable the module falls back to non-shared memory.

### Memory Controls

Three flags control memory layout and ownership. All can be set via CLI flags or `jswat.json`.

**`--max-memory <size>`** — sets the WASM `maximum` pages field. `<size>` accepts `N` (pages), `Nkb`, `Nmb`, `Ngb`. Default: no maximum (memory grows freely up to 4GB). Required when using `SharedArrayBuffer` — the spec mandates a maximum for shared memories; if SAB is available at runtime and no maximum is declared, the compiler emits a warning (CW-M11).

```bash
jswat compile src/main.js --max-memory 64mb
jswat compile src/main.js --max-memory 1024   # 1024 WASM pages = 64MB
```

In `jswat.json`:
```json
"memory": { "maximum": "64mb" }
```

**`--base-address <bytes>`** — reserves the first `<bytes>` of linear memory. The data segment, stack, and heap are placed above this address. The reserved region is never written or read by js.wat — its contents are entirely controlled by the embedder or programmer. Default: `0` (no reservation; address 0 is the null sentinel for pointer types).

Common values:
- `65536` (one WASM page) — the conventional null guard. Any pointer dereference through a null value faults at a clearly recognisable address.
- Custom values for embedder-controlled fixed-layout regions (shared control structures, spinlocks, version fields shared with a host).

```bash
jswat compile src/main.js --base-address 65536
```

In `jswat.json`:
```json
"memory": { "baseAddress": 65536 }
```

**`--import-memory`** — the module declares `(import "env" "memory" (memory ...))` instead of owning its memory. The host provides the memory at instantiation time. Used for multi-module setups where an embedder owns the shared buffer, or when a host pre-allocates memory. On JS targets, the bridge skips memory creation and uses the `memory` value injected by the host. The `initial` and `maximum` values in `jswat.json` still constrain what the host must provide — the module will trap on instantiation if the imported memory is too small.

```bash
jswat compile src/main.js --import-memory
```

In `jswat.json`:
```json
"memory": { "import": true }
```

**Combined example — shared memory module for a multi-instance host:**
```json
"memory": {
  "initial": "4mb",
  "maximum": "64mb",
  "baseAddress": 65536,
  "import": false
}
```

**Multi-memory (`--multi-memory`, `wasm32-unknown` only):** js.wat on memory index 0, foreign module on index 1. Requires WASM multi-memory support in the target runtime.

---

## Linking WASM Modules

**js.wat + js.wat:** `wasm-merge` internally. Both modules share `runtime.wat` and one allocator.

**Mixed-language (`wasm32-ld`):** `wasm-ld` resolves imports. `runtime.wat` forwards `malloc`/`free` to linker-provided libc. Passing js.wat heap object as owned to foreign — CE-L01. Foreign returning heap pointer js.wat would free — CE-L02.

**Component model (`wasm32-component`):** Fully isolated memory. All exchange through Canonical ABI. Wrap existing `wasm32-wasip1` build via `wasm-tools component new` with the standard WASI preview1 adapter.

---

## WASI and Runtime

### Target availability

| Module | `wasip1` | `unknown` | `ld` | `component` | `js-*` |
|---|---|---|---|---|---|
| `std/core`, `std/wasm`, `std/mem` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `std/math`, `std/string`, `std/encoding` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `std/collections`, `std/error`, `std/range`, `std/iter`, `std/result` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `std/random` | ✅ WASI-seeded | ⚠️ seed=0 | ✅ | ✅ WIT | ✅ `crypto.getRandomValues` |
| `std/io` | ✅ | ⚠️ no-op/hook | ✅ | ✅ WIT | ✅ `console.*` |
| `std/fs` | ✅ | ⚠️ null/false | ✅ | ✅ WIT | ✅ Node / ⚠️ null in browser |
| `std/clock` | ✅ | ⚠️ returns 0 | ✅ | ✅ WIT | ✅ `performance.now` |
| `std/process` | ✅ | ⚠️ exit traps | ✅ | ✅ WIT | ✅ Node / ⚠️ partial browser |
| `std/js/*` | ⚠️ null/no-op | ⚠️ null/no-op | ⚠️ null/no-op | ⚠️ null/no-op | ✅ |

### Module initialisation

**`wasm32-wasip1`:** `_start` exported. WASI runtime calls automatically. Runs static initialisers, seeds RNG.

**`wasm32-unknown`:** No `_start`. Every `@export` function wraps a once-guard calling `__jswat_init`. `__jswat_init` also exported for explicit host control.

**`wasm32-js-*`:** Bridge calls `_ex.__jswat_init()` after instantiation, after all `js { }` imperative statements have run. Every `@export` wrapper also has the once-guard as a safety net.

**`wasm32-ld`:** `__wasm_call_ctors` per wasm-ld convention.

**`wasm32-component`:** component model lifecycle.

### Runtime compatibility

| Target | Wasmtime | Node.js | Browser | Spin | WAMR | wazero |
|---|---|---|---|---|---|---|
| `wasm32-wasip1` | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| `wasm32-unknown` | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ |
| `wasm32-ld` | depends | depends | depends | depends | depends | depends |
| `wasm32-component` | ✅ | ⚠️ partial | ❌ | ✅ | ⚠️ | ⚠️ |
| `wasm32-js-*` | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## What Is Banned

| Feature | Code |
|---|---|
| `var` | CE-V06 |
| `eval(...)`, `new Function(...)` | CE-A02 |
| `arguments` object | CE-F04 |
| `for...in` | CE-CF01 |
| Bracket notation on non-arrays | CE-A01 |
| `delete obj.prop` | CE-A06 |
| Bare import specifiers | CE-M07 |
| Parameters without defaults | CE-F01 |
| Nested destructuring | CE-A04 |
| Setter without getter | CE-C07 |
| `?.` on non-nullable | CE-A07 |
| Generators, `async`/`await` | — |
| Switch fallthrough | CE-CF02 |
| Implicit numeric coercion | CE-T02 |
| `bool` in numeric expressions | CE-T05 |
| Instantiating `Number`, `Integer`, `Float` | CE-T06 |
| Class in `${}` without `Symbol.toStr` | CE-T09 |
| Identifiers starting with `$` | CE-V05 |
| `undefined` as type annotation outside `Fn()` return | CE-T11 |
| `&` outside type variable default | CE-T13 |
| `any` as a value | CE-T14 |
| Recursive arrow closures | CE-F12 |
| `box()` wrapping manual object | CE-O08 |
| `List<T>` with non-primitive element | CE-A11 |
| `.view()` on manually allocated `List` | CE-A12 |
| Writing to `$variants` | CE-C15 |
| `extends SealedBase` outside defining file | CE-C11 |
| `extends JSValue` from user code | CE-C11 |
| `new` on `@jsbind.type` class | CE-B03 |
| `@jsbind` function with non-empty body | CE-B02 |
| Bridge internals in `@jsbind` function body | CE-B09 |

---

## Errors

### Philosophy

```
Compile errors (CE)       — programmer mistakes caught statically. Zero runtime cost.
Compiler internal (CIT)   — test pragma assertions. Only with --test-pragmas.
Runtime traps (RT)        — unrecoverable. Emit WASM unreachable.
Runtime exceptions (RX)   — recoverable. WASM exception instructions.
Compiler warnings (CW)    — non-fatal. Compiler continues.
```

Null dereference via `.` is UB in release. Debug builds insert null checks and trap (RT-06).

### Compile Errors (CE)

**Type errors:** CE-T01 (mismatch), CE-T02 (implicit coercion), CE-T03 (out-of-range literal), CE-T04 (nullable where non-null required), CE-T05 (`bool` in numeric), CE-T06 (abstract type instantiated), CE-T07 (wrong return type), CE-T08 (missing return), CE-T09 (interpolation without `Symbol.toStr`), CE-T10 (`.raise()` outside `@returns {Result<T>}` function), CE-T11 (`undefined` as type annotation outside `Fn()` return), CE-T12 (constraint not satisfied), CE-T13 (`&` outside type variable), CE-T14 (`any` as value).

**Variable errors:** CE-V01 (`const` reassign), CE-V02 (undeclared), CE-V03 (use before declaration), CE-V04 (duplicate declaration), CE-V05 (`$`-prefixed identifier), CE-V06 (`var`).

**Class errors:** CE-C01 (unknown key in named block), CE-C02 (key type mismatch), CE-C03 (private field outside class), CE-C04 (sealed/abstract instantiation), CE-C05 (`this` outside method), CE-C06 (`this` before `super()`), CE-C07 (setter without getter), CE-C08 (duplicate field/method), CE-C09 (missing `super()`), CE-C10 (`$offset` index out of range), CE-C11 (`extends` sealed base outside file / `extends JSValue` from user code), CE-C15 (write to `$variants`), CE-C16 (`$variants` declared twice), CE-C18 (`$variants` non-empty init).

**Function errors:** CE-F01 (parameter without default), CE-F02 (wrong argument count), CE-F03 (argument type mismatch), CE-F04 (`arguments`), CE-F05 (arrow as constructor), CE-F06 (null path conflicts `@returns`), CE-F07 (recursive or `.raise()`-using function without `@returns`), CE-F08 (exported ambiguous return), CE-F09 (`@param` conflict), CE-F10 (function parameter not provided), CE-F11 (mutable `let` captured), CE-F12 (recursive arrow), CE-F13 (type variable explicit at call site), CE-F14 (type variable used before declaration).

**Control flow errors:** CE-CF01 (`for...in`), CE-CF02 (switch fallthrough), CE-CF03 (non-exhaustive sealed switch), CE-CF04 (`break`/`continue` outside loop), CE-CF05 (unreachable code), CE-CF06 (ternary type mismatch), CE-CF07 (non-exhaustive sealed switch in value position), CE-CF08 (non-sealed switch without `default`), CE-CF09 (catch chain missing `else throw`).

**Access errors:** CE-A01 (bracket on non-array), CE-A02 (`eval`/`Function()`), CE-A03 (prototype access), CE-A04 (nested destructuring), CE-A05 (nullable destructuring), CE-A06 (`delete`), CE-A07 (`?.` on non-nullable), CE-A08 (`.sort()` without `Symbol.compare`), CE-A10 (view range not divisible — compile-time), CE-A11 (`List` non-primitive element), CE-A12 (`.view()` on manual `List`), CE-A13 (sub-view out of range — compile-time).

**Manual memory errors:** CE-MM01 (scope exit without free), CE-MM02 (use after free), CE-MM03 (free after escape), CE-MM04 (alias of manual binding).

**Ownership errors:** CE-O08 (`box()` wrapping manual), CE-O09 (arena/pool object moved out).

**String errors:** CE-S01 (aliased `String` mutation), CE-S02 (invalid weak reference), CE-S03 (const `String` mutation).

**Linking errors:** CE-L01 (heap object as owned to foreign), CE-L02 (foreign returns heap pointer), CE-L03 (`--multi-memory` without runtime support).

**Module errors:** CE-M05 (import non-existent), CE-M06 (circular import), CE-M07 (bare specifier), CE-M08 (`.wasm` arity mismatch), CE-M09 (`.wasm` type mismatch).

**Pragma errors:** CE-P01 (unknown tag), CE-P02 (`@symbol` on non-method), CE-P03 (`@export` on non-function), CE-P04 (`@ordered` on non-class), CE-P05 (`@external` missing name).

**Binding errors:** CE-B01 (`@jsbind funcName` — name not found in file's JS imports), CE-B02 (`@jsbind` function has non-empty body), CE-B03 (`@jsbind.type` class instantiated with `new`), CE-B04 (name collision in `js { }` blocks across libraries), CE-B05 (`@jsbind.get` has parameters / `@jsbind.set` has wrong parameter count), CE-B06 (`@jsbind.type` missing `@jsbind.jsType`), CE-B07 (`@jsbind.error` on non-`AppError` class), CE-B08 (`.jsbind.js` file missing `//# module`), CE-B09 (`@jsbind` function body references bridge internals `_readStr`, `_writeStr`, `_extGet`, `_extSet` etc.).

### Compiler Warnings (CW)

| Code | Condition |
|---|---|
| CW-F01 | Ambiguous return type — defaulted to `isize` |
| CW-F02 | `@returns` nullable but no null path |
| CW-F03 | `@param` redundant |
| CW-C01 | `default` in switch on sealed class — unreachable |
| CW-M10 | Explicit import of prelude member |
| CW-JS01 | `JSObject`/`JSValue`/`JSFn`/`JSSymbol` or `std/js/*` import on non-`wasm32-js-*` target — always null/no-op |
| CW-B01 | `//# js.import` has no `url` form for `wasm32-js-bundle` target |
| CW-B02 | Version conflict in `//# js.import` specifier across two libraries |
| CW-B03 | `@jsbind` import name declared but not linked to any js.wat function |

### Runtime Traps (RT)

| Code | Debug | Release |
|---|---|---|
| RT-01 | OOM | trap | trap |
| RT-02 | Pool exhausted | trap | trap |
| RT-03 | Fixed arena overflow | trap | trap |
| RT-04 | Call stack overflow | host-defined | host-defined |
| RT-05 | `unreachable` statement | trap | trap |
| RT-06 | Null deref via `.` | trap | **UB** |
| RT-07 | Array/List out-of-bounds | trap | **UB** |
| RT-08 | Poisoned memory read/write | trap | **UB** |
| RT-09 | Double-free (`0xDEADDEAD`) | trap | corruption |
| RT-10 | View range not divisible (runtime) | trap | trap |
| RT-11 | Sub-view range exceeds parent (runtime) | trap | trap |
| RT-12 | Call through null function value | trap | **UB** |

### Runtime Exceptions (RX)

WASM exception instructions. One shared tag carries the thrown object as `i32` heap pointer. Catch uses `instanceof` narrowing. `finally` uses `catch_all` + `rethrow`. Unwind cleanup emits `rc_dec` for owned references.

**Stdlib exceptions:** `BoundsError`, `MathError`, `ParseError`, `IOError`, `ValueError`.

---

## String ↔ Number Conversions

**Number → str:**

```js
str(42)           // str — no allocation, data segment
str(3.14)         // str — no allocation
`${42}`           // String — heap, same digits
```

Integers: decimal, no leading zeros, `-` prefix for negatives. Floats: shortest round-trip (Ryu algorithm).

**str → number:**

```js
parseInt(s = "", radix = 10)   // isize? — null on parse failure
parseFloat(s = "")             // f64? — null on parse failure
```

---

## Implicit Prelude

Always in scope:

```
std/string:      String
std/io:          console
std/math:        Math
std/random:      Random
std/range:       Range
std/collections: Map, Set, Stack, Queue, Deque, List
std/error:       AppError, ValueError, RangeError, IOError, ParseError, NotFoundError
alloc            (compiler builtin)
```

Requires explicit import: `iter`, `StepRange`, `Clock`, `FS`, `Process`, `Base64`, `UTF8`, `Result`, `ptr`/`rawAlloc` from `std/mem`, `std/wasm` intrinsics, all `std/js/*` types and functions. Explicit import of prelude member — CW-M10.

---

## Style Guide

**Let defaults do the typing.** Use abstract types for generic intent; concrete types only when a function genuinely only works for one specific type.

**Omit `@returns` unless the compiler requires it.** Required for: recursive functions, exported functions with ambiguous returns, `.raise()` propagation.

**Omit `@param` in application code.** Reserve for public library APIs.

**Use `new` for GC objects.** `alloc.create` is for explicit lifetime management only.

**Prefer `str` for input, `String` for output.** `str` fields incur GC overhead; `String` fields are explicit about cost.

**Use `?.` and `??` for simple null fallbacks.**

**Use `@derive` before writing symbol implementations manually.**

**Type variables only when a type links multiple positions.**

**Keep `std/mem` imports isolated** — they signal low-level code deserving extra scrutiny.

**Exhaustive switches on sealed unions. `default` on everything else.**

**Named construction for non-obvious arguments** — use named blocks when a constructor has three or more parameters with non-obvious meaning.

**On `wasm32-js-*` targets:** prefer typed `JSFn` return types over `JSValue` where the JS return type is statically known — skips `_wrapJSValue` in the adapter and produces cleaner bridge code.

**Use `jsSymbol()` at module scope** — create fresh symbols once as module-level `const`, not inside functions. Calling `jsSymbol()` inside a function creates a new symbol on every call.

---

*End of js.wat Language Specification v1.7*