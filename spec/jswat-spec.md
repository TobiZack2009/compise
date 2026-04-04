# js.wat Language Specification
### Version 1.6

> A statically-typed compiled language with JavaScript syntax targeting WebAssembly.
> No eval. No hidden classes. No surprises.

**v1.6 changes:** `str` is now a fat pointer `(ptr, len)` · `str` is nullable · conditional GC promotion for escaping `str` views · `@ordered` anchored to field declaration order · `alloc` builtin always in scope · `CE-CF07` defined · error namespace `CE-M*` disambiguated · `void` replaced by `undefined` in `Fn()` return position · `?` propagation replaced by `.raise()` · minor consistency fixes throughout

*See also: [jswat-std.md](jswat-std.md) — Standard Library | [jswat-compiler.md](jswat-compiler.md) — Compiler Reference*

---

## Targets

js.wat supports four compile targets set via `--target`.

| Target | Output | WASI | Use case |
|---|---|---|---|
| `wasm32-wasip1` | Core WASM module | WASIp1 imports | WASI runtimes, command-line tools. **Default.** |
| `wasm32-unknown` | Core WASM module | None | Browser, custom host, raw WASM runtimes |
| `wasm32-ld` | Relocatable object | WASIp1, linker-resolved | Mixed-language linking with wasm-ld |
| `wasm32-component` | WASM component | WASIp2 via WIT | Wasmtime, Spin, cross-language composition |

```bash
jswat compile src/main.js --target wasm32-wasip1  -o dist/main.wasm  # default
jswat compile src/main.js --target wasm32-unknown -o dist/main.wasm
jswat compile src/main.js --target wasm32-ld      -o dist/main.o
jswat compile src/main.js --target wasm32-component --world wasi:http/proxy -o dist/main.wasm
```

**`wasm32-wasip1`:** All `wasi_snapshot_preview1.*` imports emitted as needed. `_start` exported. `std/io`, `std/fs`, `std/clock`, `std/process`, `std/random` fully functional. Global RNG seeded from `wasi_random_get` at startup. Runs on Wasmtime, WAMR, wazero, Node.js WASI, Deno.

**`wasm32-unknown`:** Zero WASI imports. No `_start` — see *WASI and Runtime* below. `std/io` writes are no-ops by default; host can inject implementations via `@external` hooks. `std/fs`, `std/clock`, `std/process` degrade silently. `std/random` seed = 0 unless host provides one. Runs in browsers via the JS WebAssembly API and any WASM runtime that provides the required imports.

**`wasm32-ld`:** Produces a wasm-ld-compatible relocatable object file. Memory and function table imported from environment (`__linear_memory`, `__indirect_function_table`). `malloc`/`free` unresolved — provided by the linked libc. `runtime.wat`'s allocator forwards calls to the linker-provided `malloc`/`free`. All `wasi_snapshot_preview1.*` imports are emitted unresolved; the linker resolves them from the linked libc. Use for mixing js.wat with C, Rust, or any wasm-ld-compatible object files.

**`wasm32-component`:** Produces a WASM component — a different binary format from a core module, wrapping a core js.wat module with Canonical ABI adapters and a WIT world declaration. System calls go through WIT interfaces (`wasi:cli/stdout`, `wasi:filesystem/types`, etc.) rather than `wasi_snapshot_preview1`. `--world` specifies the WIT world. Runs on Wasmtime and WASIp2-compatible runtimes.

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

`const` declares an immutable binding. Compile-time evaluable expressions are inlined everywhere. Otherwise evaluated once at program start — permanently immutable.

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

Static fields are shared across all instances — one allocation in linear memory, globally accessible via class name:

```js
class Config {
  static MAX = 100;
  static NAME = "js.wat";
}
```

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

`str` is a fat pointer `(ptr: usize, len: usize)`. String literals live in the WASM data segment; `str` holds a pointer into that segment and its byte length. There is no header at the pointed-to address — the data is raw UTF-8 bytes.

```js
let s = "hello";
s.length              // usize
s.at(0)               // str — single character
s.slice(0, 3)         // str — zero-copy sub-slice
s.indexOf("ell")      // isize? — null if not found
s.lastIndexOf("l")    // isize?
s.includes("ell")     // bool
s.startsWith("he")    // bool
s.endsWith("lo")      // bool
s.trim()              // str
s.trimStart()         // str
s.trimEnd()           // str
s.toUpperCase()       // String — allocates
s.toLowerCase()       // String — allocates
s.replace("h", "H")   // String — allocates
s.replaceAll("l","r") // String — allocates
s.split(",")          // str[] — no allocation
s.padStart(10, "0")   // String — allocates
s.padEnd(10, " ")     // String — allocates
s.repeat(3)           // String — allocates

str.fromCodePoint(cp = u32(0))  // str — single codepoint, data segment
```

**`str` null representation:** `ptr == 0`. An empty non-null `str` has `ptr != 0` and `len == 0`. The two-word representation is identical to `ListView<T>` — `ptr = 0` is the null sentinel, consistent with all other nullable types.

**`str` lifetime and GC promotion.** When a `str` is provably non-escaping — used only within the lexical scope of its source's lifetime — it is represented as a raw fat pointer with zero allocation overhead. When the compiler detects escape, it automatically promotes the `str` to a compiler-internal `StrRef`: a heap-allocated, RC-managed object that holds `(ptr, len)` and a strong RC reference to the owning `String`, preventing premature deallocation. Promotion is invisible to the programmer — `str` is written and used identically in both cases.

The compiler promotes `str` to a `StrRef` when it detects any of the following:

- Assignment to a class field
- Capture in a closure
- Return from a function
- Storage into an array or collection
- Assignment to a `let` binding that outlives the source `String`'s lexical scope

`str` from a literal always points to the data segment, which is permanently live. Promotion of a literal-sourced `str` is a no-op — the `StrRef` wrapper is emitted with no owning reference.

The calling convention for `str` parameters is always `(i32, i32)` regardless of whether the underlying value is backed by a `StrRef`. `StrRef` is a compiler-internal type — it never appears in user-visible signatures or error messages.

```js
class Post {
  title;
  constructor(t = "") {
    this.title = t;   // str escapes into a field — StrRef allocated automatically
  }
}

function greet(name = "") {
  console.log(`Hello, ${name}`);  // str used locally — raw fat pointer, no GC
}

function firstLine(s = String) {
  return s.$asView().slice(usize(0), s.$asView().indexOf("\n") ?? s.length);
  // $asView() result used as immediate expression — no escape — raw fat pointer
}
```

**`String` — heap-allocated mutable string. Nullable by default. RC-managed. In the implicit prelude.**

```js
let s = new String("hello");
s.append(" world");   // undefined — CE-S01 if aliased, CE-S03 if const
s.set(0, "H");        // undefined — single character replacement
s.length              // usize
s.$asView()           // str — zero-copy view into this String's buffer
s.$dataPtr()          // usize — raw buffer address
s.$capacity           // usize

String.fromCodePoint(cp = u32(0))  // String — heap
```

`String` has the same read methods as `str`. Methods producing a new string return `String`. `Symbol.toStr` returns `String` — the caller's RC keeps it alive.

`s.$asView()` returns a `str` whose `ptr` points into the `String`'s heap buffer. If that `str` escapes its scope, the compiler automatically promotes it and bumps the `String`'s RC — no manual lifetime management required.

**Template literals always produce `String`.** Interpolatable: all integers, all floats, `bool`, `str`, `String`, any class implementing `Symbol.toStr`.

| Type | Template output |
|---|---|
| Integer subtypes | Decimal, `-` for negatives |
| Float subtypes | Shortest round-trip (Ryu) |
| `bool` | `"true"` or `"false"` |
| `str` | Direct — zero copy |
| `String` | Copies content |
| Class with `Symbol.toStr` | Calls `toStr()` |

**`StringBuilder` in `std/string` — for building strings in loops without intermediate allocations:**

```js
import { StringBuilder } from "std/string";
const sb = new StringBuilder();
for (const word of words) { sb.append(word); sb.append(" "); }
const result = sb.build();  // String
```

### Nullability

Class instances, arrays, `String`, `Box<T>`, `List<T>`, and `str` are nullable by default. Numeric types and `bool` are never nullable.

**Primitive optionals** — `isize?`, `u8?`, `f64?`, `bool?` etc. — two-word representation. No boxing, no heap allocation. `??` on a primitive optional compiles to `i32.select` — branchless.

**Null representation:**

| Type | Null representation |
|---|---|
| Class, array, `String`, `Box<T>`, `List<T>` | `ptr = 0x00000000` |
| `str` | `ptr = 0x00000000` (first word of fat pointer) |
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
s?.length        // usize? — null if s is null
```

### Classes

Every object is a named class instance. Purely nominal type system. Classes sealed at definition.

**Construction forms:**

```js
new Vec2(1.0, 2.0)             // positional
new Vec2({ x: 1.0, y: 2.0 })  // named argument block — not an object literal
new Vec2                        // all defaults
```

Named argument blocks require all keys to match constructor parameter names and types exactly. Unknown keys and type mismatches are CE-C01/CE-C02.

**Private fields:** compile-time only, zero runtime overhead. Not accessible from subclasses.

**Static members:** no `this`, accessed via class name only. Inherited by subclasses. Static-only classes cannot be instantiated — CE-C04.

**Getters** allowed with or without setter. **Setters without getter — CE-C07.**

**Inheritance:** single only. Child adds fields only. `super()` required before `this` in child constructors — CE-C09/CE-C06.

**`@derive` pragma:**

```js
/**
 * @derive toStr, hash, compare
 */
class Point {
  x; y;
  constructor(x = 0.0, y = 0.0) { this.x = x; this.y = y; }
}
```

`@derive toStr` generates `Point(x: 1.0, y: 2.0)`. `@derive hash` uses FNV-1a over all fields in declaration order, returning `isize`. `@derive compare` is lexicographic in field declaration order. A manually implemented symbol overrides the derived one.

**`@ordered` pragma:** fields stored in **field declaration order** rather than compact layout. The index is the order in which fields appear in the class body, top to bottom — not constructor assignment order. Use for network protocols, binary formats, and FFI.

```js
/** @ordered */
class PacketHeader {
  flags;   // field 0 — offset 12
  seq;     // field 1 — offset 13 (or aligned per type)
  length;  // field 2
}
```

### Sealed Unions — `static $variants`

A class with `static $variants = []` declared in its body is a **sealed union base**. The compiler scans the file, collects every `class X extends Base` in the same file, and treats those as the complete set of variants. The programmer never assigns to `$variants` — the compiler populates it.

```js
class Shape {
  static $variants = [];
}
class Circle extends Shape {
  radius;
  constructor(r = 0.0) { super(); this.radius = r; }
}
class Rect extends Shape {
  w; h;
  constructor(w = 0.0, h = 0.0) { super(); this.w = w; this.h = h; }
}
// Compiler sets Shape.$variants = [Circle, Rect] — never assign manually
```

**Rules:**
- `Shape` cannot be instantiated directly — CE-C04
- `extends Shape` outside the defining file — CE-C11
- `static $variants` initialized with non-empty value — CE-C18
- Any write to `$variants` — CE-C15
- `static $variants` declared more than once — CE-C16

At runtime, `Shape.$variants` is a compiler-populated array of constructors — readable for reflection.

**Switch on a sealed union requires exhaustiveness — no `default`:**

```js
function area(s = Shape) {
  switch (s) {
    case Circle: return Math.PI * s.radius ** 2;
    case Rect:   return s.w * s.h;
  }
}
```

`case ClassName:` performs `class_id` narrowing — not value equality. This is a js.wat semantic extension; the syntax is valid JS.

**Switch on a non-sealed class requires `default` — CE-CF08 if missing.**

**Inheritance vs union:** classes without `static $variants` are open base classes — extendable from any file, switches require `default`. Classes with `static $variants` are closed unions — only variants from the same file, switches must be exhaustive.

**Nested unions:**

```js
class Expr { static $variants = []; }
class Literal extends Expr {
  value;
  constructor(v = 0) { super(); this.value = v; }
}
class BinOp extends Expr {
  static $variants = [];  // BinOp is both a variant of Expr and a sealed base
  left; right;
  constructor(l = Expr, r = Expr) { super(); this.left = l; this.right = r; }
}
class Add extends BinOp { constructor(l = Expr, r = Expr) { super(l, r); } }
class Mul extends BinOp { constructor(l = Expr, r = Expr) { super(l, r); } }
```

### Memory Layout

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

**`@ordered` layout:** fields in field declaration order. Header still at offset 0. Field 0 is the first field declared in the class body; field N is the Nth. Constructor assignment order is irrelevant.

**Inheritance layout:** parent fields always form a prefix of child layout — enables safe pointer narrowing:

```
Shape:   [ header:12 | color:4 ]
Circle:  [ header:12 | color:4 | radius:8 ]
```

**Static fields:** live in a separate region of linear memory — one allocation per class, no header.

**Compiler-generated `$`-prefixed properties — all compile-time constants:**

| Property | Type | Description |
|---|---|---|
| `T.$byteSize` | `usize` | Total allocation size including header |
| `T.$stride` | `usize` | Element step for array traversal |
| `T.$headerSize` | `usize` | Always `usize(12)` |
| `T.$classId` | `u32` | Compiler-assigned, stable within a build |
| `T.$offset(n)` | `usize` | Byte offset of nth declared field from object start |
| `T.$dataOffset(n)` | `usize` | Byte offset of nth declared field from data start |
| `e.$addr` | `usize` | Base address of any heap object — read-only |

`T.$offset(n)` uses **declaration order** as the index. Out-of-range — CE-C10. User identifiers starting with `$` are banned — CE-V05.

**Debug poison patterns:**

| Pattern | Meaning |
|---|---|
| `0xFFFFFFFF` | Live manual object (sentinel) |
| `0xDEADDEAD` | Freed manual object |
| `0x00FACADE` | Freed GC object |
| `0xABABABAB` | Arena-reset region |
| `0xFEEDFEED` | Freed pool slot |

### Arrays

Typed, homogeneous, dynamic. Nullable by default. Element type inferred from literal or first `push`. `pop()` returns `T?` — null if empty, never panics.

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

### `List<T>` and `ListView<T>`

**`List<T>` — fixed-size contiguous buffer. One allocation. Inline data after header. Element types: numeric primitives and `bool` only — CE-A11 for any other type.**

```js
const buf = new List(f32, usize(256));           // GC-managed
const buf = alloc.create(List, f32, usize(256)); // manually managed

buf[usize(0)]              // f32
buf[usize(0)] = f32(1.0)  // write
buf.length                 // usize — fixed
buf.$ptr                   // usize — address of first element
buf.$byteSize              // usize — total data bytes
```

Layout: `[ rc_class:4 | vtable_ptr:4 | class_id:4 | length:4 | elem_0 | ... ]`. Total: `16 + length × T.$byteSize` padded to alignment of `T`.

**`ListView<T>` — untracked typed view. Value type — two words `(data_ptr: usize, length: usize)`. No heap allocation, no RC.**

```js
const view = buf.view(f32);                       // entire List as f32
const sub  = buf.view(u8, usize(0), usize(256));  // byte range as u8
```

Range arguments are in **bytes**. Byte count must divide evenly by `T.$byteSize` — CE-A10 compile-time, RT-10 runtime. Views on manually allocated lists are banned — CE-A12. Sub-view out of range: CE-A13 compile-time, RT-11 runtime.

`ListView<T>` in registers: two `i32` WASM locals. In struct fields: 8 bytes. Cannot be null.

### `Box<T>`

`box(x)` heap-allocates any value. GC-managed, RC'd. Builtin — no import needed.

```js
let b = box(isize(5));
b.$val++;
b.$addr;   // usize — header address
```

Layout: `[ rc_class:4 | vtable_ptr:4 | class_id:4 | value:N ]`. `box()` wrapping a manually allocated object — CE-O08.

### Pointers (raw — `std/mem`)

Raw pointer operations require explicit import from `std/mem`:

```js
import { ptr } from "std/mem";
const raw = ptr.fromAddr(base.$addr + Entity.$stride, Entity);
raw.val.x = 1.0;
const dist = ptr.diff(next, base);   // isize — address difference
```

`ptr.fromAddr` is unowned and untracked. Use-after-free is RT-08 in debug, UB in release.

### Functions and Closures

Every parameter requires a default value as its type contract.

**Function type syntax — `Fn`:**

```js
Fn(isize => bool)              // one param, returns bool
Fn(isize, isize => isize)      // two params
Fn(() => undefined)            // no params, no return — parens required for zero params
Fn(() => isize)                // no params, returns isize
Fn(isize => bool)?             // nullable function value
Fn(n: isize => bool)           // named param — documentation only
```

`undefined` in `Fn()` return position means "no return value" — the function produces nothing. `undefined` as a type annotation outside `Fn()` return position — CE-T11. Zero-parameter functions require `()` before `=>` to parse correctly as valid JS.

**As parameter defaults:**

```js
function filter(arr = [0], pred = Fn(isize => bool)) { }
function fold(arr = [0], init = 0, reducer = Fn(isize, isize => isize)) { }
```

Function parameters require an explicit argument at call sites — CE-F10 if omitted.

**Non-capturing arrows — zero allocation.** Represented as `(fn_index, env_ptr=0)` — two WASM values, no heap object.

**Capturing closures — heap allocated, RC'd.** Capture rules:
- Scalars (`i8`–`f64`, `bool`, `str`) — captured by value copy. Independent from outer binding after capture. If the captured `str` originally pointed into a heap `String`, the compiler emits a `StrRef` to keep that `String` alive.
- Heap types (`String`, class instances, arrays, `Box<T>`, `List<T>`) — captured by RC reference. Closure keeps object alive.
- `ListView<T>` — captured by value (fat pointer, two words). No RC. Lifetime is programmer's responsibility.
- Mutable `let` binding captured — CE-F11. Use `box()` for shared mutable state:

```js
// ❌ CE-F11
let count = isize(0);
const inc = () => { count++; };

// ✅
const count = box(isize(0));
const inc = () => { count.$val++; };
```

Recursive arrow closures — CE-F12. Use named function declarations. Null function value call — RT-12 in debug, UB in release.

### Generics and Type Variables

Classes and functions monomorphize per unique type combination. Type variables link multiple positions to the same inferred type and are erased at call sites.

```js
function map(arr = [T], fn = Fn(T => T), T = Integer) { }
map([u8(0)], n => u8(n * u8(2)));  // T=u8 inferred from arr
map([0], n => n * 2);              // T=isize
```

**Constraint syntax:**

```js
T = Integer                  // T must be an Integer subtype
T = Float                    // T must be a Float subtype
T = Number                   // any numeric type
T = any                      // unconstrained
T = Comparable               // implements Symbol.compare
T = Hashable & Equatable     // implements both
```

`&` valid only in type variable default position — CE-T13 elsewhere. `any` as a value — CE-T14. Passing type variables explicitly at call sites — CE-F13.

**Well-known abstract type names (from corresponding symbols):**

| Symbol | Abstract type |
|---|---|
| `Symbol.compare` | `Comparable` |
| `Symbol.hash` | `Hashable` |
| `Symbol.equals` | `Equatable` |
| `Symbol.iterator` | `Iterable` |
| `Symbol.dispose` | `Disposable` |

**Type variables declared in a constructor are in scope for all instance methods:**

```js
class SortedList {
  #items;
  constructor(items = [T], T = Comparable) { this.#items = items; }
  insert(item = T) { }   // T in scope
}
```

The pre-pass collects all type variable declarations before resolving other parameter defaults — forward references within a parameter list are handled.

---

## Type Narrowing

### Switch

```js
function area(s = Shape) {
  switch (s) {
    case Circle: return Math.PI * s.radius ** 2;
    case Rect:   return s.w * s.h;
  }
}
```

`case ClassName:` performs `class_id` narrowing — **not value equality**. No fallthrough. No `break`. Exhaustiveness enforced for sealed unions. Non-sealed switch requires `default` — CE-CF08.

### `instanceof`

```js
if (s instanceof Circle) { s.radius; }
```

Same `class_id` check as switch. Works on sealed and non-sealed classes.

### Null checks

```js
if (p != null) { p.x; }   // p narrowed to non-null inside block
p?.x;                      // safe — null propagates
p.x;                       // fast — UB if null in release, RT-06 in debug
const v = n ?? isize(0);   // branchless for primitive optionals (i32.select)
```

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

`Symbol.dispose` called automatically when RC hits zero. Class in `${}` without `Symbol.toStr` — CE-T09.

**User-defined symbols:**

```js
const Drawable = Symbol("Drawable");
class Sprite {
  /** @symbol Drawable */
  draw() { }
}
function render(obj = Drawable) { obj.draw(); }
```

---

## Iterator Protocol

`IteratorResult<T>` is builtin in `std/core`. `for...of` desugars to explicit `iter()`/`next()` calls — fully static, no dynamic dispatch. Built-in iterables: arrays, strings, `Map`, `Set`, `Range`, `List<T>`.

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

Standard JS: `if/else`, `for`, `while`, `do/while`, `switch`, `break/continue`, `return`, `throw/try/catch/finally`. `for...of` over arrays, strings, and `Symbol.iterator` implementors. `for...in` banned — CE-CF01.

**`throw`/`catch`:** class instances only. Uses WASM exception instructions. Type narrowing inside a plain `catch` uses `instanceof` checks:

```js
try {
  riskyOp();
} catch (e) {
  if (e instanceof ParseError) {
    console.log(`parse failed: ${e.message}`);
  } else if (e instanceof IOError) {
    console.log(`io failed: ${e.message}`);
  } else throw e;
}
```

`else throw e` at the end of a catch `instanceof` chain is required unless the last branch handles `AppError` — CE-CF09 if missing.

---

## JSDoc Annotations

Annotations are optional — the compiler infers types from defaults. Annotations are required only when inference is ambiguous or the compiler explicitly requests them.

### `@returns`

Declares return type when inference is ambiguous:

```js
/** @returns {isize} */
function getVersion() { return 42; }

/** @returns {u8?} */
function parse(s = "") {
  if (s.length == 0) return null;
  return u8(255);
}
```

Nullable types use postfix `?` in JSDoc braces: `{isize?}`, `{Player?}`.

Required when: return type is ambiguous (CW-F01 if missing), recursive function (CE-F07), exported function with ambiguous return (CE-F08), function uses `.raise()` propagation (CE-F07).

### `@param`

Optional. Cross-checked against inferred type from default — CE-F09 if conflicts. CW-F03 if redundant. Appropriate for public library APIs where the parameter's purpose needs documentation beyond its name.

### Pragma tags

| Tag | Applies to | Effect |
|---|---|---|
| `@export name` | function, static method | Exports to WASM host with given name |
| `@external mod.fn` | function declaration | Declares host-provided function |
| `@symbol Symbol.X` | method | Implements well-known symbol |
| `@ordered` | class | Field layout in declaration order |
| `@derive toStr, hash, compare` | class | Auto-generate symbol implementations |

```js
/** @export on_tick */
function tick(dt = 0.0) { }

/**
 * @external env.platform_log
 * @returns {undefined}
 */
function platformLog(msg = "") { }
```

Short form retained for `@export` and `@external`:

```js
//@export("on_tick")
function tick(dt = 0.0) { }

//@external("env", "platform_log")
function platformLog(msg = "") { }
```

With `@external` in JSDoc form, the function body may be empty — `@returns` provides the type anchor.

---

## Host Interop

### Host Imports — `@external`

```js
/**
 * @external env.platform_log
 * @returns {undefined}
 */
function platformLog(msg = "") { }

/**
 * @external mathlib.vec3_dot
 * @returns {f64}
 */
function vec3Dot(a = Box, b = Box) { }
```

### Host Exports — `@export`

```js
/** @export on_tick */
function tick(dt = 0.0) { }

class Game {
  /** @export game_update */
  static update(dt = 0.0) { }
}
```

`export` keyword = inter-module visibility for other js.wat modules. `@export` = WASM host visibility. Orthogonal.

### `wasm32-unknown` Host Hooks

On `wasm32-unknown`, stdlib system calls are no-ops by default. Declare `@external` for any of the following named hooks to inject a host implementation:

| Hook | Signature | Purpose |
|---|---|---|
| `__jswat_io_write` | `(ptr: usize, len: usize, fd: i32)` | stdout/stderr |
| `__jswat_io_read` | `(ptr: usize, maxLen: usize) → usize` | stdin |
| `__jswat_clock_now` | `() → i64` | wall clock nanoseconds |
| `__jswat_random_get` | `(ptr: usize, len: usize)` | entropy fill |
| `__jswat_process_exit` | `(code: i32)` | process exit |

```js
/**
 * @external env.__jswat_io_write
 * @returns {undefined}
 */
function jswatIoWrite(ptr = usize(0), len = usize(0), fd = i32(0)) { }
```

The compiler wires the declared `@external` to the stdlib's hook point. The JS host provides the implementation:

```js
const imports = {
  env: {
    __jswat_io_write: (ptr, len, fd) => {
      const text = new TextDecoder().decode(
        new Uint8Array(instance.exports.memory.buffer, ptr, len)
      );
      fd === 1 ? console.log(text) : console.error(text);
    }
  }
};
```

---

## WASM Memory

Linear memory: `[ data segment | stack | heap (GC + manual) ]`. Allocated in 64KB pages. Grows via `memory.grow`. The compiler exports memory as `"memory"` by default. For `--import-memory`: module imports memory from environment.

**Multi-memory (`--multi-memory` flag, `wasm32-unknown` only):** when linking a foreign module with a separate allocator, assigns js.wat to memory index 0 and the foreign module to memory index 1. Each module's allocator operates on its own address space — no conflict. Requires WASM multi-memory support in the target runtime (live in Chrome, Firefox; part of WASM 3.0 standard).

---

## Linking WASM Modules

### js.wat + js.wat (internal)

`.wasm` direct imports for js.wat library modules. The compiler uses `wasm-merge` internally. Both modules share `runtime.wat` and one allocator.

```js
import { vec3Dot } from "./mathlib.wasm";
import { vec3Dot } from "./mathlib.extern.js";  // with .extern.js sidecar for precise types
```

```bash
jswat compile src/main.js --link mathlib=dist/mathlib.wasm -o dist/app.wasm
jswat compile src/mathlib.js --lib -o dist/mathlib.wasm
```

### Mixed-language linking with wasm-ld (`wasm32-ld`)

For mixing with C, Rust, or any wasm-ld-compatible object files:

```bash
jswat compile src/main.js --target wasm32-ld -o dist/main.o
clang --target=wasm32-unknown-unknown -c src/helper.c -o dist/helper.o
wasm-ld dist/main.o dist/helper.o -o dist/app.wasm \
  --no-entry --export-all --allow-undefined
```

In `wasm32-ld` mode, `runtime.wat`'s allocator forwards `malloc`/`free` calls to the linker-provided libc. One allocator — no conflict.

**Cross-module pointer rules in `wasm32-ld`:** js.wat heap pointers are valid memory addresses readable by C. C must not `free()` js.wat objects directly — use the exported `__jswat_rc_inc`/`__jswat_rc_dec` for retained references. Passing a js.wat heap object as owned to a foreign function — CE-L01. A foreign function returning a heap pointer that js.wat would need to `free()` — CE-L02.

### Component Model (`wasm32-component`)

For cross-language composition via WASIp2:

```bash
jswat compile src/handler.js \
  --target wasm32-component \
  --world wasi:http/proxy \
  -o dist/handler.wasm
```

Each component has fully isolated memory. All data exchange through Canonical ABI. No shared memory, no allocator conflict. To wrap an existing `wasm32-wasip1` build as a component via the standard adapter pipeline:

```bash
jswat compile src/main.js --target wasm32-wasip1 -o dist/main.core.wasm
wasm-tools component new dist/main.core.wasm \
  --adapt wasi_snapshot_preview1=wasi_snapshot_preview1.reactor.wasm \
  -o dist/main.wasm
```

Generate js.wat bindings from a WIT file:

```bash
jswat bindgen src/other.wit -o src/other-bindings.js
```

---

## Manual Memory Management

`alloc` is a compiler builtin — always in scope. No import required.

**Typed allocation:**

| Call | Returns | Purpose |
|---|---|---|
| `alloc.create(Type)` | `T` | single manual allocation, all defaults |
| `alloc.create(Type, ...args)` | `T` | positional args |
| `alloc.create(Type, { key: val })` | `T` | named arg block |
| `alloc.free(e)` | `undefined` | calls `Symbol.dispose`, frees — consumes binding |
| `alloc.arena(size = usize(0))` | `Arena` | bump arena — 0 = growable |
| `alloc.pool(Type, capacity = usize(0))` | `Pool<T>` | free-list pool |

**Raw memory operations** — available via explicit import from `std/mem`. These are separate from the typed `alloc` builtin:

```js
import { rawAlloc } from "std/mem";
rawAlloc.bytes(n)               // u8? — zeroed
rawAlloc.bytes(n, fill)         // u8? — filled
rawAlloc.realloc(buf, newSize)  // u8? — resize, old ptr invalid
rawAlloc.copy(dst, src, n)      // undefined
rawAlloc.fill(dst, value, n)    // undefined
```

These operations return raw byte addresses with no header. Use `ptr.fromAddr` from `std/mem` to access typed data within raw buffers.

**Compiler tracking of `alloc.create` bindings:**

- `alloc.free(e)` — consumes binding. CE-MM02 on subsequent use.
- Field assignment `this.#field = e` — marks escaped. CE-MM03 if `alloc.free(e)` called after.
- Direct alias `const f = e` — CE-MM04.
- Binding exits scope without `alloc.free` or field escape — CE-MM01.

Debug double-free detection: `rc_class == 0xDEADDEAD` at `alloc.free` time — RT-09.

---

## WASI and Runtime

### Stdlib target availability

| Module | `wasip1` | `unknown` | `ld` | `component` |
|---|---|---|---|---|
| `std/core`, `std/wasm`, `std/mem` | ✅ | ✅ | ✅ | ✅ |
| `std/math`, `std/string`, `std/encoding` | ✅ | ✅ | ✅ | ✅ |
| `std/collections`, `std/error`, `std/range`, `std/iter`, `std/result` | ✅ | ✅ | ✅ | ✅ |
| `std/random` | ✅ WASI-seeded | ⚠️ seed=0, hook | ✅ WASI-seeded | ✅ WIT-seeded |
| `std/io` | ✅ | ⚠️ no-op / hook | ✅ | ✅ WIT |
| `std/fs` | ✅ | ⚠️ null/false | ✅ | ✅ WIT |
| `std/clock` | ✅ | ⚠️ returns 0 | ✅ | ✅ WIT |
| `std/process` | ✅ | ⚠️ exit traps | ✅ | ✅ WIT |

`wasm32-ld` is identical to `wasm32-wasip1` for all system modules — both emit `wasi_snapshot_preview1` imports; the linker resolves them. Only allocator sourcing differs, which is internal to `std/mem` and `runtime.wat`.

All stdlib modules compile with `__target_*` compile-time globals. Level 5 DCE folds all target constants — the binary contains exactly one implementation path per module per target.

### Module initialisation

**`wasm32-wasip1`:** exports `_start`. WASI runtime calls it automatically. Runs static initialisers, seeds RNG, returns.

**`wasm32-unknown`:** no `_start`. Every `@export` function wraps a once-guard calling `__jswat_init` on first invocation. `__jswat_init` also exported for explicit host control.

**`wasm32-unknown --lib`:** `__jswat_init` exported without once-guard — host calls exactly once.

**`wasm32-ld`:** emits `__wasm_call_ctors` per wasm-ld convention. Linker synthesises final `__wasm_call_ctors` calling all registered init functions.

**`wasm32-component`:** component model lifecycle manages initialisation.

### Runtime compatibility

| Target | Wasmtime | Node.js | Browser | Spin | WAMR | wazero |
|---|---|---|---|---|---|---|
| `wasm32-wasip1` | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| `wasm32-unknown` | ✅ (raw) | ✅ (JS API) | ✅ | ⚠️ no WASI | ✅ | ✅ |
| `wasm32-ld` | depends on linked binary | depends | depends | depends | depends | depends |
| `wasm32-component` | ✅ | ⚠️ partial | ❌ | ✅ | ⚠️ partial | ⚠️ partial |

---

## What Is Banned

| Feature | Code |
|---|---|
| `var` | CE-V06 |
| `eval(...)`, `new Function(...)` | CE-A02 |
| `with` statement | — |
| `arguments` object | CE-F04 |
| `for...in` | CE-CF01 |
| Bracket notation on non-arrays | CE-A01 |
| `delete obj.prop` | CE-A06 |
| Object literals `{}` outside `new` | — |
| `Object.assign`, `Object.defineProperty` | — |
| Dynamic `import()` | — |
| Bare import specifiers | CE-M07 |
| `Proxy`, `Reflect`, `Symbol` as dynamic key | — |
| `typeof` as branch condition | — |
| `JSON.parse` | — |
| `this` outside class methods | CE-C05 |
| Parameters without defaults | CE-F01 |
| Throwing non-class values | — |
| Conditional constructor field assignment | — |
| Nested destructuring | CE-A04 |
| Setter without getter | CE-C07 |
| `?.` on non-nullable | CE-A07 |
| `\|\|=`/`&&=` on any type | — |
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

---

## Errors

### Philosophy

```
Compile errors (CE)     — programmer mistakes caught statically. Zero runtime cost.
Runtime traps (RT)      — unrecoverable. Emit WASM unreachable.
Runtime exceptions (RX) — recoverable. WASM exception instructions.
```

Null dereference via `.` is UB in release. Debug builds insert null checks and trap. Release optimiser assumes `.` is never null — zero-overhead field access. Use `?.` for safe access.

### Compile Errors (CE)

**Type errors:** CE-T01 (mismatch), CE-T02 (implicit coercion), CE-T03 (out-of-range literal), CE-T04 (nullable where non-null required), CE-T05 (`bool` in numeric), CE-T06 (abstract type instantiated), CE-T07 (wrong return type), CE-T08 (missing return), CE-T09 (interpolation without `Symbol.toStr`), CE-T10 (`.raise()` outside `@returns {Result<T>}` function), CE-T11 (`undefined` as type annotation outside `Fn()` return position), CE-T12 (constraint not satisfied), CE-T13 (`&` outside type variable), CE-T14 (`any` as value).

**Variable errors:** CE-V01 (`const` reassign), CE-V02 (undeclared), CE-V03 (use before declaration), CE-V04 (duplicate declaration), CE-V05 (`$`-prefixed identifier), CE-V06 (`var`).

**Class errors:** CE-C01 (unknown key in named block), CE-C02 (key type mismatch), CE-C03 (private field outside class), CE-C04 (sealed/abstract instantiation), CE-C05 (`this` outside method), CE-C06 (`this` before `super()`), CE-C07 (setter without getter), CE-C08 (duplicate field/method), CE-C09 (missing `super()`), CE-C10 (`$offset` index out of range), CE-C11 (`extends` sealed base outside file), CE-C15 (write to `$variants`), CE-C16 (`$variants` declared twice), CE-C18 (`$variants` non-empty init).

**Function errors:** CE-F01 (parameter without default), CE-F02 (wrong argument count), CE-F03 (argument type mismatch), CE-F04 (`arguments`), CE-F05 (arrow as constructor), CE-F06 (null path conflicts `@returns`), CE-F07 (recursive or `.raise()`-using function without `@returns`), CE-F08 (exported ambiguous return), CE-F09 (`@param` conflict), CE-F10 (function parameter not provided), CE-F11 (mutable `let` captured), CE-F12 (recursive arrow), CE-F13 (type variable explicit at call site), CE-F14 (type variable used before declaration).

**Control flow errors:** CE-CF01 (`for...in`), CE-CF02 (switch fallthrough), CE-CF03 (non-exhaustive sealed switch), CE-CF04 (`break`/`continue` outside loop), CE-CF05 (unreachable code after `return`/`throw`), CE-CF06 (ternary branches with mismatched types), CE-CF07 (non-exhaustive sealed switch in a value position — switch used as expression), CE-CF08 (non-sealed switch without `default`), CE-CF09 (catch chain missing `else throw`).

**Access errors:** CE-A01 (bracket on non-array), CE-A02 (`eval`/`Function()`), CE-A03 (prototype access), CE-A04 (nested destructuring), CE-A05 (nullable destructuring), CE-A06 (`delete`), CE-A07 (`?.` on non-nullable), CE-A08 (`.sort()` without `Symbol.compare`), CE-A10 (view range not divisible — compile-time), CE-A11 (`List` non-primitive element), CE-A12 (`.view()` on manual `List`), CE-A13 (sub-view out of range — compile-time).

**Manual memory errors:** CE-MM01 (scope exit without free or field escape), CE-MM02 (use after free), CE-MM03 (free after escape), CE-MM04 (alias of manual binding).

**Ownership errors:** CE-O08 (`box()` wrapping manual), CE-O09 (arena/pool object moved out).

**String errors:** CE-S01 (aliased `String` mutation), CE-S02 (invalid weak reference), CE-S03 (const `String` mutation).

**Linking errors:** CE-L01 (heap object as owned to foreign), CE-L02 (foreign returns heap pointer), CE-L03 (`--multi-memory` without runtime support).

**Module errors:** CE-M05 (import non-existent), CE-M06 (circular import), CE-M07 (bare specifier), CE-M08 (`.wasm` arity mismatch), CE-M09 (`.wasm` type mismatch).

**Pragma errors:** CE-P01 (unknown tag), CE-P02 (`@symbol` on non-method), CE-P03 (`@export` on non-function), CE-P04 (`@ordered` on non-class), CE-P05 (`@external` missing name).

### Compiler Warnings (CW)

| Code | Condition |
|---|---|
| CW-F01 | Ambiguous return type — defaulted to `isize` |
| CW-F02 | `@returns` nullable but no null path |
| CW-F03 | `@param` redundant |
| CW-C01 | `default` in switch on sealed class — unreachable |
| CW-M10 | Explicit import of prelude member |

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

WASM exception instructions. One shared tag carries the thrown object as `i32` heap pointer. Catch uses `instanceof` narrowing. Catching a base class catches all subclasses. `finally` uses `catch_all` + `rethrow`. Unwind cleanup emits `rc_dec` for owned references before rethrowing.

**Stdlib exceptions:** `BoundsError`, `MathError`, `ParseError`, `IOError`, `ValueError`.

---

## String ↔ Number Conversions

**Numbers to strings:** template literal interpolation only.

**Strings to numbers:** `.parse()` on every numeric type. Throws `ParseError` on failure. Whitespace rejected — call `.trim()` first.

```js
i32.parse("42")        // 42
i32.parse("ff", 16)    // 255 — 0x prefix stripped automatically
f64.parse("3.14")      // 3.14
f64.parse("inf")       // Infinity
f64.parse("abc")       // throws ParseError
```

---

## `Result<T>`

```js
import { Result } from "std/result";

/** @returns {Result<isize>} */
function parseInt(s = "") {
  if (s.length == 0) return Result.err(new ValueError("empty"));
  return Result.ok(n);
}

const r = parseInt(input);
r.ok             // isize? — null if error
r.err            // AppError? — null if ok
r.unwrap()       // isize — throws if error
r.unwrapOr(0)    // isize — fallback if error
r.isOk()         // bool
r.isErr()        // bool
```

**`.raise()` — early return propagation.** Called on a `Result<T>` inside a function annotated `@returns {Result<T>}`: if the result is err, returns the error from the enclosing function immediately; if ok, evaluates to the unwrapped value. Outside a `@returns {Result<T>}` function, `.raise()` behaves as a normal method call — throws on error, returns the value on ok — and CE-T10 is not raised.

`.raise()` is valid JS at runtime (it is a real method on `Result`), which means js.wat source files using it are runnable as JS given a `Result` polyfill.

```js
/** @returns {Result<isize>} */
function processLine(line = "") {
  const n = parseInt(line).raise();  // propagates error early if err, unwraps if ok
  return Result.ok(n * 2);
}
```

---

## Modules

**Resolution order:** `"std/*"` → compiler builtin, `"./foo.wasm"` → WASM binary, `"./foo"` / `"./foo.js"` → relative file, `"./dir"` → `./dir/index.js`. No bare specifiers — CE-M07.

**Export/import forms:** standard ES module syntax.

**Initialisation order:** topological sort of import graph, leaf modules first. Cycles — CE-M06.

---

## Implicit Prelude

Always in scope — no import needed:

```
std/string:      String
std/io:          console
std/math:        Math
std/random:      Random
std/range:       Range
std/collections: Map, Set, Stack, Queue, Deque, List
std/error:       AppError, ValueError, RangeError, IOError, ParseError, NotFoundError
```

Requires explicit import: `iter`, `StepRange`, `Clock`, `FS`, `Process`, `Base64`, `UTF8`, `StringBuilder`, `Result`, `ptr`/`rawAlloc` from `std/mem`, `std/wasm` intrinsics.

Tree-shaking applies — prelude members contribute zero bytes unless used. Explicit import of prelude member — CW-M10.

---

## Style Guide

Idiomatic js.wat uses the language's inference to its advantage. Write the minimum annotation that makes intent clear, and let the compiler handle the rest.

### Let defaults do the typing

The default value is the type declaration. Use abstract types for generic intent; concrete types only when a function genuinely only makes sense for one specific type.

```js
// ❌ redundant — abstract type expresses the intent better
function clamp(val = u8(0), min = u8(0), max = u8(0)) { }

// ✅ works for any integer subtype
function clamp(val = Integer, min = Integer, max = Integer) { }

// ✅ correct when u8 is genuinely the only valid type
function clampByte(val = u8(0), min = u8(0), max = u8(0)) { }
```

### Omit `@returns` unless the compiler requires it

`@returns` is for cases the compiler cannot resolve — recursive functions, exported functions with ambiguous returns, `.raise()` propagation. It is not a documentation convention for all functions.

```js
// ❌ unnecessary — return type is unambiguous
/** @returns {isize} */
function add(a = 0, b = 0) { return a + b; }

// ✅
function add(a = 0, b = 0) { return a + b; }

// ✅ required — recursive
/** @returns {isize} */
function fib(n = 0) {
  return n <= 1 ? n : fib(n - 1) + fib(n - 2);
}
```

### Omit `@param` in application code

`@param` belongs in public library APIs where a parameter's purpose isn't clear from its name. In application code, defaults document the type already.

```js
// ❌ noise
/** @param {f64} x @param {f64} y */
function distance(x = 0.0, y = 0.0) { return Math.sqrt(x*x + y*y); }

// ✅
function distance(x = 0.0, y = 0.0) { return Math.sqrt(x*x + y*y); }

// ✅ appropriate in a library
/**
 * @param {u8} flags — bitmask of feature flags, see FLAGS_* constants
 */
function configure(flags = u8(0), label = String) { }
```

### Use `new` for GC objects

`alloc.create` is for explicit lifetime management. It is not a style variant of `new`.

```js
// ❌
const player = alloc.create(Player, "hero", 100);
alloc.free(player);

// ✅
const player = new Player("hero", 100);
```

Reach for `alloc.create` only when you can articulate why GC is insufficient.

### Prefer `str` for input, `String` for output

`str` is zero-cost on the non-escaping path. Accept string parameters as `str`. Return built strings as `String`. Note that storing `str` in class fields or collections is safe — the compiler promotes automatically — but it does incur GC overhead. If you're building a data structure that holds many strings and allocation cost matters, `String` fields are more explicit about what you're paying for.

```js
// ❌ forces heap allocation on every call
function greet(name = String) { console.log(`Hello, ${name}`); }

// ✅
function greet(name = "") { console.log(`Hello, ${name}`); }
```

### Use `?.` and `??` for simple null fallbacks

```js
// ❌ verbose for a one-expression result
let name;
if (player != null) { name = player.name; } else { name = "unknown"; }

// ✅
const name = player?.name ?? "unknown";

// ✅ explicit check is right for multi-statement branches
if (player != null) {
  player.score += 10;
  player.lastSeen = Clock.now();
}
```

### Use `@derive` before writing symbol implementations manually

```js
// ❌ boilerplate @derive handles correctly
class Vec2 {
  x; y;
  constructor(x = 0.0, y = 0.0) { this.x = x; this.y = y; }
  /** @symbol Symbol.toStr @returns {String} */
  toStr() { return `Vec2(${this.x}, ${this.y})`; }
}

// ✅
/** @derive toStr, hash */
class Vec2 {
  x; y;
  constructor(x = 0.0, y = 0.0) { this.x = x; this.y = y; }
}
```

Write manual implementations when the derived behavior is semantically wrong — for example, hashing a `Player` only by `id` rather than all fields.

### Type variables only when a type links multiple positions

```js
// ❌ type variable redundant — T appears once
function double(x = T, T = Number) { return x * 2; }

// ✅ abstract default is sufficient
function double(x = Number) { return x * 2; }

// ✅ type variable necessary — T links arr and fn
function identity(arr = [T], fn = Fn(T => T), T = any) { }
```

### Keep `std/mem` imports isolated

`std/mem` imports signal low-level operations deserving extra scrutiny.

```js
import { iter } from "std/iter";
import { Result } from "std/result";

import { ptr, rawAlloc } from "std/mem";  // separated — low-level section
```

### Exhaustive switches on sealed unions, `default` on everything else

```js
// ✅ sealed — exhaustive, no default
function area(s = Shape) {
  switch (s) {
    case Circle: return Math.PI * s.radius ** 2;
    case Rect:   return s.w * s.h;
  }
}

// ✅ non-sealed — default required
function describe(a = Animal) {
  switch (a) {
    case Dog:  return "dog";
    case Cat:  return "cat";
    default:   return "unknown";
  }
}
```

### Named construction for non-obvious arguments

Use named blocks when a constructor has three or more parameters and their meaning is not obvious from position.

```js
// ❌ what does false mean here?
const config = new Config("prod", 8080, false, true, 32);

// ✅
const config = new Config({
  env: "prod",
  port: 8080,
  debug: false,
  tls: true,
  workers: 32
});

// ✅ positional is fine when meaning is obvious
const p = new Vec2(1.0, 2.0);
const r = new Range(usize(0), usize(100));
```

---

*End of js.wat Language Specification v1.6*