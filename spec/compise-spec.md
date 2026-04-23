# Compise Language Specification

> A statically-typed compiled language with JavaScript syntax targeting WebAssembly.
> No eval. No hidden classes. No surprises.

*See also: [compise-std.md](compise-std.md) — Standard Library | [compise-compiler.md](compise-compiler.md) — Compiler Reference*

The compiler CLI is `jswat` — preserved for compatibility.

---

## Targets

Compise supports seven compile targets set via `--target`.

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

**`wasm32-js-esm` / `wasm32-js-cjs` / `wasm32-js-bundle`:** Produce a generated JS bridge alongside the WASM binary (or inlined for bundle). The bridge runs identically in browser, Node.js, and Deno. When `SharedArrayBuffer` is available, WASM linear memory is allocated as a shared buffer enabling WASM atomic instructions. Browser environments that need SAB must be served with COOP/COEP headers. The bridge detects SAB availability at runtime and falls back to non-shared memory gracefully.

**All targets are WASM32:** `isize`/`usize` are pointer-sized — 32-bit on all current targets.

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

## Type System

### Primitive Types

Primitive types map directly to WASM value types. They are **never nullable**, carry no object header, and are stored on the WASM stack wherever possible.

```
Primitive
├── bool
├── Integer
│   ├── i8, u8, i16, u16, i32, u32, i64, u64
│   ├── isize     — pointer-sized signed   (i32 on WASM32)
│   └── usize     — pointer-sized unsigned (u32 on WASM32)
├── Float
│   ├── f32
│   └── f64
└── enum          — compiles to its underlying primitive type
```

`Number`, `Integer`, and `Float` are **abstract** — usable as type variable constraints, never directly instantiable.

**Stack allocation rules for primitives:**
- Local variables and parameters → WASM stack
- Fields in classes → linear memory, packed into object layout
- Captured by closures → linear memory (closure environment object)
- Elements of `List<T>` or arrays → linear memory, contiguous

### Reference Types

Reference types are heap-allocated and nullable by default.

```
Reference
├── str           — immutable fat pointer, nullable
├── String        — heap string, RC managed, nullable
├── Array<T>      — dynamic, heap, nullable
├── List<T>       — fixed-size, primitive elements only, nullable
├── class         — user defined, heap, nullable
├── sealed class  — sum types / tagged unions, nullable
├── Fn            — function value
└── JS types      — JSObject, JSValue, JSFn, JSSymbol
```

### Numeric Type Hierarchy

```
Number
├── Integer
│   ├── i8, u8, i16, u16, i32, u32, i64, u64
│   ├── isize     — pointer-sized signed
│   └── usize     — pointer-sized unsigned
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

### Nullability

Reference types are nullable by default. Primitives are never nullable without `Option`.

```js
p?.x;            // safe — null propagates
p.x;             // fast — UB if null in release, RT-06 in debug
p?.x ?? 0.0;     // fallback
p ??= new Point; // assign if null
```

**Primitive optionals** use `Option(T)` — see *Option*.

| Type | Null representation |
|---|---|
| Class, array, `String`, `Box<T>`, `List<T>` | `ptr = 0x00000000` |
| `str` | `ptr = 0x00000000` (first word of fat pointer) |
| `JSObject`, `JSFn`, `JSSymbol` | externref table index = 0 |

### Option

`Option(T)` is the only way to make a primitive nullable. `null` works as `None`. Direct assignment of the primitive value works as `Some`.

```js
let x = Option(isize);
x = null;           // None
x = isize(42);      // Some — direct assignment

let flag = Option(bool);
flag = true;        // Some(true)
flag = null;        // None
```

`Option` is primitive-only — CE-T04 if applied to a reference type.

**Narrowing in switch:**

```js
switch (x) {
  case Some: console.log(x);      // x narrowed to isize — unwrapped automatically
  case None: console.log("empty");
}
```

**Memory representation:** `(value: T_wasm, is_null: i32)` — two WASM values. The value slot is undefined when `is_null = 1`. `??` compiles to `i32.select` — branchless.

| Type | Memory |
|---|---|
| `Option(i8)`–`Option(usize)` | `(value: i32, is_null: i32)` — 8 bytes |
| `Option(i64)`, `Option(u64)` | `(value: i64, is_null: i32)` — 12 bytes |
| `Option(f32)` | `(value: f32, is_null: i32)` — 8 bytes |
| `Option(f64)` | `(value: f64, is_null: i32)` — 16 bytes |
| `Option(bool)` | `(value: i32, is_null: i32)` — 8 bytes |
| `Option(enum)` | `(value: i32, is_null: i32)` — 8 bytes |

`Option` is not valid in `List<T>` — CE-A11.

### JS Types

`JSObject`, `JSValue`, `JSFn`, and `JSSymbol` are defined in full in the *JavaScript Target* section. They are importable on all targets; on non-`wasm32-js-*` targets all values are null/no-op (CW-JS01).

---

## Strings

### `str` — immutable string slice. Nullable. Zero allocation on the non-escaping path.

`str` is a fat pointer `(ptr: usize, len: usize)`. String literals live in the WASM data segment as raw UTF-8 bytes — no header prefix at the pointed-to address.

**`str` null representation:** `ptr == 0`. An empty non-null `str` has `ptr != 0, len == 0`.

**`str` lifetime and GC promotion.** When a `str` is provably non-escaping — used only within its source's lexical scope — it is a raw fat pointer with zero overhead. When the compiler detects escape, it automatically promotes `str` to a compiler-internal `StrRef`: a heap-allocated RC object holding `(ptr, len)` and a strong RC reference to the owning `String`. Promotion is invisible to the programmer.

The compiler promotes `str` to `StrRef` when:
- Assignment to a class field
- Capture in a closure
- Return from a function
- Storage into an array or collection
- Assignment to a `let` binding that outlives the source `String`'s lexical scope

`str` from a literal always points to the permanently-live data segment — promotion is a no-op. `StrRef` is compiler-internal and never appears in user-visible signatures or error messages.

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

### `String` — heap-allocated mutable string. Nullable by default. RC-managed. In the implicit prelude.

`String` is the only string-building type. There is no separate builder — append directly to a `String`.

```js
// construction
new String()                    // empty String, default capacity
new String(capacity = usize(0)) // empty String with capacity hint
new String("hello")             // String from str literal
`hello, ${name}`                // String from template literal

// read (available on both str and String)
s.length                                    // usize
s.at(n = usize(0))                          // str — single character
s.slice(start = usize(0), end = usize(0))   // str (str source) / String (String source)
s.indexOf(sub = "")                         // Option(isize) — null if not found
s.lastIndexOf(sub = "")                     // Option(isize)
s.includes(sub = "")                        // bool
s.startsWith(pre = "")                      // bool
s.endsWith(suf = "")                        // bool
s.trim()                                    // str / String
s.trimStart()                               // str / String
s.trimEnd()                                 // str / String
s.toUpperCase()                             // String — allocates
s.toLowerCase()                             // String — allocates
s.replace(from = "", to = "")               // String — allocates
s.replaceAll(from = "", to = "")            // String — allocates
s.split(sep = "")                           // str[] — no allocation
s.padStart(n = usize(0), fill = "")         // String — allocates
s.padEnd(n = usize(0), fill = "")           // String — allocates
s.repeat(n = usize(0))                      // String — allocates

// mutation (mutable unaliased let binding only)
s.append(other = "")           // undefined — CE-S01 if aliased, CE-S03 if const
s.set(i = usize(0), ch = "")  // undefined — single character replacement

// low-level
s.$asView()    // str — zero-copy view into String's buffer
s.$dataPtr()   // usize — raw UTF-8 buffer address
s.$capacity    // usize
```

Static:

```js
String.fromCodePoint(cp = u32(0))   // String — heap
str.fromCodePoint(cp = u32(0))      // str — data segment
```

**Incremental construction pattern:**

```js
let s = new String(usize(256));   // pre-allocate capacity
s.append("Name: ");
s.append(name);
s.append(", score: ");
s.append(`${score}`);
```

**Template literals always produce `String`.** Interpolatable: integers, floats, `bool`, `str`, `String`, any class implementing `Symbol.toStr`.

---

## Classes

Every object is a named class instance. Purely nominal type system.

**Construction forms:**

```js
new Vec2(1.0, 2.0)             // positional
new Vec2({ x: 1.0, y: 2.0 })  // named argument block
new Vec2                        // all defaults
```

Named argument blocks require all keys to match constructor parameter names and types exactly. Unknown keys — CE-C01. Type mismatches — CE-C02.

**Field declarations.** Every field must have a known type, established either from a default value or by the constructor. Fields added via `this` in the constructor are automatically part of the class:

```js
class Circle {
  constructor(radius = f64(0), color = "") {
    this.radius = radius;   // hoisted — field: radius: f64
    this.color = color;     // hoisted — field: color: str
  }
}
```

This is equivalent to declaring `radius = f64(0)` and `color = ""` as explicit fields. Conflicting declarations — CE-C08.

**Private fields:** compile-time only. Zero runtime overhead. Not accessible from subclasses.

**Static members:** no `this`, accessed via class name only. Inherited by subclasses.

**Getters** allowed with or without setter. **Setters without getter — CE-C07.**

**`@derive` pragma:** `toStr`, `hash`, `compare`. `@derive hash` uses FNV-1a over all fields in declaration order. `@derive compare` is lexicographic in field declaration order.

**`@ordered` pragma:** fields stored in field declaration order. Use for network protocols, binary formats, FFI.

### Inheritance

Single inheritance only. The base class fields always form a prefix of the child layout.

```js
class Animal {
  name = "";
  speak() { return "..."; }
}

class Dog extends Animal {
  breed = "";
  speak() { return "woof"; }   // override
}
```

- `super()` required before `this` in derived constructors — CE-C09/CE-C06
- `extends SealedBase` outside the defining file — CE-C11
- Field override — CE-C08; only method override is permitted

**Dispatch:** method calls on an annotated base-type parameter use vtable dispatch — one implementation, one indirect call. Method calls on an unannotated parameter monomorphize per call site — direct call, no vtable overhead.

```js
function makeSpeak(a = Animal) { a.speak(); }   // vtable — one impl
function makeSpeak(a) { a.speak(); }            // monomorphized per concrete type
```

### Abstract Classes and Methods

`@abstract` on a method declares it as requiring implementation in derived classes. The body must be empty — CE if non-empty.

```js
class Shape {
  @abstract
  area() { }

  @abstract
  perimeter() { }

  describe() {
    return `area=${this.area()}`;   // can call abstract methods
  }
}

class Circle extends Shape {
  radius = f64(0);
  area() { return Math.PI * this.radius * this.radius; }
  perimeter() { return 2.0 * Math.PI * this.radius; }
}
```

`@abstract` on a class prevents direct instantiation even if all methods are implemented:

```js
@abstract
class Base { }
new Base();   // ❌ CE-C04
```

A derived class that does not implement all `@abstract` methods is itself implicitly abstract — CE-C04 if instantiated.

### Zero-Sized Types

A class with no fields is a **zero-sized type (ZST)**. ZSTs have a single singleton instance allocated once at program start. All `new ZST()` calls return the same pointer. RC operations on ZSTs are no-ops. `$byteSize` = 12 (header only).

```js
class Owned { }     // ZST
class Borrowed { }  // ZST
class Click { }     // ZST

const o = new Owned();   // always the same singleton pointer
```

ZSTs are nullable by default. A nullable ZST is effectively a boolean — the singleton pointer or null (`i32(0)`).

`undefined` is also a ZST singleton. Returning `undefined` compiles to zero WASM return values.

---

## Sealed Unions — `static $variants`

A class with `static $variants = []` is a sealed union base. The compiler scans the same file, collects every `class X extends Base`, and treats those as the complete variant set. Never assign to `$variants` — CE-C15.

```js
class Shape { static $variants = []; }
class Circle extends Shape {
  radius;
  constructor(r = f64(0)) { super(); this.radius = r; }
}
class Rect extends Shape {
  w; h;
  constructor(w = f64(0), h = f64(0)) { super(); this.w = w; this.h = h; }
}
```

Switch on a sealed union must be exhaustive — no `default`. `case ClassName:` performs `class_id` narrowing. `extends SealedBase` outside the defining file — CE-C11.

`JSValue` is a compiler-defined sealed union. User code cannot extend it — CE-C11.

---

## Enums

`enum()` creates a value-only enum whose variants compile to primitive integer constants. Enums are **primitive types** — never nullable, stored on the WASM stack, usable as `List<T>` elements.

```js
const Direction = enum({ North, South, East, West });        // isize, auto-assigned 0–3
const Status = enum({ OK = isize(200), NotFound = isize(404), Error = isize(500) });
const Toggle = enum({ off = u8(0), on = u8(1) });
```

The underlying primitive type is inferred from the first valued variant, following the same default-value pattern used throughout the language. Unvalued variants are auto-assigned in that type starting from 0. Type mismatch across variants — CE-T01. Out-of-range literal — CE-T03.

**Accessing the underlying value:**

```js
Toggle.on.value    // u8(1) — compile-time constant, no memory access
Status.OK.value    // isize(200)
```

`.value` is a no-op at the WASM level — the variant IS the integer.

**Switch on enums must be exhaustive** — CE-CF03/CE-CF07 if non-exhaustive. No `default` required for sealed enum switches.

---

## Generics

### Class Generics — `$generic()`

A class declares type parameters using `$generic()` field declarations. These fields contribute zero bytes to the object layout — they are compile-time only.

```js
class Stack {
  T = $generic();

  #items = new Array();

  push(value = T) { this.#items.push(value); }
  pop() { return this.#items.pop(); }   // T?
  peek() { return this.#items[this.#items.length - isize(1)]; }  // T?
  get length() { return this.#items.length; }  // usize
}

const s = new Stack(i32);
s.push(i32(42));      // ✅
s.push("hello");      // ❌ CE-T01 — expected i32
const v = s.pop();    // i32?
```

Multiple type parameters follow declaration order:

```js
class Pair {
  K = $generic();
  V = $generic();

  key = K;
  value = V;
}

const p = new Pair(str, i32);
```

The compiler generates a concrete class layout per unique type argument combination. `Stack(i32)` and `Stack(f64)` are two distinct compiled classes — fully resolved at compile time.

`$generic()` fields cannot be instantiated directly — CE-C04. CE if a class with `$generic()` fields is instantiated without type arguments.

**Constraints:**

```js
class NumericBox {
  T = $generic(Number);   // T must satisfy Number
  value = T;
}
```

### Function Generics — `$generic()` const

Function-level type variables are declared as `const` assignments immediately before the function definition. The `const` is scoped exclusively to the immediately following function — not visible beyond it.

```js
const T = $generic();
function identity(x = T) { return x; }

const T = $generic();
const U = $generic();
function map(arr = Array, fn = Fn(T, U)) { ... }
```

**Restrictions:**
- A `$generic()` const must be immediately followed by a function or class definition — CE if anything else follows
- `T` can only appear in type positions (parameter defaults, return annotations) — CE if used as a value
- CE if two `$generic()` consts with the same name precede the same definition

**Constraints:**

```js
const T = $generic(Number);
function sum(a = T, b = T) { return a + b; }
```

---

## Functions and Closures

**Parameter types** are established from default values. Unannotated parameters (no default) are inferred from call sites and monomorphized per unique type. Return types are always known at compile time — inferred from the function body or declared via `@returns`.

**Exported functions** must have all parameter types annotated — CE-F10 if a type cannot be determined for an exported function.

```js
function add(a = isize(0), b = isize(0)) { return a + b; }  // (isize, isize) -> isize
function double(x) { return x * 2; }   // monomorphized per call site
```

**`Fn` type syntax:**

```js
Fn(isize => bool)              // one param, returns bool
Fn(isize, isize => isize)      // two params
Fn(() => undefined)            // no params, no return
Fn(n: isize => bool)           // named param — documentation only
```

`undefined` in `Fn()` return position means "no return value." `undefined` elsewhere as a type annotation — CE-T11.

**Non-capturing arrows:** zero allocation. Represented as `(fn_index, env_ptr=0)`.

**Capturing closures:** heap allocated, RC'd. Capture rules:
- Primitives — captured by value copy (independent per closure instance)
- Heap types — captured by RC reference
- `str` — captured by value; compiler emits StrRef if backed by heap `String`
- `ListView<T>` — captured by value; lifetime is programmer's responsibility
- Mutable `let` captured — CE-F11; use `box()` for shared mutable state
- Recursive arrow closures — CE-F12; use named function declarations

**`JSFn` vs `Fn`:** `JSFn<sig>` holds a JS function in the externref table. `Fn(...)` holds a Compise closure as `(fn_index, env_ptr)`. They are not interchangeable — CE-T01.

---

## Generators

Generators use `function*` and `yield` syntax. The compiler transforms every generator into a state machine class — no coroutine stack required.

```js
function* range(start = isize(0), end = isize(0)) {
  let i = start;
  while (i < end) {
    yield i;
    i += 1;
  }
}

for (const x of range(isize(0), isize(10))) {
  console.log(x);
}
```

**Generator types:**

| Type | Description |
|---|---|
| `Generator<T>` | yield only — `next()` returns `T?` |
| `Generator<Tout, Tin>` | bidirectional — `next(Tin?)` returns `Tout?` |

Both are inferred entirely from usage — no explicit annotation needed unless the compiler cannot determine the types.

**`return`** inside a generator is a termination signal only. Must be bare `return` or `return undefined` — CE if it carries a value. Transitions the state machine to the terminal state; subsequent `next()` calls return null.

**`yield*`** delegates to another iterable, forwarding all its values:

```js
function* concat(a = Array, b = Array) {
  yield* a;
  yield* b;
}
```

**Bidirectional generators** receive values back via `next(value)`:

```js
function* accumulator() {
  let total = isize(0);
  while (true) {
    const n = yield total;   // sends total out, receives n back
    total += n ?? isize(0);
  }
}

const gen = accumulator();
gen.next(null);         // first call always passes null — starts generator
gen.next(isize(5));     // sends 5 in, receives prior yield value out
gen.next(isize(3));
```

The input type `Tin` is inferred from how the yield expression result is used. If `Tin` cannot be inferred — CE-F10.

**`for...of` with bidirectional generators** always passes null as the input — no mechanism to send values back.

**Restrictions:**
- `yield` inside a `try` block — CE-CF10
- `async`/`await` inside a generator body — CE
- `return` with a non-`undefined` value — CE
- Recursive generators with `yield*` are allowed but produce a heap chain of state machines at runtime — CW emitted

**State machine compilation:** each `yield` point becomes a distinct state. Local variables become fields on the generated state machine class. Every generator call allocates a new independent state machine — captured locals are copied into the state machine, not shared across instances.

---

## Loops

### `while` and `do...while`

```js
while (condition) { ... }
do { ... } while (condition);
```

### `for` (C-style)

```js
for (let i = isize(0); i < isize(10); i++) { ... }
```

### `for...of`

Iterates over any iterable — any value with a `next()` method returning `T?`. No explicit `.iter()` call required.

```js
for (const x of arr) { ... }
for (const i of Range(isize(0), isize(10))) { ... }
for (const x of range(isize(0), isize(10))) { ... }   // generator
for (const [k, v] of map) { ... }
```

`for...of` desugars to:

```js
const __iter = collection;
while (true) {
  const x = __iter.next();
  if (x == null) break;
  // body
}
```

**Built-in iterables:**

| Type | Yields |
|---|---|
| `Range` | `isize` |
| `StepRange` | `isize` |
| `Array<T>` | `T` |
| `List<T>` | `T` |
| `Map<K,V>` | `[K, V]` |
| `Set<T>` | `T` |
| `Stack<T>` | `T` — top to bottom |
| `Queue<T>` | `T` — front to back |
| `Deque<T>` | `T` — front to back |
| `Generator<T>` | `T` |
| `str` | `str` — single codepoints |
| `String` | `str` — single codepoints |

`for...in` banned — CE-CF01. `for...of` on a primitive type — CE.

### `break` and `continue`

`break`/`continue` outside a loop — CE-CF04. Both work inside `for...of` as expected. `break` on a generator stops calling `next()` — the generator object is abandoned and its RC drops to zero, triggering the destructor.

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

**`@ordered` layout:** fields in field declaration order. Header at offset 0.

**Inheritance layout:** base class fields always form a prefix of derived class layout. Derived fields are appended after.

**ZST layout:** 12-byte header only. `$byteSize` = 12. Zero field bytes.

**`$generic()` fields:** zero bytes. Compile-time only — not stored in the object.

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

**`List<T>`** — fixed-size contiguous buffer. One allocation. Inline data after header. Element type must be a primitive type (numeric, `bool`, or `enum`) — CE-A11 otherwise. `Option(T)` is not valid as a `List` element.

```js
const buf = new List(f32, usize(256));            // GC-managed
const buf = alloc.create(List, f32, usize(256));  // manually managed

buf[usize(0)]             // f32
buf[usize(0)] = f32(1.0)  // write
buf.length                // usize — fixed
buf.$ptr                  // usize — address of first element
buf.$byteSize             // usize — total data bytes
```

Layout: `[ rc_class:4 | vtable_ptr:4 | class_id:4 | length:4 | elem_0 | ... ]`.

On `wasm32-js-*` targets, `List<f32>` / `List<u8>` etc. can be returned to the bridge as zero-copy `TypedArray` views into linear memory.

**`ListView<T>`** — untracked typed view. Value type `(data_ptr: usize, length: usize)`. No heap allocation, no RC. Range arguments are in bytes — must divide evenly by `T.$byteSize` (CE-A10 compile-time, RT-10 runtime). Views on manually allocated lists — CE-A12.

**`Box<T>`** — heap-allocates any value. GC-managed, RC'd. Builtin.

```js
let b = box(isize(5));
b.$val++;
b.$addr;   // usize — header address
```

---

## Type Narrowing

**Switch:** `case ClassName:` performs `class_id` narrowing. Not value equality. Exhaustive for sealed unions. Non-sealed switch requires `default` — CE-CF08.

**`instanceof`:** same `class_id` check. Works on sealed and non-sealed classes, and on `JSValue` variants.

**Null checks:** `if (p != null) { p.x; }` — `p` narrowed to non-null inside the block.

**`Option` narrowing:** `case Some:` / `case None:` narrows `Option(T)` — see *Option*.

---

## Symbols and Traits

| Symbol | Purpose | Return type |
|---|---|---|
| `Symbol.next` | iterator step | `T?` — null signals done |
| `Symbol.toStr` | template literal interpolation | `String` |
| `Symbol.compare` | ordering for sort | `isize` |
| `Symbol.hash` | hash for Map/Set | `isize` |
| `Symbol.equals` | equality for Map/Set | `bool` |
| `Symbol.dispose` | cleanup on free | `undefined` |

Any class with a `next()` method returning `T?` is iterable via `for...of`.

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

Standard JS: `if/else`, `for`, `while`, `do/while`, `switch`, `break/continue`, `return`, `throw/try/catch/finally`. `for...of` over arrays, strings, iterables. `for...in` banned — CE-CF01.

**`throw`/`catch`:** class instances only. WASM exception instructions. `instanceof` narrowing in catch. `else throw e` required unless last branch handles `AppError` — CE-CF09.

**`finally`** is valid only in `try/catch` blocks. There is no concept of generator cleanup via `finally` — generators have no `finally` blocks pending on abandonment.

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
| `@abstract` | method or class | Declares abstract method / prevents direct instantiation |
| `@jsbind funcName` | `@external` function declaration | Links to named JS export |
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
function tick(dt = f64(0)) { }

class Game {
  /** @export game_update */
  static update(dt = f64(0)) { }
}
```

`export` keyword = inter-module visibility for other Compise files. `@export` = WASM host visibility. Orthogonal.

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

#### `JSObject`

An opaque reference to any JS heap value — object, array, function, DOM node, Map, Date, or any non-primitive. Represented as `i32` externref table index. Nullable — index 0 is null.

`JSObject` has reference identity. Two `JSObject` values are equal iff they refer to the same JS object (`===`). No structural equality.

**All operations on `JSObject` are instance methods with predefined signatures — all types are known at compile time:**

```js
// property access
obj.get(key = "")                           // JSValue
obj.getStr(key = "")                        // str
obj.getF64(key = "")                        // f64
obj.getI32(key = "")                        // i32
obj.getBool(key = "")                       // bool
obj.getObj(key = "")                        // JSObject?

// property set
obj.set(key = "", val = JSValue)            // undefined
obj.setStr(key = "", val = "")              // undefined
obj.setF64(key = "", val = f64(0))         // undefined
obj.setI32(key = "", val = i32(0))         // undefined
obj.setBool(key = "", val = false)         // undefined

// Symbol-keyed access
obj.getSymbol(key = JSSymbol)               // JSValue
obj.setSymbol(key = JSSymbol, val = JSValue) // undefined
obj.hasSymbol(key = JSSymbol)               // bool
obj.deleteSymbol(key = JSSymbol)            // bool
obj.callSymbol(key = JSSymbol, ...)         // JSValue

// method calls
obj.call(method = "", ...)                  // JSValue
obj.callStr(method = "", ...)               // str
obj.callF64(method = "", ...)               // f64
obj.callI32(method = "", ...)               // i32
obj.callBool(method = "", ...)              // bool
obj.callObj(method = "", ...)               // JSObject?
obj.callVoid(method = "", ...)              // undefined

// type introspection
obj.typeof()                                // str
obj.instanceof(ctor = JSObject)             // bool
obj.isArray()                               // bool
obj.isJSNull()                              // bool — JS null
obj.isUndefined()                           // bool — JS undefined

// conversion
obj.toStr()                                 // String
obj.toF64()                                 // f64
obj.toI32()                                 // i32
obj.toBool()                                // bool

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
class JSUndefined extends JSValue { }
class JSNull      extends JSValue { }
class JSBool      extends JSValue { value; constructor(v = false)    { } }
class JSInt       extends JSValue { value; constructor(v = i32(0))   { } }
class JSNumber    extends JSValue { value; constructor(v = f64(0))   { } }
class JSBigInt    extends JSValue { value; constructor(v = i64(0))   { } }
class JSString    extends JSValue { value; constructor(v = "")       { } }
class JSObj       extends JSValue { value; constructor(v = JSObject) { } }
class JSArr       extends JSValue {
  value;
  length;   // usize
  constructor(v = JSObject) { }
}
```

**Narrowing — switch must be exhaustive:**

```js
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
```

**All operations on `JSValue` are instance methods:**

```js
val.isNullish()              // bool
val.isTruthy()               // bool
val.isString()               // bool
val.isNumber()               // bool
val.isBool()                 // bool
val.isObject()               // bool
val.isArray()                // bool
val.isBigInt()               // bool

val.asStr(fallback = "")            // str
val.asF64(fallback = f64(0))       // f64
val.asI32(fallback = i32(0))       // i32
val.asBool(fallback = false)       // bool
val.asObj()                         // JSObject?
val.asBigInt(fallback = i64(0))    // i64

val.coerceStr()              // String — JS String(value) semantics
val.coerceF64()              // f64   — JS Number(value) semantics
val.coerceI32()              // i32   — JS (value | 0) semantics
val.coerceBool()             // bool  — JS Boolean(value) semantics
```

#### `JSFn`

A typed JS function reference in the externref table. `JSFn` calls generate a dedicated WASM import per call signature.

```js
const cb = JSFn(str => undefined);
cb("hello");
```

Nullable — index 0 is null. Not interchangeable with `Fn(...)` — CE-T01.

#### `JSSymbol`

A JS `Symbol` value in the externref table. Used for Symbol-keyed property access.

```js
import { jsSymbol, jsSymbolFor, JS_SYMBOL_ITERATOR, JS_SYMBOL_DISPOSE } from "std/js";

const MY_TAG = jsSymbol();          // fresh symbol — create once at module scope
const SHARED = jsSymbolFor("app.id"); // Symbol.for — global registry

obj.setSymbol(MY_TAG, JSValue.fromStr("tagged"));
obj.getSymbol(MY_TAG);   // JSValue
```

`jsSymbol()` creates a new symbol on every call — create at module scope as `const`, not inside functions.

---

### JS Bindings

JS bindings let Compise call plain JS functions. The `.jsbind.js` file declares the bridge; plain JS files contain the implementation.

```js
//# module mylib
//# jsbind

import { getElementById } from "./dom.js";

/**
 * @external js.dom.getElementById
 * @jsbind getElementById
 * @returns {JSObject?}
 */
function dom_getElementById(id = "") { }
```

```js
// dom.js — plain JS, no bridge knowledge
export function getElementById(id) {
  return document.getElementById(id) ?? null;
}
```

The compiler generates a marshalling adapter. The user's plain JS function receives and returns ordinary JS values. Bridge internals (`_readStr`, `_writeStr`, `_extGet`, `_extSet` etc.) are adapter-only — CE-B09 if referenced in user code.

**`js { }` block:** helper declarations and init code embedded in the bridge.

```js
js {
  const canvas = document.getElementById("c");  // hoisted — bridge module scope
  canvas.getContext("2d");                       // post-init — runs after WASM instantiation
}
```

**`//# js.import`:** third-party JS dependencies.

```js
//# js.import gl-matrix@3.4.3 as glm url "https://cdn.jsdelivr.net/npm/gl-matrix/+esm"
```

---

### JS Casting

On JS targets, casting between Compise types and JS values follows defined rules. See the Compiler Reference for the full marshalling adapter pipeline.

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
parseInt(s = "", radix = isize(10))   // Option(isize) — null on parse failure
parseFloat(s = "")                     // Option(f64) — null on parse failure
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

## Diagnostics

```
Compile errors (CE)       — programmer mistakes caught statically. Zero runtime cost.
Compiler internal (CIT)   — test pragma assertions. Only with --test-pragmas.
Runtime traps (RT)        — unrecoverable. Emit WASM unreachable.
Runtime exceptions (RX)   — recoverable. WASM exception instructions.
Compiler warnings (CW)    — non-fatal. Compiler continues.
```

Null dereference via `.` is UB in release. Debug builds insert null checks and trap (RT-06).

### Compile Errors (CE)

**Type errors:** CE-T01 (mismatch), CE-T02 (implicit coercion), CE-T03 (out-of-range literal), CE-T04 (nullable where non-null required / `Option` on reference type), CE-T05 (`bool` in numeric), CE-T06 (abstract type instantiated), CE-T07 (wrong return type), CE-T08 (missing return), CE-T09 (interpolation without `Symbol.toStr`), CE-T10 (`.raise()` outside `@returns {Result<T>}` function), CE-T11 (`undefined` as type annotation outside `Fn()` return), CE-T12 (constraint not satisfied).

**Variable errors:** CE-V01 (`const` reassign), CE-V02 (undeclared), CE-V03 (use before declaration), CE-V04 (duplicate declaration), CE-V05 (`$`-prefixed identifier), CE-V06 (`var`).

**Class errors:** CE-C01 (unknown key in named block), CE-C02 (key type mismatch), CE-C03 (private field outside class), CE-C04 (sealed/abstract/ZST instantiation), CE-C05 (`this` outside method), CE-C06 (`this` before `super()`), CE-C07 (setter without getter), CE-C08 (duplicate field/method), CE-C09 (missing `super()`), CE-C10 (`$offset` index out of range), CE-C11 (`extends` sealed base outside file / `extends JSValue` from user code), CE-C15 (write to `$variants`), CE-C16 (`$variants` declared twice), CE-C18 (`$variants` non-empty init).

**Function errors:** CE-F02 (wrong argument count), CE-F03 (argument type mismatch), CE-F04 (`arguments`), CE-F05 (arrow as constructor), CE-F06 (null path conflicts `@returns`), CE-F07 (recursive or `.raise()`-using function without `@returns`), CE-F08 (exported ambiguous return), CE-F09 (`@param` conflict), CE-F10 (exported function parameter type cannot be determined), CE-F11 (mutable `let` captured), CE-F12 (recursive arrow).

**Control flow errors:** CE-CF01 (`for...in`), CE-CF02 (switch fallthrough), CE-CF03 (non-exhaustive sealed switch), CE-CF04 (`break`/`continue` outside loop), CE-CF05 (unreachable code), CE-CF06 (ternary type mismatch), CE-CF07 (non-exhaustive sealed switch in value position), CE-CF08 (non-sealed switch without `default`), CE-CF09 (catch chain missing `else throw`), CE-CF10 (`yield` inside `try` block).

**Access errors:** CE-A01 (bracket on non-array), CE-A02 (`eval`/`Function()`), CE-A03 (prototype access), CE-A04 (nested destructuring), CE-A05 (nullable destructuring), CE-A06 (`delete`), CE-A07 (`?.` on non-nullable), CE-A08 (`.sort()` without `Symbol.compare`), CE-A10 (view range not divisible — compile-time), CE-A11 (`List` non-primitive element), CE-A12 (`.view()` on manual `List`), CE-A13 (sub-view out of range — compile-time).

**Manual memory errors:** CE-MM01 (scope exit without free), CE-MM02 (use after free), CE-MM03 (free after escape), CE-MM04 (alias of manual binding).

**Ownership errors:** CE-O08 (`box()` wrapping manual), CE-O09 (arena/pool object moved out).

**String errors:** CE-S01 (aliased `String` mutation), CE-S02 (invalid weak reference), CE-S03 (const `String` mutation).

**Linking errors:** CE-L01 (heap object as owned to foreign), CE-L02 (foreign returns heap pointer), CE-L03 (`--multi-memory` without runtime support).

**Module errors:** CE-M05 (import non-existent), CE-M06 (circular import), CE-M07 (bare specifier), CE-M08 (`.wasm` arity mismatch), CE-M09 (`.wasm` type mismatch).

**Pragma errors:** CE-P01 (unknown tag), CE-P02 (`@symbol` on non-method), CE-P03 (`@export` on non-function), CE-P04 (`@ordered` on non-class), CE-P05 (`@external` missing name).

**Binding errors:** CE-B01 (`@jsbind funcName` — name not found in file's JS imports), CE-B02 (`@jsbind` function has non-empty body), CE-B03 (`@jsbind.type` class instantiated with `new`), CE-B04 (name collision in `js { }` blocks across libraries), CE-B05 (`@jsbind.get` has parameters / `@jsbind.set` has wrong parameter count), CE-B06 (`@jsbind.type` missing `@jsbind.jsType`), CE-B07 (`@jsbind.error` on non-`AppError` class), CE-B08 (`.jsbind.js` file missing `//# module`), CE-B09 (`@jsbind` function body references bridge internals).

**Generator errors:** CE-CF10 (`yield` inside `try` block).

### Compiler Warnings (CW)

| Code | Condition |
|---|---|
| CW-F01 | Ambiguous return type — defaulted to `isize` |
| CW-F02 | `@returns` nullable but no null path |
| CW-F03 | `@param` redundant |
| CW-C01 | `default` in switch on sealed class — unreachable |
| CW-M10 | Explicit import of prelude member |
| CW-JS01 | `JSObject`/`JSValue`/`JSFn`/`JSSymbol` or `std/js/*` import on non-`wasm32-js-*` target |
| CW-B01 | `//# js.import` has no `url` form for `wasm32-js-bundle` target |
| CW-B02 | Version conflict in `//# js.import` specifier across two libraries |
| CW-B03 | `@jsbind` import name declared but not linked to any Compise function |
| CW-G01 | Recursive generator with `yield*` — produces heap chain of state machines |

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

## Style Guide

**Let defaults do the typing.** Use abstract types for generic intent; concrete types only when a function genuinely only works for one specific type.

**Omit `@returns` unless the compiler requires it.** Required for: recursive functions, exported functions with ambiguous returns, `.raise()` propagation.

**Omit `@param` in application code.** Reserve for public library APIs.

**Use `new` for GC objects.** `alloc.create` is for explicit lifetime management only.

**Prefer `str` for input, `String` for output.**

**Use `?.` and `??` for simple null fallbacks.**

**Use `@derive` before writing symbol implementations manually.**

**Type variables only when a type links multiple positions.**

**Keep `std/mem` imports isolated** — they signal low-level code deserving extra scrutiny.

**Exhaustive switches on sealed unions and enums. `default` on everything else.**

**Named construction for non-obvious arguments** — use named blocks when a constructor has three or more parameters with non-obvious meaning.

**On `wasm32-js-*` targets:** prefer typed `JSFn` return types over `JSValue` where the JS return type is statically known.

**Use `jsSymbol()` at module scope** — create fresh symbols once as module-level `const`, not inside functions.

**All method dispatch is resolved at compile time.** There is no runtime type lookup, no dynamic dispatch beyond vtable calls, and no way to call a method on a type not known at compile time.

---

*End of Compise Language Specification*
