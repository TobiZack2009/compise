# js.wat Language Specification
### Version 1.3

> A statically-typed, JIT-friendly language with JavaScript syntax that compiles to WebAssembly.
> No eval. No hidden classes. No surprises.

**What's new in v1.3:**
- §25 Errors — full CE/RT/RX taxonomy, WASM exception instructions, updated object header
- §26 String ↔ Number conversions — backtick interpolation as the only number-to-string path, `.parse()` with radix, `Symbol.toStr` for class interpolation
- §27 Modules — full resolution algorithm, `.wasm` direct imports, all import/export forms
- §28 Implicit Prelude — Rust-style always-in-scope names, no import needed
- §29 Tree-shaking — five levels, full pipeline, `--wasi` branch folding
- Object header updated: 3-slot prefix (rc+class_bits, vtable_ptr, class_id)
- Null dereference via `.` is UB — debug traps, release assumes never happens
- `String.from` removed — use `` `${n}` `` instead
- `.parse(s, radix?)` added to all integer types; `.parse(s)` for floats

## 1. Philosophy

JavaScript is hard to JIT because its semantics are fundamentally dynamic: objects can change shape at any time, types can change at runtime, and `eval` can introduce arbitrary code. js.wat keeps the *syntax* and *feel* of JavaScript while removing these guarantees one by one.

Files use the `.js` extension. The compiler treats every `.js` file it receives as js.wat. Existing JS tooling handles js.wat files transparently since the syntax is a strict JS subset.

**Core constraints that make js.wat fast:**

| JS Problem | js.wat Solution |
|---|---|
| Objects change shape at runtime | All objects are nominal class instances — shapes fixed at class definition |
| Types change per variable | Every binding has a single, inferred static type |
| `[]` access on objects | Bracket notation banned on objects; allowed on arrays only |
| `eval`, `Function()`, `new Function` | Banned entirely |
| Prototype mutation at runtime | No prototype chain; classes are nominal and sealed |
| Implicit numeric coercion | All numeric types are distinct; explicit casts required |
| `arguments` object | Banned; rest parameters only |

---

## 2. Variables

### 2.1 `let` and `var`

`let` and `var` are identical in js.wat — both declare mutable, block-scoped bindings. `var` is reserved for potential future explicit heap allocation syntax. The compiler emits a warning when `var` is used:

```js
let x = 42;    // mutable, block-scoped
var y = 42;    // identical to let — warning: consider using let
```

### 2.2 `const`

`const` declares an immutable binding. The compiler attempts compile-time evaluation first. If the expression resolves fully at compile time, the value is inlined everywhere — zero runtime cost. Otherwise it becomes a **runtime constant** — evaluated once at program start, then permanently immutable:

```js
// Compile-time — inlined everywhere
const PI = 3.14159;
const MAX = 100 * 4;
const APP = "js.wat";

// Runtime — evaluated once at startup, then immutable
const START = Clock.now();
const RNG = new Random(42);
```

`const` bindings can never be reassigned — the binding is immutable, not the value it points to:

```js
const x = 42;
x = 10;              // ❌ ERROR: cannot reassign const
const p = new Player;
p.score += 1;        // ✅ — mutating the object is fine
```

**Compile-time evaluable:** literals, other compile-time `const` references, arithmetic on compile-time values, `str` builtins on compile-time strings.

### 2.3 `static` (class-level)

Static fields on classes are shared across all instances — one allocation in linear memory, globally accessible via class name:

```js
class Config {
  static MAX = 100;
  static NAME = "js.wat";
}
Config.MAX;    // isize
Config.NAME;   // str
```

### 2.4 Summary

| Keyword | Scope | Mutable | Compile-time? | Notes |
|---|---|---|---|---|
| `const` | block | ❌ binding | if possible | runtime constant otherwise |
| `let` | block | ✅ | ❌ | standard mutable binding |
| `var` | block | ✅ | ❌ | identical to let — reserved |
| `static` (class) | global | ✅ | ❌ | one shared copy per class |

---

## 3. Types

### 3.1 Numeric Type Hierarchy

All numeric types form a hierarchy. `Number`, `Integer`, and `Float` are **abstract** — usable as parameter constraints, never directly instantiable:

```
Number
├── Integer
│   ├── i8        — 8-bit signed
│   ├── u8        — 8-bit unsigned
│   ├── i16       — 16-bit signed
│   ├── u16       — 16-bit unsigned
│   ├── i32       — 32-bit signed
│   ├── u32       — 32-bit unsigned
│   ├── i64       — 64-bit signed
│   ├── u64       — 64-bit unsigned
│   ├── isize     — pointer-sized signed   (i32 on WASM32, i64 on WASM64)
│   └── usize     — pointer-sized unsigned (u32 on WASM32, u64 on WASM64)
└── Float
    ├── f32       — 32-bit float
    └── f64       — 64-bit float
```

**Defaults:**
```js
let x = 42;      // isize — default integer literal
let y = 3.14;    // f64   — default float literal
```

All numeric types and `bool` are **never nullable**. `Number`, `Integer`, `Float` cannot be instantiated directly.

### 3.2 WASM Type Mappings

Every js.wat type maps to a WASM value type for use in registers and function signatures:

**In registers / function signatures:**

| js.wat type | WASM type | Notes |
|---|---|---|
| `bool` | `i32` | 0 = false, 1 = true |
| `i8` | `i32` | sign-extended on load |
| `u8` | `i32` | zero-extended on load |
| `i16` | `i32` | sign-extended on load |
| `u16` | `i32` | zero-extended on load |
| `i32`, `u32` | `i32` | native; unsigned ops use unsigned instructions |
| `i64`, `u64` | `i64` | native; unsigned ops use unsigned instructions |
| `isize`, `usize` | `i32` (WASM32) / `i64` (WASM64) | platform-sized |
| `f32` | `f32` | native |
| `f64` | `f64` | native |
| `str` | `i32` | pointer into data segment |
| `String` | `i32` | heap pointer or 0 (null) |
| class instance | `i32` | heap pointer or 0 (null) |
| array | `i32` | array header pointer or 0 (null) |
| `Ptr<T>` | `i32` | Ptr box pointer or 0 (null) |
| `null` | `i32` | always 0 |

**In memory (struct fields, array elements):**

| js.wat type | Memory size | Load instruction | Store instruction |
|---|---|---|---|
| `bool` | 1 byte | `i32.load8_u` | `i32.store8` |
| `i8` | 1 byte | `i32.load8_s` | `i32.store8` |
| `u8` | 1 byte | `i32.load8_u` | `i32.store8` |
| `i16` | 2 bytes | `i32.load16_s` | `i32.store16` |
| `u16` | 2 bytes | `i32.load16_u` | `i32.store16` |
| `i32`, `u32` | 4 bytes | `i32.load` | `i32.store` |
| `i64`, `u64` | 8 bytes | `i64.load` | `i64.store` |
| `isize`, `usize` | 4/8 bytes | `i32.load` / `i64.load` | platform |
| `f32` | 4 bytes | `f32.load` | `f32.store` |
| `f64` | 8 bytes | `f64.load` | `f64.store` |
| any pointer | 4/8 bytes | `i32.load` / `i64.load` | platform |

### 3.3 Casting

Constructor-style casts — no implicit coercion ever:

```js
i8(x)    u8(x)    i16(x)   u16(x)
i32(x)   u32(x)   i64(x)   u64(x)
isize(x) usize(x) f32(x)   f64(x)
```

Narrowing truncates or wraps. Widening is lossless for integers, may lose precision for floats:

```js
u8(300)          // wraps → u8(44)
u8(-1)           // wraps → u8(255)
i32(3.9)         // truncates toward zero → i32(3)
u32(i32(-1))     // reinterprets → u32(4294967295)
```

`bool` never casts to a number — use a ternary:
```js
true ? 1 : 0;    // ✅
i32(true);       // ❌ ERROR: bool is not a Number
```

### 3.4 Type Propagation

Once a variable's type is established, subsequent assignments of untyped literals adapt automatically:

```js
let x = u8(4);
x = 44;          // ✅ — 44 adapts to u8
x = 256;         // ❌ ERROR: 256 out of range for u8
x += 1;          // ✅ — 1 adapts to u8
x++;             // ✅
```

Propagation chains through assignments, returns, ternary branches, array elements, and function arguments:

```js
let bytes = [u8(0)];
bytes.push(44);     // ✅ — 44 adapts to u8
bytes[0] = 255;     // ✅

function add(a = u8(0), b = u8(0)) { return a + b; }
add(10, 20);        // ✅ — literals adapt to u8
```

When both operands are untyped literals, defaults apply (`isize` or `f64`). Type propagation never crosses the Integer/Float boundary.

### 3.5 Mixed Arithmetic

Mixing types without an explicit outer cast is a compile error. Inside an explicit cast, all operands promote to the highest precision type present, arithmetic is performed, then the result is cast to the target:

```js
u8(1 + 2.0)                // 1→f64, 3.0, cast to u8(3)
f32(i64(5) + 3.14)         // i64→f64, 8.14, cast to f32
i32(u8(200) + 100 + 3.14)  // all→f64, 303.14, cast to i32(303)
```

**Promotion order (lowest → highest):**
```
i8 → u8 → i16 → u16 → i32 → u32 → isize → usize → i64 → u64 → f32 → f64
```

Float always wins over integer. Inner casts lock before outer promotion. Overflow wraps for all integer types.

### 3.6 Strings: str vs String

**`str` — static string slice (std/core):**

Immutable, zero-cost, WASM data segment. Never nullable. Builtins available without import:

```js
let s = "hello";
s.length          // usize
s.slice(0, 3)     s.indexOf("e")     s.includes("ell")
s.startsWith("he") s.endsWith("lo")  s.trim()
s.trimStart()     s.trimEnd()        s.toUpperCase()
s.toLowerCase()   s.split(",")      s.replace("h","H")
s.padStart(10,"0") s.padEnd(10," ") s.repeat(3)
s.at(0)           // str — single char
```

Memory layout (data segment): `[ length:4 | hash:4 | bytes... ]`

**`String` — heap-allocated mutable string (implicit prelude):**

```js
// String is in the implicit prelude — no import needed
let s = new String("hello");
s.append(" world");  s.set(0, "H");
s.asStr();           // str — zero-copy view
s.dataPtr();         // usize — address of raw byte buffer (past header)
s.length;            // usize
```

Memory layout: `[ rc_class:4 | vtable_ptr:4 | class_id:4 | length:4 | capacity:4 | hash:4 | *buf:4 ]` — 28-byte header.

**Template literals produce `String`. Interpolatable types: all integers, all floats, `bool`, `str`, `String`, and any class implementing `Symbol.toStr`.**

### 3.7 Nullability

Class instances, arrays, and `String` are nullable by default. All numeric types, `bool`, and `str` are never nullable. Null is `0x0` for all nullable types.

```js
p?.x;              // safe — Float?
p.x;               // fast — UB if null
p?.x ?? 0.0;       // fallback
p ||= new Point;   // assign if null
p &&= new Point;   // assign if non-null
p ??= new Point;   // assign if null
```

### 3.8 Classes

Every object is a named class instance. Purely nominal type system. Classes sealed at definition.

**Three construction forms:**

```js
new Vec2(1.0, 2.0);              // positional
new Vec2({ x: 1.0, y: 2.0 });   // named argument block
new Vec2({ x: 1.0 });            // partial — y defaults to 0.0
new Vec2;                         // all defaults
```

Named argument blocks (`{}` inside `new`) are not object literals — they are named parameter maps. Keys must match constructor parameter names and types. Unknown keys are compile errors.

**Private fields and methods:**

```js
class Player {
  #score;
  name;
  constructor(name = "", score = 0) {
    this.name = name;
    this.#score = score;
  }
  get score() { return this.#score; }
  damage(n = 0) { this.#score -= n; }
}
```

Private fields are compile-time only — zero runtime overhead. Not accessible from subclasses.

**Static members:**

```js
class IdGen {
  static #next = 0;
  static next() {
    const id = IdGen.#next;
    IdGen.#next++;
    return id;
  }

  //@export("idgen_next")
  static exportedNext() { return IdGen.next(); }

  static get count() { return IdGen.#next; }
}
```

Static methods have no `this`. Accessed via class name only — never via instance. Inherited by subclasses. Static-only classes (all members static) cannot be instantiated — compiler detects automatically.

**Getters and setters:**

Getters allowed with or without setter. Setters without getter are banned. Static getters/setters follow same rules.

**Inheritance:** single only. Child adds fields only. `super()` before `this` in child constructors.

**Compiler-generated class constants:**

```js
Entity.byteSize    // usize — total bytes per instance including refcount header
Entity.stride      // usize — byte increment between elements in a flat array
```

### 3.9 Memory Layout

**Object header — every heap object has a 12-byte prefix before its fields:**

```
Offset 0   [ rc_and_class : 4 ]   bits [31:28] = size-class index (0–10)
                                   bits [27:0]  = refcount (0xFFFFFFF max)
                                   0xFFFFFFFF   = manual sentinel (never GC-freed)
Offset 4   [ vtable_ptr   : 4 ]   pointer to vtable, or 0 if no symbol methods
Offset 8   [ class_id     : 4 ]   unique u32 per class, assigned by compiler
Offset 12  [ fields...        ]   user-defined fields start here
```

`class_id` is used by `instanceof`, `switch` type narrowing, and `catch` dispatch. `vtable_ptr` points to the compiler-generated vtable for any class implementing symbol methods. Every heap object carries these 12 bytes — including arrays, `String`, and `Ptr` boxes.

**Compact field layout (default):**

User fields are sorted by descending size to minimise padding. Sort is stable within the same size class:

```
Sort order: f64/i64/u64 (8) → f32/i32/u32/isize/usize/ptr (4) → i16/u16 (2) → i8/u8/bool (1)
```

```js
class Entity {
  id;       // isize  4 bytes
  x;        // f64    8 bytes
  y;        // f64    8 bytes
  health;   // i32    4 bytes
  active;   // bool   1 byte
  tag;      // u8     1 byte
  flags;    // u16    2 bytes
  constructor(id=0, x=0.0, y=0.0, health=i32(0), active=true, tag=u8(0), flags=u16(0)) { ... }
}
```

Compact layout (header + fields):
```
Offset  Field       Type    Size
0       rc_class    —       4    ← header
4       vtable_ptr  —       4    ← header
8       class_id    —       4    ← header
12      x           f64     8    ← 8-byte fields first
20      y           f64     8
28      id          isize   4    ← 4-byte fields
32      health      i32     4
36      flags       u16     2    ← 2-byte fields
38      active      bool    1    ← 1-byte fields
39      tag         u8      1
40      (pad)       —       4    ← pad to multiple of largest alignment (8)
```

Total: 44 bytes. `Entity.byteSize = usize(44)`.

**`//@ordered` — fields in constructor assignment order:**

```js
//@ordered
class WireFormat {
  version;   // u8
  type;      // u8
  length;    // u16
  payload;   // u32
  constructor(version=u8(0), type=u8(0), length=u16(0), payload=u32(0)) { ... }
}
```

Use for network protocols, binary formats, and FFI where host expects a specific field order. `//@ordered` affects field layout only — the 12-byte header is always present and always at offset 0.

**Inheritance layout:**

Parent fields always form a prefix of child layout — enables safe pointer narrowing. The header is shared:

```
Shape:   [ header:12 | color:4 ]
Circle:  [ header:12 | color:4 | radius:8 ]
         ↑ identical prefix — a Circle* can be read as Shape*
```

**Static fields:**

Live in a separate region of linear memory — one allocation per class, no header:
```
Static data region: [ IdGen.#next:4 | Config.MAX:4 | ... ]
```

**Reference fields:**

Class instances, arrays, `String`, and `Ptr` are stored as 4-byte pointers (WASM32) in struct field layout.

### 3.10 Tagged Unions

```js
class Shape { }
class Circle extends Shape { radius; constructor(r=0.0){super();this.radius=r;} }
class Rect extends Shape { w;h; constructor(w=0.0,h=0.0){super();this.w=w;this.h=h;} }
```

### 3.11 Generics

Classes and functions monomorphize per unique type combination. Abstract numeric types as defaults enable numeric generics:

```js
class Stack {
  #items;
  constructor(items = [0]) { this.#items = items; }
  push(item = 0) { this.#items.push(item); }
  pop() { return this.#items.pop(); }
}

new Stack([0]);      // Stack<isize>
new Stack([0.0]);    // Stack<f64>
new Stack([u8(0)]); // Stack<u8>

function clamp(val = Integer, min = Integer, max = Integer) {
  if (val < min) return min;
  if (val > max) return max;
  return val;
}

clamp(u8(200), u8(0), u8(100));   // clamp<u8>
clamp(5, 0, 10);                   // clamp<isize>
```

### 3.12 Arrays

Typed, homogeneous, dynamic. Nullable by default. Element type inferred from literal or first `push`. `[]` indexing is the only bracket notation allowed. Index type is `usize`:

```js
let bytes = [u8(0)];
bytes.push(44);          // ✅ adapts to u8
bytes[0] = 255;          // ✅
bytes.length;            // usize
```

`pop` returns nullable for reference types, panics on empty primitive arrays. Initial capacity 4, doubles on overflow.

Array layout:
```
Header: [ rc_class:4 | vtable_ptr:4 | class_id:4 | length:4 | capacity:4 | *data:4 ]
Buffer: [ elem_0 | elem_1 | ... | (unused) ]
```

Primitives stored flat inline. Class instances and strings stored as pointers.

### 3.13 Pointers

`ptr()` heap-boxes any value. Part of `std/core` — no import needed:

```js
let x = ptr(5);      // Ptr<isize>
x.val;               // isize — read
x.val = 10;          // write
x.val += 1;          // ✅
x.val++;             // ✅
```

`Ptr` layout: `[ rc_class:4 | vtable_ptr:4 | class_id:4 | value:N ]`

**Pointer arithmetic:**

```js
p.addr                                      // usize — raw address, read only
ptr.fromAddr(addr = usize(0), type)         // Ptr<T> — type anchored by second arg
ptr.diff(a = ptr(0), b = ptr(0))            // isize — a.addr - b.addr
```

```js
const base = alloc.create(Pixel);
const next = ptr.fromAddr(base.addr + Pixel.stride, Pixel);
next.val.r = u8(128);

const dist = ptr.diff(next, base);          // isize — one Pixel.stride
```

Manually allocated objects carry the `0xFFFFFFFF` sentinel in their `rc_class` field. The GC's `rc_inc`/`rc_dec` skip them automatically — they can be stored directly in GC class fields and arrays with no special annotation.

### 3.14 Functions

Every parameter must have a default. Defaults are type contracts:

| Default | Type | Monomorphizes? |
|---|---|---|
| `= 0` | `isize` | ❌ locked |
| `= 0.0` | `f64` | ❌ locked |
| `= u8(0)` | `u8` | ❌ locked |
| `= Integer` | any Integer subtype | ✅ per subtype |
| `= Float` | any Float subtype | ✅ per subtype |
| `= Number` | any numeric type | ✅ per type |
| `= ""` | `str` | ✅ |
| `= MyClass` | `MyClass` or subclass | ❌ nominal |

No `arguments` object. Arrow functions identical to declarations but storable and returnable. Declarations hoisted, arrows not.

---

## 4. Calling Convention

js.wat functions compile to WASM functions. Parameters and return values use WASM value types per the mapping in section 3.2.

**Simple scalars — passed directly:**

```js
function add(a = 0, b = 0) { return a + b; }
// WASM: (func (param i32 i32) (result i32))

function lerp(a = 0.0, b = 0.0, t = 0.0) { return a + (b - a) * t; }
// WASM: (func (param f64 f64 f64) (result f64))
```

**Class instances, arrays, String, Ptr — passed as i32 pointer:**

```js
function area(s = Shape) { ... }
// WASM: (func (param i32) (result f64))
//              ^heap pointer or 0

function increment(p = ptr(0)) { p.val++; }
// WASM: (func (param i32))
//              ^Ptr box address
```

**Multiple return values — sret pointer:**

WASM returns at most one value. When a function returns a class instance or multiple values, the caller allocates space and passes a hidden sret pointer as the first parameter:

```js
function minMax(arr = [0]) { return new MinMax(min, max); }
// WASM: (func (param i32 i32))   // sret ptr, array ptr — result written to sret
```

**Full parameter mapping:**

| js.wat | WASM param | Notes |
|---|---|---|
| `bool` | `i32` | 0 or 1 |
| `i8`–`u16` | `i32` | sign/zero extended |
| `i32`, `u32` | `i32` | direct |
| `i64`, `u64` | `i64` | direct |
| `isize`, `usize` | `i32` (WASM32) | platform |
| `f32` | `f32` | direct |
| `f64` | `f64` | direct |
| `str` | `i32` | data segment pointer |
| `String` | `i32` | heap pointer or 0 |
| class instance | `i32` | heap pointer or 0 |
| array | `i32` | header pointer or 0 |
| `Ptr<T>` | `i32` | Ptr box pointer or 0 |

**Refcount across call boundary:**

Passing a heap value to a function increments its refcount at the call site and decrements after return. For `//@export` functions — the host holds the reference. Provide explicit retain/release exports for long-lived host references:

```js
//@export("retain")
function retain(p = ptr(Player)) { /* compiler emits refcount increment */ }

//@export("release")
function release(p = ptr(Player)) { /* compiler emits refcount decrement — may free */ }
```

---

## 5. Type Narrowing

### 5.1 Switch

```js
function area(s = Shape) {
  switch (s) {
    case Circle: return Math.PI * s.radius ** 2;
    case Rect:   return s.w * s.h;
  }
}
```

No fallthrough. No `break`. Exhaustiveness enforced at compile time for tagged unions. At runtime, narrowing is a single `i32.load offset=8` (read `class_id`) followed by `i32.eq` against the compiler-assigned id for each variant — zero overhead.

### 5.2 If

```js
if (s instanceof Circle) { s.radius; s.color; }
```

`instanceof` compiles to the same `class_id` check. Combinable with `&&`. Elimination narrowing in `else` for two-variant unions. No exhaustiveness check.

### 5.3 Null checks

```js
if (p != null) { p.x; }    // p narrowed to non-null inside block
p?.x;                       // safe — null propagates, no trap
p.x;                        // fast — UB if p is null (see §25.2)
```

---

## 6. Symbols and Traits

Symbols define trait contracts via `//@symbol(SymbolName)` pragma.

**Well-known symbols:**

| Symbol | Purpose | Return type |
|---|---|---|
| `Symbol.iterator` | `for...of` support | class implementing `Symbol.next` |
| `Symbol.next` | iterator step | `IteratorResult<T>` |
| `Symbol.toPrimitive` | numeric conversion | numeric type |
| `Symbol.toStr` | string conversion for template literals | `str` |
| `Symbol.compare` | ordering for sort | `isize` |
| `Symbol.hash` | hash for Map/Set | `isize` |
| `Symbol.equals` | equality for Map/Set | `bool` |
| `Symbol.dispose` | cleanup on free | `void` |

`Symbol.dispose` called automatically when refcount hits zero.

`Symbol.toStr` is required for a class to be used inside template literal interpolation `${}`. If a class is interpolated without implementing `Symbol.toStr`, the compiler rejects it with `CE-T09`.

**User-defined symbols:**

```js
const Drawable = Symbol("Drawable");

class Sprite {
  //@symbol(Drawable)
  draw() { }
}

function render(obj = Drawable) { obj.draw(); }
```

Abstract types as symbol constraints: `function render(obj = Drawable)` — obj must implement Drawable.

---

## 7. Iterator Protocol

**`IteratorResult<T>`** — builtin in `std/core`:

```js
class IteratorResult {
  value; done;
  constructor(value = 0, done = false) { this.value = value; this.done = done; }
}
```

**Implementing:**

```js
class Range {
  start; end;
  constructor(start = 0, end = 0) { this.start = start; this.end = end; }

  //@symbol(Symbol.iterator)
  iter() { return new RangeIter(this.start, this.end); }
}

class RangeIter {
  current; end;
  constructor(current = 0, end = 0) { this.current = current; this.end = end; }

  //@symbol(Symbol.next)
  next() {
    if (this.current < this.end) {
      const val = this.current++;
      return new IteratorResult(val, false);
    }
    return new IteratorResult(0, true);
  }
}
```

**`for...of` desugars to explicit `iter()`/`next()` calls — fully static, no dynamic dispatch.**

`break` works normally. Element type inferred from `IteratorResult<T>`. Built-in iterables: arrays, strings, `Map`, `Set`, `Range`.

---

## 8. `this`

Only valid inside class methods. Always statically typed. Narrows inside `switch`/`if`. Method references always auto-bound. Arrow functions capture `this` lexically.

---

## 9. Destructuring

```js
const { x, y } = new Point(1.0, 2.0);
const { x: myX } = new Point(1.0, 2.0);
const [first, ...rest] = nums;
```

Nested destructuring banned. Nullable values must be null-checked first. Defaults in destructuring must match field type.

---

## 10. Control Flow

Standard JS: `if/else`, `for`, `while`, `do...while`, `switch`, `break/continue`, `return`, `throw/try/catch/finally`.

`for...of` over arrays, strings, and `Symbol.iterator` implementors. `for...in` banned.

**Ternary:** both branches must return same type. Null branch makes result nullable.

**`throw`/`catch`:** class instances only. Uses WASM exception instructions. Multiple `catch` clauses narrow by `class_id`. Multiple throws from the same function unify to their common superclass. `finally` always runs.

```js
try {
  const n = i32.parse(input);
  riskyOp(n);
} catch (e = ParseError) {
  console.log(`parse failed: ${e.message}`);
} catch (e = IOError) {
  console.log(`io failed: ${e.message}`);
} finally {
  cleanup();
}
```

**Template literals:** `` `${}` `` accepts the following types directly:

| Type | Output |
|---|---|
| All integer subtypes | Decimal, no leading zeros, `-` for negatives |
| All float subtypes | Shortest round-trip decimal (Ryu) |
| `bool` | `"true"` or `"false"` |
| `str` | Direct — zero copy |
| `String` | Copies content |
| Any class with `Symbol.toStr` | Calls `toStr()`, result is `str` |

Class instances without `Symbol.toStr` in `${}` are a compile error (`CE-T09`). There is no silent fallback to `[object Object]`.

```js
`value: ${n}`        // ✅ integer
`pi: ${3.14}`        // ✅ float
`flag: ${active}`    // ✅ bool → "true"/"false"
`name: ${p.name}`    // ✅ str field
`obj: ${p}`          // ✅ if Player implements Symbol.toStr
`obj: ${p}`          // ❌ CE-T09: Player does not implement Symbol.toStr
```

---

## 11. Host Interop

### 11.1 Host Imports — `//@external`

Declares a function provided by the host or a linked WASM module. The dummy return statement anchors the return type — required for non-void functions. External declarations can live in any `.js` file, or in dedicated `.extern.js` files for documenting full library interfaces. Both are treated identically by the compiler:

```js
// Inline in any .js file — for one-off calls
//@external("env", "platform_log")
function platformLog(msg = "") { return 0; }

// Or in a dedicated mathlib.extern.js — for full library documentation
//@external("mathlib", "vec3_dot")
export function vec3Dot(a = ptr(0.0), b = ptr(0.0)) { return 0.0; }

//@external("mathlib", "vec3_cross")
export function vec3Cross(a = ptr(0.0), b = ptr(0.0), out = ptr(0.0)) { }
```

`.extern.js` files are optional — a convenience for organising large library bindings, not a compiler requirement. The pragma is the only signal the compiler needs.

Format: `//@external("module", "functionName")`

### 11.2 Host Exports — `//@export`

```js
//@export
function init() { }

//@export("on_tick")
function tick(dt = 0.0) { }

class Game {
  //@export("game_update")
  static update(dt = 0.0) { }   // static methods exportable directly
}
```

`export` keyword = inter-module visibility for other js.wat modules.
`//@export` = WASM host visibility. These are distinct.

### 11.3 Struct and Array Exports

**Pattern 1 — scalar field accessors:**

```js
//@export("entity_x")      function entityX(e=ptr(Entity))      { return e.val.x; }
//@export("entity_health") function entityHealth(e=ptr(Entity)) { return e.val.health; }
```

**Pattern 2 — bulk array write to host-provided buffer:**

```js
//@export("read_positions")
function readPositions(entities = ptr(Entity), n = usize(0), outX = ptr(0.0), outY = ptr(0.0)) {
  for (const i of new Range(usize(0), n)) {
    const e = ptr.fromAddr(entities.addr + i * Entity.stride, Entity);
    ptr.fromAddr(outX.addr + i * usize(8), 0.0).val = e.val.x;
    ptr.fromAddr(outY.addr + i * usize(8), 0.0).val = e.val.y;
  }
}
```

**Pattern 3 — shared memory, host reads directly:**

```js
//@export("entities_ptr")    function entitiesPtr(pool=ptr(Pool)) { return pool.val.addr; }
//@export("entities_len")    function entitiesLen(pool=ptr(Pool)) { return pool.val.size; }
//@export("entity_stride")   static Entity.stride;
```

**Pattern 4 — layout descriptor (compiler flag):**

```bash
jswat compile src/main.js --emit-layout dist/layout.json
```

```json
{
  "Entity": {
    "byteSize": 44,
    "headerSize": 12,
    "fields": {
      "x":      { "offset": 12, "type": "f64",   "wasmType": "f64"  },
      "y":      { "offset": 20, "type": "f64",   "wasmType": "f64"  },
      "id":     { "offset": 28, "type": "isize", "wasmType": "i32"  },
      "health": { "offset": 32, "type": "i32",   "wasmType": "i32"  },
      "flags":  { "offset": 36, "type": "u16",   "wasmType": "i32"  },
      "active": { "offset": 38, "type": "bool",  "wasmType": "i32"  },
      "tag":    { "offset": 39, "type": "u8",    "wasmType": "i32"  }
    }
  }
}
```

**String exports:**

```js
//@export("get_name_ptr") function getNamePtr(p=ptr(Player)) { return p.val.name; }
//@export("get_name_len") function getNameLen(p=ptr(Player)) { return p.val.name.length; }

// For heap String:
//@export("get_string_ptr") function getStringPtr(s=ptr(String)) { return s.val.dataPtr(); }
```

---

## 12. WASM Memory

### 12.1 Memory model

WASM linear memory is a flat byte array divided into regions:

```
[ data segment (str literals, static fields) | stack | heap (GC + manual) ]
```

Memory allocated in 64KB pages. Initial page count set by compiler. Grows automatically via `memory.grow`.

### 12.2 Exporting memory (default)

The compiler always exports memory as `"memory"` by default — the host can always access raw linear memory:

```wat
(memory (export "memory") N)
```

Host side:
```js
const memory = wasmInstance.exports.memory;
const view = new Int32Array(memory.buffer);
```

### 12.3 Importing memory

For multi-module setups where modules share one memory space:

```bash
jswat compile src/main.js --import-memory
# emits: (import "env" "memory" (memory N))
```

Or via `jswat.json`:
```json
{ "importMemory": true }
```

---

## 13. Linking WASM Modules

js.wat integrates `wasm-merge` from wabt to link pre-compiled WASM modules at compile time. Linked modules are merged into a single output binary — cross-module calls become internal calls, enabling inlining and dead code elimination across boundaries.

**Two ways to link a WASM module:**

| Method | When to use |
|---|---|
| `import { fn } from "./lib.wasm"` | Preferred — automatic, no manual flags |
| `--link name=path.wasm` CLI flag | Explicit control, or when linking without importing |

### 13.1 Declaring linked module functions

**Preferred — direct `.wasm` import (see §27.2):**

```js
// Compiler reads export section, infers types, adds to link list automatically
import { vec3Dot, vec3Cross } from "./mathlib.wasm";
```

**With sidecar for precise types:**

```js
// mathlib.extern.js sidecar provides refined js.wat types, validated against binary
import { vec3Dot, vec3Cross } from "./mathlib.extern.js";
// The .wasm binary is located automatically alongside the .extern.js file
```

**Legacy explicit declarations** — still valid for inline one-off calls:

```js
//@external("mathlib", "vec3_dot")
function vec3Dot(a = ptr(0.0), b = ptr(0.0)) { return 0.0; }
```

### 13.2 Linking at compile time

Direct `.wasm` imports are automatically added to the link list — no `--link` flag needed. For explicit control or for linking modules that are not imported by name:

```bash
# Explicit link flags — still supported
jswat compile src/main.js \
  --link mathlib=dist/mathlib.wasm \
  --link physics=dist/physics.wasm \
  -o dist/app.wasm
```

```json
{
  "entry": "src/main.js",
  "output": "dist/app.wasm",
  "link": {
    "mathlib": "dist/mathlib.wasm",
    "physics": "dist/physics.wasm"
  }
}
```

The compiler:
1. Compiles `src/main.js` to a temporary `.wasm`
2. Collects all `.wasm` imports from the module graph and adds them to the link set
3. Invokes `wasm-merge --merge-memory` with all linked libraries
4. Outputs the merged binary

`--merge-memory` is the default when linking — all modules share one linear memory space, making pointer passing across module boundaries safe and zero-cost.

### 13.3 Compile-time verification

At link time the compiler inspects the linked `.wasm` binary and verifies:

- **Arity:** declared parameter count matches the WASM function signature
- **Types:** declared js.wat types map to the correct WASM value types

```
error: vec3Dot declared with 2 parameters but mathlib.wasm exports vec3_dot with 3
error: vec3Dot declared return isize (i32) but mathlib.wasm exports f64
```

### 13.4 Building a js.wat library

```bash
jswat compile src/mathlib.js --lib -o dist/mathlib.wasm
```

`--lib` mode: no entry point, no WASI init, exports only `//@export` functions and memory. The output is a pure library module — importable by any WASM consumer including other js.wat programs.

### 13.5 Generating extern declarations

```bash
jswat inspect dist/mathlib.wasm --emit-extern > mathlib.extern.js
```

Reads the WASM export section and generates `.extern.js` declarations with best-effort type inference from WASM types. The programmer refines the js.wat types as needed.

### 13.6 The full linking pipeline

```
js.wat source → jswat compile → main.wasm (temporary)
                                      ↓
                                 wasm-merge --merge-memory
                                      ↑
mathlib.extern.js (optional)     mathlib.wasm
physics.extern.js (optional)     physics.wasm
                                      ↓
                                 merged.wasm
                                 — cross-module calls are internal
                                 — single shared memory
                                 — dead code eliminated across boundaries
                                 — binaryen optimises whole program
```

---

## 14. Manual Memory Management

All under the `alloc` namespace — compiler builtin, always in scope.

| Call | Returns | Purpose |
|---|---|---|
| `alloc.create(Type)` | `T?` | single manual allocation, all defaults |
| `alloc.create(Type, ...args)` | `T?` | positional args |
| `alloc.create(Type, { key: val })` | `T?` | named arg block |
| `alloc.free(obj)` | `void` | calls dispose, frees |
| `alloc.bytes(n)` | `u8?` | raw byte buffer, zeroed |
| `alloc.bytes(n, fill)` | `u8?` | raw byte buffer, filled |
| `alloc.realloc(buf, newSize)` | `u8?` | grow/shrink, old ptr invalid |
| `alloc.copy(dst, src, n)` | `void` | memory copy |
| `alloc.fill(dst, value, n)` | `void` | memory fill |
| `alloc.arena(size = usize(0))` | `Arena` | create arena — 0 = growable |
| `alloc.pool(Type, capacity = usize(0))` | `Pool<T>` | create typed pool |

`alloc.create` and `alloc.free` accept the same three construction forms as `new`. `pool.alloc` and `arena.alloc` also accept all three forms.

Manually allocated objects have sentinel `0xFFFFFFFF` at refcount offset — the compiler's rc_inc/rc_dec skip them automatically. They can be stored directly in GC class fields and arrays with no special annotation.

**Arena:** bump allocation O(1). Methods: `alloc(Type, ...)`, `bytes(n)`, `reset()`, `free()`, `used()` → `usize`, `capacity()` → `usize`.

**Pool:** free-list O(1). Methods: `alloc(...)`, `free(obj)`, `available()` → `usize`, `capacity()` → `usize`.

| Strategy | API | Returns | Free | Use case |
|---|---|---|---|---|
| GC managed | `new Player()` | `Player` | automatic | general code |
| Manual | `alloc.create()` / `alloc.free()` | `T?` | per-object | fine-grained control |
| Arena | `arena.alloc()` / `arena.free()` | `T?` | all at once | frame allocations |
| Pool | `pool.alloc()` / `pool.free()` | `T?` | return to slot | high-churn fixed-size |
| Raw bytes | `alloc.bytes()` / `alloc.realloc()` | `u8?` | `alloc.free()` | String/Map internals |

Debug builds poison freed memory. Release: UB on use-after-free.

---

---

## 15. WASI and Runtime

### 15.1 Automatic WASI-free degradation

No flag needed. If no WASI host is present, WASI imports become stubs. A `__wasi_available` global `i32` is set by a startup probe. Stdlib functions degrade gracefully:

| Module | Function | WASI-free behaviour |
|---|---|---|
| `std/io` | `stdout.write`, `console.log` | silent no-op |
| `std/io` | `stderr.write` | silent no-op |
| `std/io` | `stdin.read` | returns `null` |
| `std/fs` | `FS.read` | returns `null` |
| `std/fs` | `FS.write`, `FS.append` | returns `false` |
| `std/fs` | `FS.exists`, `FS.delete`, `FS.mkdir` | returns `false` |
| `std/clock` | `Clock.now`, `Clock.monotonic` | returns `0` |
| `std/clock` | `Clock.sleep` | no-op |
| `std/random` | `Random.float`, `Math.random` | internal RNG if seeded, else `0.0` |
| `std/random` | `Random.int` | internal RNG if seeded, else `0` |
| `std/process` | `Process.exit` | WASM `unreachable` trap |
| `std/process` | `Process.args` | returns `[]` |
| `std/process` | `Process.env` | returns `null` |

### 15.2 Platform constants

```js
const POINTER_SIZE = usize(4);   // WASM32 — always compile-time const
```

---

## 16. Memory Model

### 16.1 Stack vs Heap

| Type | Location |
|---|---|
| All numeric types, `bool`, `str` | Stack / data segment |
| `String`, class instances, arrays, `Ptr` | Heap — reference counted |

### 16.2 Reference Counting and Sentinel

Every heap object begins with a 12-byte header (see §3.9 and §25.2):

```
Offset 0  rc_class    [ bits[31:28]=size-class | bits[27:0]=refcount ]
Offset 4  vtable_ptr  [ pointer to vtable, or 0 ]
Offset 8  class_id    [ unique u32 per class ]
```

The `rc_class` word drives GC behaviour:

```
rc_class = 0xFFFFFFFF   → manual sentinel — rc_inc/rc_dec skip entirely
rc_class bits[27:0] = 0 → refcount hit zero → call dispose, then free
rc_class bits[27:0] > 0 → object alive
```

The compiler emits `__jswat_rc_inc` and `__jswat_rc_dec` at every reference assignment. Both check the sentinel and skip if set — no annotation or pragma needed. Manually allocated objects can be stored directly in GC class fields and arrays.

`Symbol.dispose` is called when an object's refcount hits zero, then the block is returned to the allocator.

### 16.3 Class Index in Refcount Header

The top 4 bits of the refcount word encode the size-class index used for allocation. This lets `__jswat_free` determine which free-list to return the block to without a separate lookup table:

```
bits [31:28]  size class index (0–9 for small blocks, 10 = large)
bits [27:0]   refcount value (0xFFFFFFF max live refcount)
```

---

## 17. Runtime Architecture

### 17.1 Three-Layer Model

```
Layer 0  WASM primitives   memory.grow, memory.size, memory.copy, memory.fill
Layer 1  Allocator (WAT)   size-classed free list, bump allocator, Arena, Pool
Layer 2  GC (WAT)          sentinel-aware rc_inc/rc_dec, dispose dispatch
         ─────────────────────────────────────────────────────────────────
Layer 3  std (js.wat)      stdlib modules written on top of Layers 1–2
```

Layers 0–2 are compiled from `runtime.wat` (shipped with the compiler, ~740 lines). The output `runtime.wasm` is merged with user code via `wasm-merge`. binaryen inlines hot paths after merge.

### 17.2 Allocator Design

**Size classes:** 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096 bytes, plus a "large" class for objects above 4096 bytes.

**Free list:** 11 heads stored in a flat table starting at `heap_base`. Each free block reuses its refcount header slot as the next-pointer — safe because freed blocks have `rc = 0` and no live code reads them.

**Large allocations:** doubly-linked list with a 12-byte header `[next:4 | prev:4 | size:4]` prepended to the block. Bit 31 of the stored size distinguishes large blocks from small ones.

**Bump allocator:** new blocks are bump-allocated from the current `$bump` pointer, growing memory with `memory.grow` on demand. OOM traps immediately via `unreachable`.

### 17.3 Arena and Pool

**Arena:** A bump allocator over a private buffer. All Arena-allocated objects have the manual sentinel — they are never individually GC-freed. `arena.reset()` resets the bump pointer. `arena.free()` releases the entire buffer. Growable arenas (size=0) double their buffer on overflow; fixed arenas trap.

**Pool:** A free-list over a fixed-stride buffer. Free slots chain through their vtable slot (offset +4). All pool-allocated objects have the manual sentinel. `pool.free(obj)` pushes the slot back onto the free list.

### 17.4 Compile and Link Sequence

```
1. jswat compiler   →  user.wasm
                        (calls __jswat_alloc, __jswat_free,
                               __jswat_rc_inc, __jswat_rc_dec,
                               __jswat_arena_*, __jswat_pool_*)

2. runtime.wat      →  runtime.wasm  (compiled once, shipped with compiler)

3. wasm-merge user.wasm runtime.wasm → merged.wasm
   (cross-module calls become internal — enables inlining)

4. binaryen wasm-opt merged.wasm → final.wasm
   (whole-program optimisation — rc_inc/rc_dec hot paths inlined)
```

### 17.5 `_start` Sequence

The compiler emits `_start` (called by WASI runtimes) or `__wasm_call_ctors`:

```wat
(func $_start
  call $__jswat_init          ;; set up heap, free-list table
  call $__wasi_probe          ;; set __wasi_available
  call $__random_init         ;; seed global RNG from WASI or 0
  call $__static_init         ;; initialize static class fields
  call $user_main             ;; user's top-level code
)
```

### 17.6 Vtable and Dispose Dispatch

Every class that implements any `@symbol` method gets a compiler-generated vtable. The vtable pointer is stored at `ptr+4` (the second 4-byte slot of every object). For classes with no symbol methods, this slot is `0`.

The vtable layout:
```
[ dispose_fn_idx: i32 | compare_fn_idx: i32 | hash_fn_idx: i32 | ... ]
```

`__jswat_dispose` reads `ptr+4` for the vtable, then reads vtable slot 0 for the dispose function index, then calls it via `call_indirect`. Index 0 = no dispose.

---

## 18. Standard Library

### 18.1 Module Map

```
std/
├── core          — compiler builtins (always linked, zero imports)
├── wasm          — WASM instruction intrinsics
├── mem           — ptr, alloc, Arena, Pool
├── math          — Math (default export)
├── string        — String (default export)
├── random        — Random (default export)
├── range         — Range, StepRange
├── iter          — iter() combinator chain
├── collections   — Map, Set, Stack, Queue, Deque
├── error         — AppError, ValueError, RangeError, IOError, ParseError, NotFoundError
├── io            — console, stdout, stderr, stdin
├── fs            — FS
├── clock         — Clock
├── process       — Process
├── encoding      — Base64, UTF8
└── prelude       — convenience bundle
```

### 18.2 WASI Independence

| Module | WASI required? |
|---|---|
| `std/core`, `std/wasm`, `std/mem` | Never |
| `std/math`, `std/string`, `std/encoding` | Never |
| `std/collections`, `std/error`, `std/range`, `std/iter` | Never |
| `std/random` | Only for entropy seeding — degrades to seed=0 |
| `std/io`, `std/fs`, `std/clock`, `std/process` | Degrade gracefully |

### 18.3 Dependency Graph

```
std/wasm  (no imports — instruction mappings only)
   │
   ├──▶  std/math   (uses reinterpret + float intrinsics)
   └──▶  std/mem    (uses raw load/store intrinsics)
              │
              ├──▶  std/string
              ├──▶  std/collections   (Map, Set need Array.filled)
              └──▶  std/encoding
std/core   (always linked — compiler builtins)
   │
   ├──▶  std/range
   ├──▶  std/iter
   ├──▶  std/error
   └──▶  std/random
WASI externs ──▶  std/io, std/fs, std/clock, std/process, std/random (seeding)
```

### 18.4 `std/wasm` — WASM Instruction Intrinsics

Single WASM instruction per function. The compiler inlines the instruction directly — zero call overhead.

**Tier 1 — pure value ops, safe for all code:**

```js
import { i32_clz, i32_ctz, i32_popcnt, i32_rotl, i32_rotr,
         i64_clz, i64_ctz, i64_popcnt, i64_rotl, i64_rotr,
         f32_sqrt, f32_floor, f32_ceil, f32_trunc, f32_nearest,
         f32_abs, f32_neg, f32_min, f32_max, f32_copysign,
         f64_sqrt, f64_floor, f64_ceil, f64_trunc, f64_nearest,
         f64_abs, f64_neg, f64_min, f64_max, f64_copysign,
         i32_reinterpret_f32, f32_reinterpret_i32,
         i64_reinterpret_f64, f64_reinterpret_i64 } from "std/wasm";
```

**Tier 2 — raw memory ops, bypass type system:**

```js
import { i32_load, i32_store, i32_load8_s, i32_load8_u, i32_store8,
         i32_load16_s, i32_load16_u, i32_store16,
         i64_load, i64_store, f32_load, f32_store, f64_load, f64_store,
         memory_size, memory_grow, memory_copy, memory_fill } from "std/wasm";
```

Tier 2 is available to any file without annotation. The compiler does not restrict it. Use Tier 2 only in allocator internals and low-level string/encoding code where you have full awareness of memory layout.

### 18.5 `std/mem` — Manual Memory

```js
import { ptr, alloc } from "std/mem";
```

See §14 for full API. `std/mem` is the only module that uses Tier 2 `std/wasm` intrinsics in normal stdlib code.

### 18.6 `std/math` — Math (default export)

```js
import Math from "std/math";
```

All functions are pure js.wat — no host imports required. Transcendentals use minimax polynomial approximations with bit manipulation via `Math.reinterpret*`.

**Constants:**
```js
Math.PI  Math.E  Math.LN2  Math.LN10  Math.LOG2E  Math.LOG10E  Math.SQRT2  Math.SQRT1_2
```

**Reinterpret (single WASM instruction each):**
```js
Math.reinterpretAsI64(x = 0.0)       // f64 → i64
Math.reinterpretAsF64(x = i64(0))    // i64 → f64
Math.reinterpretAsI32(x = f32(0.0))  // f32 → i32
Math.reinterpretAsF32(x = i32(0))    // i32 → f32
```

**Float (monomorphizes for f32/f64):**
`sqrt` `floor` `ceil` `round` `trunc` `fround`

**Arithmetic (all numeric types):**
`abs` `min` `max` `sign` `clamp`

**Transcendental (f64):**
`exp` `expm1` `log` `log1p` `log2` `log10` `pow` `sqrt` `cbrt` `hypot`

**Trig (f64):**
`sin` `cos` `tan` `asin` `acos` `atan` `atan2`
`sinh` `cosh` `tanh` `asinh` `acosh` `atanh`

**Integer-specific:**
`clz32` `imul` `popcnt`

**Extras:**
```js
Math.lerp(a=Float, b=Float, t=Float)
Math.smoothstep(e0=Float, e1=Float, x=Float)
Math.map(val=Float, inMin=Float, inMax=Float, outMin=Float, outMax=Float)
Math.degToRad(deg=Float)
Math.radToDeg(rad=Float)
Math.random()    // f64 — alias to global Random instance
```

### 18.7 `std/string` — String (default export)

```js
import String from "std/string";
```

**Layout:** `[ rc_class:4 | vtable_ptr:4 | class_id:4 | length:4 | capacity:4 | hash:4 | *buf:4 ]` — 28-byte header.

**Methods:**
`append` `set` `at` `slice` `indexOf` `includes` `startsWith` `endsWith`
`toUpperCase` `toLowerCase` `trim` `trimStart` `trimEnd`
`replace` `padStart` `padEnd` `repeat` `split`
`asStr` (zero-copy str view) `dataPtr` (raw buffer address for host interop)

**Symbols:** `Symbol.hash` (FNV-1a, cached), `Symbol.equals`, `Symbol.toStr` (returns `asStr()`), `Symbol.dispose` (frees buffer)

`String` implements `Symbol.toStr` — it is always interpolatable in template literals.

**Static:**
```js
String.fromCodePoint(cp = u32(0))   // single codepoint → String
```

`String.from` and `String.fromBool` are removed. Use template literals instead:
```js
`${n}`       // any Number → String
`${b}`       // bool → "true" / "false"
`${p}`       // class with Symbol.toStr → String
```

### 18.8 `std/random` — Random (default export)

xoshiro256** PRNG. WASI-seeded at startup if available.

```js
import Random from "std/random";

const rng = new Random(42);    // seeded — deterministic
rng.float()                    // f64 0.0–1.0
rng.int()                      // isize
rng.range(min=0, max=0)        // isize — inclusive
rng.bool()                     // bool
rng.seed(s=0)

Random.float()                 // global instance
Random.seed(s=0)
Math.random()                  // alias to Random.float()
```

### 18.9 `std/range` — Range, StepRange

```js
import { Range, StepRange } from "std/range";

for (const i of new Range(usize(0), usize(10))) { }     // 0..9
for (const i of new StepRange(isize(0), isize(10), isize(2))) { }  // 0,2,4,6,8
```

`Range.size` → `usize`. `Range.includes(n)` → `bool`.

### 18.10 `std/iter` — Iterator Combinators

```js
import { iter } from "std/iter";
import { Range } from "std/range";

const sum = iter(new Range(usize(0), usize(100)))
  .filter(n => n % 2 == 0)
  .map(n => n * n)
  .sum();

const first5 = iter(myArray).take(usize(5)).collect();
```

Combinators: `map` `filter` `take` `skip` — all lazy.
Terminators: `collect` `forEach` `reduce` `count` `find` `any` `all` `sum` `min` `max`

### 18.11 `std/collections` — Map, Set, Stack, Queue, Deque

```js
import { Map, Set, Stack, Queue, Deque } from "std/collections";
```

**Map<K, V>** — open-addressing Robin Hood hash table. K must implement `Symbol.hash` and `Symbol.equals`:
```js
const m = new Map(Symbol.hash, isize(0));
m.set(key, 42);
m.get(key);    // isize?
m.has(key);    // bool
m.delete(key); // bool
m.size;        // usize
for (const entry of m) { entry.key; entry.val; }
```

**Set<T>** — wraps Map<T, bool>:
```js
const s = new Set(Symbol.hash);
s.add(key); s.has(key); s.delete(key); s.size;
```

**Stack<T>:** `push` `pop` `peek` `size` `empty`

**Queue<T>:** `enqueue` `dequeue` `peek` `size` `empty`

**Deque<T>:** `pushFront` `pushBack` `popFront` `popBack` `peekFront` `peekBack` `size` `empty`

### 18.12 `std/error` — Error Hierarchy

```js
import { AppError, ValueError, RangeError, IOError,
         ParseError, NotFoundError } from "std/error";
```

All extend `AppError` with `message: str`. All implement `Symbol.toStr`.

### 18.13 `std/io` — console, stdout, stderr, stdin

```js
import { console, stdout, stderr, stdin } from "std/io";

console.log("hello");          // to stdout with newline
console.error("oops");         // to stderr with newline
stdout.write("no newline");
stdout.writeln("with newline");
stdout.writeString(myString);  // accepts heap String

const input = stdin.read(usize(1024));    // String? — null if WASI unavailable
const line  = stdin.readLine();           // String?
```

### 18.14 `std/fs` — Filesystem

```js
import { FS } from "std/fs";

const content = FS.read("data.txt");    // String? — null if unavailable
FS.write("out.txt", "hello");           // bool
FS.append("log.txt", "line\n");         // bool
FS.delete("tmp.txt");                   // bool
FS.mkdir("build/");                     // bool
FS.exists("config.json");              // bool
```

### 18.15 `std/clock` — Clock

```js
import { Clock } from "std/clock";

Clock.now();          // i64 — nanoseconds since Unix epoch (0 if WASI-free)
Clock.monotonic();    // i64 — nanoseconds, arbitrary epoch
Clock.nowMs();        // f64 — milliseconds (for JS interop)
Clock.sleep(ns=i64(0));    // spin-wait (WASI has no blocking sleep)
Clock.sleepMs(ms=0);
```

### 18.16 `std/process` — Process

```js
import { Process } from "std/process";

Process.exit(i32(0));        // exits or traps
Process.args();              // String[] — command line args ([] if WASI-free)
Process.env("HOME");         // String? — env var value (null if not found/WASI-free)
```

### 18.17 `std/encoding` — Base64, UTF8

```js
import { Base64, UTF8 } from "std/encoding";

const encoded = Base64.encode(buf, len);    // String
const outLen  = ptr(usize(0));
const decoded = Base64.decode(s, outLen);   // u8? — outLen.val set to byte count

UTF8.validate(s);        // bool
UTF8.charCount(s);       // usize — Unicode codepoints
```

### 18.18 `std/prelude` — Implicit (see §28)

The prelude is not imported — its members are always in scope. See §28 for the full list. Explicitly importing anything from the prelude produces a compiler warning.

---

### 18.15 `Array.filled` — Initialised Arrays

The builtin `Array.filled` creates a typed array of a given size with all elements set to a provided value. Required for `Map` and `Set` internals:

```js
Array.filled(n = usize(0), elem = 0)   // returns T[] of length n, all set to elem
```

The `elem` argument anchors the element type — the same way array literals do:

```js
const zeros = Array.filled(usize(100), i32(0));   // i32[100] all zeros
const nulls = Array.filled(usize(16), MyClass);   // MyClass?[16] all null
const flags = Array.filled(usize(8), false);      // bool[8] all false
```

This is a compiler builtin — it lowers to `__jswat_alloc` + `memory.fill` for primitive types, or a loop for reference types where each slot must hold a typed null.

---

## 19. Compiler Intrinsics Reference

The compiler provides the following `__`-prefixed intrinsics used by stdlib implementations. These are not user-visible — they are injected by the compiler at call sites in stdlib source:

| Intrinsic | Signature | Purpose |
|---|---|---|
| `__str_from_ptr` | `(buf: u8?, len: usize) → str` | Synthesize str slice from raw buffer |
| `__char_at` | `(buf: u8?, i: usize) → str` | Single-character str from buffer offset |
| `__char_from_codepoint` | `(cp: u32) → str` | UTF-8 encode one codepoint to str |
| `__mem_eq` | `(a: u8?, ai: usize, b: ?, bi: usize, n: usize) → bool` | Byte comparison |
| `__is_whitespace` | `(buf: u8?, i: usize) → bool` | ASCII whitespace check |
| `__str_case` | `(s: String, upper: bool) → String` | Case conversion |
| `__u8_offset` | `(buf: u8?, offset: usize) → u8?` | Pointer arithmetic on u8? |
| `__fmt_number` | `(n: Number) → str` | Number to str (monomorphized) — used by template literals |
| `__reinterpret_f64` | `(bits: i64) → f64` | f64.reinterpret_i64 |
| `__wasi_available` | `i32` global | 1 if WASI probe succeeded |
| `__stack_alloc` | `(n: usize) → usize` | Short-lived stack-frame allocation |
| `__stack_store_u32` | `(base: usize, off: usize, v: u32)` | Write u32 to stack frame |
| `__stack_load_u32` | `(base: usize, off: usize) → u32` | Read u32 from stack frame |
| `__stack_load_i64` | `(base: usize, off: usize) → i64` | Read i64 from stack frame |
| `__cstr_to_str` | `(ptr: usize) → str` | Null-terminated C string to str |
| `__u32_load` | `(addr: usize) → u32` | Bare u32 load (for WASI arg parsing) |
| `unreachable` | statement | Emits WASM `unreachable` instruction |

---

## 20. What Is Banned

| Feature | Reason |
|---|---|
| `eval(...)`, `new Function(...)` | Dynamic code injection |
| `with` statement | Dynamic scope |
| `arguments` object | Use rest parameters |
| `for...in` | Dynamic key iteration |
| Bracket access on objects | Use dot notation |
| `delete obj.prop` | Breaks class sealing |
| Object literals `{}` outside `new` | Use named construction blocks |
| `Object.assign`, `Object.defineProperty` | Shape mutation |
| Dynamic `import()` | Static imports only — full graph resolved at compile time |
| Side-effect imports `import "x"` | Prelude is implicit; no other side-effect imports |
| Bare import specifiers `import x from "pkg"` | No package registry — use `"./path"` or `"std/*"` |
| `Proxy`, `Reflect` | Runtime interception |
| `Symbol` as dynamic key outside trait system | Dynamic property keys |
| `typeof` as branch condition | Use `instanceof` |
| Type annotations | No annotation syntax — types inferred from defaults |
| `JSON.parse` | Returns untyped object |
| `this` outside class methods | No global this |
| Nullable numeric types, `bool`, `str` | These are never nullable |
| Parameters without defaults | All parameters require defaults |
| Throwing non-class values | Class instances only |
| Conditional constructor field assignment | All fields unconditionally assigned |
| Nested destructuring | Use two explicit steps |
| Setter without getter | Use a regular method |
| `?.` on non-nullable | Use `.` instead |
| Generators, `async`/`await` | Not supported |
| Comma operator, labeled `break`/`continue` | Banned |
| `||=`/`&&=` on non-nullable types | Reference types only |
| Switch fallthrough | Cases are sealed |
| Implicit numeric coercion | Explicit casts required |
| `bool` in numeric expressions | Use ternary |
| Instantiating `Number`, `Integer`, `Float` | Abstract — constraints only |
| Class interpolation without `Symbol.toStr` | Implement `Symbol.toStr` returning `str` |

---

## 21. Why js.wat Is Easy to JIT

| Property | Mechanism |
|---|---|
| Fixed object shapes | Sealed classes — field access is a constant offset |
| Compact memory layout | Default field reordering minimises padding |
| Purely nominal types | Every object has exactly one class |
| Monomorphic call sites | Every call site resolves to one specialization |
| No deopt triggers | No hidden class changes, no `arguments` |
| Static call graph | No `eval`, no `[]` dispatch on objects |
| No GC pauses | Refcounting + static cycle detection |
| Static string data | `str` in data segment — zero allocation |
| Typed array elements | Primitives inline; instances as pointers |
| Predictable arithmetic | Wrapping integers — no overflow checks in release |
| O(1) string length | Both `str` and `String` store length inline |
| Always-bound `this` | No runtime binding confusion |
| Full numeric hierarchy | Every operation has a statically known width |
| Fully anchored signatures | Every parameter has a default |
| UB null fast path | `.` emits zero null checks in release |
| Manual memory escape hatch | `alloc` bypasses GC entirely |
| Compile-time constants | `const` inlined — zero runtime cost |
| Symbol traits at compile time | No runtime dispatch overhead |
| Type propagation | Eliminates redundant casts in hot paths |
| Whole-program linking | `wasm-merge` enables cross-module inlining |
| O(1) type dispatch | `class_id` at fixed offset 8 — one load + compare |
| Aggressive tree-shaking | Five-level DCE — zero bytes for unused stdlib |
| WASM exception instructions | Zero-cost exceptions when no throw occurs |

---

## 22. Sample Programs

### 22.1 Hello World

```js
console.log("Hello from js.wat!");
```

---

### 22.2 FizzBuzz

```js
for (const i of new Range(1, 101)) {
  const fizz = i % 3 === 0;
  const buzz = i % 5 === 0;
  if (fizz && buzz) console.log("FizzBuzz");
  else if (fizz)    console.log("Fizz");
  else if (buzz)    console.log("Buzz");
  else              console.log(`${i}`);
}
```

---

### 22.3 Fibonacci (iterator)

```js
class FibIterator {
  a; b;
  constructor(a = 0, b = 1) { this.a = a; this.b = b; }

  //@symbol(Symbol.iterator)
  iter() { return this; }

  //@symbol(Symbol.next)
  next() {
    const val = this.a;
    const next = this.a + this.b;
    this.a = this.b;
    this.b = next;
    return new IteratorResult(val, false);
  }
}

let count = 0;
for (const n of new FibIterator) {
  console.log(`${n}`);
  if (++count >= 10) break;
}
// 0 1 1 2 3 5 8 13 21 34
```

---

### 22.4 Generic Stack

```js
class Stack {
  #items;
  #size;

  constructor(items = [0]) {
    this.#items = items;
    this.#size = usize(0);
  }

  push(item = 0) { this.#items.push(item); this.#size++; }

  pop() {
    if (this.#size === usize(0)) return null;
    this.#size--;
    return this.#items.pop();
  }

  peek() {
    if (this.#size === usize(0)) return null;
    return this.#items[this.#size - usize(1)];
  }

  get size()  { return this.#size; }
  get empty() { return this.#size === usize(0); }
}

const nums = new Stack([0]);
nums.push(1); nums.push(2); nums.push(3);
nums.pop();   // 3

const floats = new Stack([0.0]);
floats.push(3.14); floats.push(2.71);
```

---

### 22.5 Result Pattern

```js
class Result { }
class Ok extends Result {
  value;
  constructor(value = 0) { super(); this.value = value; }
}
class Err extends Result {
  message;
  constructor(message = "") { super(); this.message = message; }
}

function divide(a = 0, b = 0) {
  if (b === 0) return new Err("division by zero");
  return new Ok(a / b);
}

function printResult(r = Result) {
  switch (r) {
    case Ok:  console.log(`Result: ${r.value}`);
    case Err: console.log(`Error: ${r.message}`);
  }
}

printResult(divide(10, 2));   // Result: 5
printResult(divide(10, 0));   // Error: division by zero
```

---

### 22.6 Pixel Buffer (manual memory)

```js
import { ptr, alloc } from "std/mem";

class Pixel {
  r; g; b; a;
  constructor(r = u8(0), g = u8(0), b = u8(0), a = u8(255)) {
    this.r = r; this.g = g; this.b = b; this.a = a;
  }
}

class Canvas {
  #pool;
  #width;
  #height;

  constructor(width = usize(0), height = usize(0)) {
    this.#width = width;
    this.#height = height;
    this.#pool = alloc.pool(Pixel, width * height);
  }

  set(x = usize(0), y = usize(0), r = u8(0), g = u8(0), b = u8(0)) {
    const px = ptr.fromAddr(
      this.#pool.alloc(u8(0), u8(0), u8(0), u8(255)).addr
      + (y * this.#width + x) * Pixel.stride,
      Pixel
    );
    px.val.r = r; px.val.g = g; px.val.b = b;
  }

  fill(r = u8(0), g = u8(0), b = u8(0)) {
    for (const _ of new Range(usize(0), this.#width * this.#height)) {
      this.#pool.alloc(r, g, b, u8(255));
    }
  }
}

const canvas = new Canvas(usize(800), usize(600));
canvas.fill(u8(0), u8(0), u8(0));
canvas.set(usize(100), usize(100), u8(255), u8(0), u8(0));
```

---

### 22.7 WASM Computation Module (WASI-free)

```js
import { ptr, alloc } from "std/mem";

//@export("seed")
function seed(s = 0) { Random.seed(s); }

//@export("dot_product")
function dotProduct(a = ptr(0.0), b = ptr(0.0), n = usize(0)) {
  let sum = 0.0;
  for (const i of new Range(usize(0), n)) {
    const av = ptr.fromAddr(a.addr + i * usize(8), 0.0);
    const bv = ptr.fromAddr(b.addr + i * usize(8), 0.0);
    sum += av.val * bv.val;
  }
  return sum;
}

//@export("matrix_fill_random")
function matrixFillRandom(mat = ptr(0.0), rows = usize(0), cols = usize(0)) {
  for (const i of new Range(usize(0), rows * cols)) {
    ptr.fromAddr(mat.addr + i * usize(8), 0.0).val = Random.float();
  }
}
```

---

### 22.8 Linking a WASM Math Library

```js
// mathlib.extern.js — optional sidecar with precise js.wat types
//@external("mathlib", "vec3_dot")
export function vec3Dot(a = ptr(0.0), b = ptr(0.0)) { return 0.0; }

//@external("mathlib", "vec3_cross")
export function vec3Cross(a = ptr(0.0), b = ptr(0.0), out = ptr(0.0)) { }
```

```js
// main.js — Option A: import directly from .wasm (conservative type inference)
import { vec3Dot, vec3Cross } from "./mathlib.wasm";

// main.js — Option B: import from sidecar (precise js.wat types, validated against binary)
import { vec3Dot, vec3Cross } from "./mathlib.extern.js";
```

```js
// Either way, usage is identical — no --link flag needed, compiler handles it
import { ptr, alloc } from "std/mem";

class Vec3 {
  x; y; z;
  constructor(x = 0.0, y = 0.0, z = 0.0) { this.x = x; this.y = y; this.z = z; }
}

const a = alloc.create(Vec3, 1.0, 0.0, 0.0);
const b = alloc.create(Vec3, 0.0, 1.0, 0.0);
const dot = vec3Dot(a, b);   // f64 — calls into linked mathlib.wasm
```

---

### 22.9 Game Loop

```js
class Vec2 {
  x; y;
  constructor(x = 0.0, y = 0.0) { this.x = x; this.y = y; }
  length() { return Math.sqrt(this.x ** 2 + this.y ** 2); }
}

class Player {
  #pos; #vel; #health;
  name;

  constructor(name = "", x = 0.0, y = 0.0) {
    this.name = name;
    this.#pos = new Vec2(x, y);
    this.#vel = new Vec2;
    this.#health = 100;
  }

  get pos()    { return this.#pos; }
  get health() { return this.#health; }
  get alive()  { return this.#health > 0; }

  move(dx = 0.0, dy = 0.0) { this.#vel.x = dx; this.#vel.y = dy; }

  update(dt = 0.0) {
    this.#pos.x += this.#vel.x * dt;
    this.#pos.y += this.#vel.y * dt;
  }

  damage(amount = 0) {
    this.#health = Math.max(0, this.#health - amount);
  }
}

class Game {
  static #instance;
  static #running = false;

  static init() {
    Game.#instance = new Player("Hero");
    Game.#running = true;
  }

  static update(dt = 0.0)         { if (Game.#running) Game.#instance.update(dt); }
  static move(dx = 0.0, dy = 0.0) { Game.#instance.move(dx, dy); }

  static damage(amount = 0) {
    Game.#instance.damage(amount);
    if (!Game.#instance.alive) {
      Game.#running = false;
      console.log("Game over");
    }
  }

  static get running() { return Game.#running; }
}

//@export("game_init")    function init()                  { Game.init(); }
//@export("game_update")  function update(dt = 0.0)        { Game.update(dt); }
//@export("game_move")    function move(dx=0.0, dy=0.0)    { Game.move(dx, dy); }
//@export("game_damage")  function damage(amount = 0)      { Game.damage(amount); }
//@export("game_running") function running()               { return Game.running ? 1 : 0; }
```

---

### 22.10 Parsing and Error Handling

```js
import { FS } from "std/fs";

// Symbol.toStr on a custom error type
class ConfigError extends AppError {
  field;
  constructor(message = "", field = "") {
    super(message);
    this.field = field;
  }

  //@symbol(Symbol.toStr)
  toStr() { return `ConfigError(${this.field}): ${this.message}`; }
}

// Parse a key=value config line — throws on malformed input
function parseLine(line = "") {
  const eq = line.indexOf("=");
  if (eq < 0) throw new ConfigError("missing '='", line);

  const key   = line.slice(usize(0), usize(eq)).trim();
  const value = line.slice(usize(eq) + usize(1), line.length).trim();

  if (key.length == usize(0)) throw new ConfigError("empty key", line);
  return new KeyValue(key.asStr(), value.asStr());
}

class KeyValue {
  key; value;
  constructor(key = "", value = "") { this.key = key; this.value = value; }
}

// Read and parse a config file
function loadConfig(path = "") {
  const content = FS.read(path);
  if (content == null) throw new IOError(`cannot read: ${path}`);

  const lines = content.split("\n");
  const result = new Map(Symbol.hash, new String(""));

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length == usize(0)) continue;          // skip blank lines
    if (trimmed.startsWith("#"))    continue;          // skip comments

    try {
      const kv = parseLine(trimmed);
      result.set(kv.key, kv.value);
    } catch (e = ConfigError) {
      console.log(`warning: skipping line — ${e}`);   // ${e} calls Symbol.toStr
    }
  }

  return result;
}

// Read a numeric value from config — throws ParseError if not a valid integer
function getInt(config = Map, key = "", default_ = 0) {
  const val = config.get(new String(key));
  if (val == null) return default_;
  return i32.parse(val.asStr());
}

try {
  const config  = loadConfig("app.config");
  const port    = getInt(config, "port", 8080);
  const workers = getInt(config, "workers", 4);
  console.log(`Starting on port ${port} with ${workers} workers`);
} catch (e = IOError) {
  console.log(`fatal: ${e}`);
} catch (e = ParseError) {
  console.log(`bad config value: ${e}`);
}
```

---

### 22.11 WASM Direct Import

```js
// Import directly from a pre-compiled .wasm binary — no extern.js needed
import { encrypt, decrypt, keyExpand } from "./crypto.wasm";

// Types inferred conservatively from binary (i32→isize, f64→f64)
// For precise types, place a crypto.extern.js sidecar alongside crypto.wasm

class Message {
  #data;   // u8?
  #len;    // usize

  constructor(text = "") {
    this.#len  = text.length;
    this.#data = alloc.bytes(this.#len);
    alloc.copy(this.#data, text, this.#len);
  }

  //@symbol(Symbol.dispose)
  dispose() { alloc.free(this.#data); }

  //@symbol(Symbol.toStr)
  toStr() { return __str_from_ptr(this.#data, this.#len); }

  get ptr()    { return usize(this.#data); }
  get length() { return this.#len; }
}

function roundTrip(plaintext = "", key = "") {
  import { ptr, alloc } from "std/mem";

  const msg     = new Message(plaintext);
  const keyMsg  = new Message(key);
  const keyCtx  = alloc.bytes(usize(240));   // AES-256 key schedule

  keyExpand(keyMsg.ptr, usize(key.length), usize(keyCtx));

  const cipherBuf = alloc.bytes(msg.length);
  encrypt(msg.ptr, msg.length, usize(keyCtx), usize(cipherBuf));

  const plainBuf = alloc.bytes(msg.length);
  decrypt(usize(cipherBuf), msg.length, usize(keyCtx), usize(plainBuf));

  const result = new String(__str_from_ptr(plainBuf, msg.length));

  alloc.free(keyCtx);
  alloc.free(cipherBuf);
  alloc.free(plainBuf);

  return result;
}
```

---

## 23. `runtime.wat` — Full Runtime Source

The runtime is compiled separately from a fixed WAT file and merged with user code at link time. It implements Layers 1 and 2 (allocator + GC). Layer 0 is WASM primitives used directly.

```wat
;; ============================================================
;; js.wat runtime — runtime.wat
;; Version 1.3
;;
;; Compiled separately into runtime.wasm and merged with user
;; code via wasm-merge. Binaryen inlines hot paths after merge.
;;
;; Layers:
;;   Layer 0  WASM primitives  (memory.grow, memory.copy, etc.)
;;   Layer 1  Allocator        (size-classed free list, bump)
;;   Layer 2  GC               (refcount, dispose dispatch, cycles)
;;
;; Exported functions (prefixed __jswat_):
;;   __jswat_alloc      (size i32) -> i32
;;   __jswat_free       (ptr  i32)
;;   __jswat_realloc    (ptr i32, size i32) -> i32
;;   __jswat_rc_inc     (ptr  i32)
;;   __jswat_rc_dec     (ptr  i32)
;;   __jswat_arena_new  (size i32) -> i32          ;; 0 = growable
;;   __jswat_arena_alloc(arena i32, size i32) -> i32
;;   __jswat_arena_reset(arena i32)
;;   __jswat_arena_free (arena i32)
;;   __jswat_pool_new   (stride i32, cap i32) -> i32
;;   __jswat_pool_alloc (pool   i32) -> i32
;;   __jswat_pool_free  (pool i32, ptr i32)
;;   __jswat_dispose    (ptr  i32)               ;; call Symbol.dispose then free
;;   __jswat_init                                 ;; called by _start
;;
;; Memory layout (WASM32):
;;   [0..heap_base)   data segment (str literals, vtable, static fields)
;;   heap_base..      heap — managed by allocator below
;;
;; The compiler emits a global $heap_base holding the first
;; heap-usable byte, filled in at link time.
;; ============================================================

(module

  ;; -------------------------------------------------------
  ;; Exported memory — always "memory", host can view raw
  ;; -------------------------------------------------------
  (memory (export "memory") 4)    ;; 4 pages = 256 KB initial

  ;; -------------------------------------------------------
  ;; Globals
  ;; -------------------------------------------------------

  ;; First byte of usable heap — set by compiler at link time
  (global $heap_base (mut i32) (i32.const 65536))

  ;; Next free byte in the bump region (used for large allocs / bootstrap)
  (global $bump      (mut i32) (i32.const 0))

  ;; -------------------------------------------------------
  ;; Size classes and free lists
  ;;
  ;; Classes: 8 16 32 64 128 256 512 1024 2048 4096 LARGE
  ;; Free-list heads stored in a table starting at $fl_base.
  ;; Each head is a 4-byte i32 pointer (next free block).
  ;; A free block reuses its first 4 bytes as the next pointer
  ;; (the sentinel slot — refcount header — is safe to reuse
  ;; because freed objects have rc=-1 and no live code reads them).
  ;;
  ;; fl_base layout: [head_8 | head_16 | ... | head_4096 | large_list_head]
  ;; 11 slots * 4 bytes = 44 bytes reserved at heap_base.
  ;; -------------------------------------------------------

  (global $fl_base   (mut i32) (i32.const 0))   ;; set in __jswat_init

  ;; Large allocation list: doubly-linked list of headers.
  ;; Large header: [next:4 | prev:4 | size:4 | sentinel:4 | data...]
  ;; sentinel = 0xFFFFFFFF for manual, rc for GC

  ;; -------------------------------------------------------
  ;; Helper: size class index (0..9) from requested size.
  ;; Returns 10 for "large" (> 4096).
  ;; -------------------------------------------------------
  (func $size_class (param $n i32) (result i32)
    (if (i32.le_u (local.get $n) (i32.const 8))
      (then (return (i32.const 0))))
    (if (i32.le_u (local.get $n) (i32.const 16))
      (then (return (i32.const 1))))
    (if (i32.le_u (local.get $n) (i32.const 32))
      (then (return (i32.const 2))))
    (if (i32.le_u (local.get $n) (i32.const 64))
      (then (return (i32.const 3))))
    (if (i32.le_u (local.get $n) (i32.const 128))
      (then (return (i32.const 4))))
    (if (i32.le_u (local.get $n) (i32.const 256))
      (then (return (i32.const 5))))
    (if (i32.le_u (local.get $n) (i32.const 512))
      (then (return (i32.const 6))))
    (if (i32.le_u (local.get $n) (i32.const 1024))
      (then (return (i32.const 7))))
    (if (i32.le_u (local.get $n) (i32.const 2048))
      (then (return (i32.const 8))))
    (if (i32.le_u (local.get $n) (i32.const 4096))
      (then (return (i32.const 9))))
    (i32.const 10)
  )

  ;; -------------------------------------------------------
  ;; Helper: actual block size for a size class index
  ;; -------------------------------------------------------
  (func $class_size (param $c i32) (result i32)
    (i32.shl
      (i32.const 8)
      (local.get $c)        ;; 8 << c — wrong for c=0, handle below
    )
    ;; Actually: sizes are 8,16,32,64,128,256,512,1024,2048,4096
    ;; Use a jump table via a quick formula: 8 << c
    drop
    (i32.shl (i32.const 4) (i32.add (local.get $c) (i32.const 1)))
  )

  ;; -------------------------------------------------------
  ;; Helper: grow memory by at least `need` bytes.
  ;; Updates $bump on success. Traps on OOM.
  ;; -------------------------------------------------------
  (func $ensure_space (param $need i32)
    (local $cur_pages i32)
    (local $new_pages i32)
    (local $cur_end   i32)

    (local.set $cur_pages (memory.size))
    (local.set $cur_end   (i32.shl (local.get $cur_pages) (i32.const 16)))

    (if (i32.gt_u
          (i32.add (global.get $bump) (local.get $need))
          (local.get $cur_end))
      (then
        ;; pages needed = ceil(need / 65536) + 1 for safety
        (local.set $new_pages
          (i32.add
            (i32.shr_u (i32.add (local.get $need) (i32.const 65535)) (i32.const 16))
            (i32.const 1)))
        ;; memory.grow returns -1 on failure
        (if (i32.eq (memory.grow (local.get $new_pages)) (i32.const -1))
          (then unreachable))    ;; OOM trap
      )
    )
  )

  ;; -------------------------------------------------------
  ;; Helper: read free-list head for class index c
  ;; -------------------------------------------------------
  (func $fl_head (param $c i32) (result i32)
    (i32.load
      (i32.add
        (global.get $fl_base)
        (i32.shl (local.get $c) (i32.const 2))))
  )

  ;; -------------------------------------------------------
  ;; Helper: write free-list head for class index c
  ;; -------------------------------------------------------
  (func $fl_set (param $c i32) (param $ptr i32)
    (i32.store
      (i32.add
        (global.get $fl_base)
        (i32.shl (local.get $c) (i32.const 2)))
      (local.get $ptr))
  )

  ;; -------------------------------------------------------
  ;; __jswat_alloc (size) -> ptr
  ;;
  ;; Returns pointer to a zeroed block of at least `size` bytes.
  ;; First 4 bytes = refcount header (set to 1 by caller for GC,
  ;; or 0xFFFFFFFF for manual — the compiler decides after return).
  ;;
  ;; For small allocations (≤4096): size-classed free list.
  ;;   - Pop from free list if available.
  ;;   - Otherwise bump-allocate from heap.
  ;; For large allocations (>4096): linked list.
  ;; -------------------------------------------------------
  (func $jswat_alloc (export "__jswat_alloc") (param $size i32) (result i32)
    (local $class   i32)
    (local $bsize   i32)
    (local $head    i32)
    (local $next    i32)
    (local $ptr     i32)

    (local.set $class (call $size_class (local.get $size)))

    (if (i32.lt_u (local.get $class) (i32.const 10))
      (then
        ;; Small path
        (local.set $bsize (call $class_size (local.get $class)))
        (local.set $head  (call $fl_head    (local.get $class)))

        (if (i32.ne (local.get $head) (i32.const 0))
          (then
            ;; Pop from free list — next pointer is in first 4 bytes of block
            (local.set $next (i32.load (local.get $head)))
            (call $fl_set (local.get $class) (local.get $next))
            ;; Zero the block before return
            (memory.fill (local.get $head) (i32.const 0) (local.get $bsize))
            (return (local.get $head))
          )
        )

        ;; Bump allocate
        (call $ensure_space (local.get $bsize))
        (local.set $ptr (global.get $bump))
        (global.set $bump (i32.add (local.get $ptr) (local.get $bsize)))
        ;; memory.fill to zero
        (memory.fill (local.get $ptr) (i32.const 0) (local.get $bsize))
        (return (local.get $ptr))
      )
    )

    ;; Large path — header: [next:4 | prev:4 | usable_size:4 | data...]
    ;; Total allocation = 12 + size, 8-byte aligned
    (local.set $bsize
      (i32.and
        (i32.add (i32.add (local.get $size) (i32.const 12)) (i32.const 7))
        (i32.const -8)))  ;; align to 8

    (call $ensure_space (local.get $bsize))
    (local.set $ptr (global.get $bump))
    (global.set $bump (i32.add (local.get $ptr) (local.get $bsize)))
    (memory.fill (local.get $ptr) (i32.const 0) (local.get $bsize))

    ;; Write size into header[8]
    (i32.store
      (i32.add (local.get $ptr) (i32.const 8))
      (local.get $size))

    ;; Link into large list (head at fl_base + 10*4)
    (local.set $head
      (i32.load
        (i32.add (global.get $fl_base) (i32.const 40))))
    (i32.store (local.get $ptr) (local.get $head))   ;; new.next = old head
    (i32.store (i32.add (local.get $ptr) (i32.const 4)) (i32.const 0)) ;; new.prev = null

    (if (i32.ne (local.get $head) (i32.const 0))
      (then
        (i32.store (i32.add (local.get $head) (i32.const 4)) (local.get $ptr))
      )
    )
    (i32.store (i32.add (global.get $fl_base) (i32.const 40)) (local.get $ptr))

    ;; Return pointer to data region (past 12-byte header)
    (i32.add (local.get $ptr) (i32.const 12))
  )

  ;; -------------------------------------------------------
  ;; __jswat_free (ptr)
  ;;
  ;; Frees a block previously returned by __jswat_alloc.
  ;; Called by rc_dec when count hits 0 (after dispose),
  ;; and directly by alloc.free / pool.free.
  ;;
  ;; Small blocks: push onto free list (write next into first 4 bytes).
  ;; Large blocks: unlink from doubly-linked list.
  ;; -------------------------------------------------------
  (func $jswat_free (export "__jswat_free") (param $ptr i32)
    (local $class i32)
    (local $hptr  i32)
    (local $size  i32)
    (local $next  i32)
    (local $prev  i32)
    (local $head  i32)

    ;; Determine if small (size-classed) or large.
    ;; We need the block size. For small blocks we can detect by
    ;; checking if ptr is in bump range and inferring the class.
    ;; Simpler: store class index in top 4 bits of refcount header.
    ;; For this runtime we use a simpler convention: large blocks
    ;; have their header at (ptr - 12) with a distinguishing size.

    ;; Try to look up as large block first.
    ;; Convention: we set bit 31 of the stored size for large blocks.
    (local.set $hptr (i32.sub (local.get $ptr) (i32.const 12)))
    (local.set $size (i32.load (i32.add (local.get $hptr) (i32.const 8))))

    (if (i32.and (local.get $size) (i32.const 0x80000000))
      (then
        ;; Large block — unlink from doubly-linked list
        (local.set $size (i32.and (local.get $size) (i32.const 0x7FFFFFFF)))
        (local.set $next (i32.load (local.get $hptr)))
        (local.set $prev (i32.load (i32.add (local.get $hptr) (i32.const 4))))

        (if (i32.ne (local.get $next) (i32.const 0))
          (then
            (i32.store
              (i32.add (local.get $next) (i32.const 4))
              (local.get $prev))
          )
        )
        (if (i32.ne (local.get $prev) (i32.const 0))
          (then
            (i32.store (local.get $prev) (local.get $next))
          )
          (else
            ;; Was head — update list head
            (i32.store
              (i32.add (global.get $fl_base) (i32.const 40))
              (local.get $next))
          )
        )
        ;; Poison the header in debug builds (leave zeroed for simplicity here)
        (return)
      )
    )

    ;; Small block — determine class from size stored in rc header top bits.
    ;; Convention: compiler writes class index into bits [31:28] of rc header
    ;; when allocating. We read it back here.
    ;; rc header is at $ptr + 0 (it's the first field).
    (local.set $class
      (i32.shr_u
        (i32.load (local.get $ptr))
        (i32.const 28)))

    ;; Push to free list: write current head into first 4 bytes of block
    (local.set $head (call $fl_head (local.get $class)))
    (i32.store (local.get $ptr) (local.get $head))
    (call $fl_set (local.get $class) (local.get $ptr))
  )

  ;; -------------------------------------------------------
  ;; __jswat_realloc (ptr, newsize) -> ptr
  ;;
  ;; Resizes a raw byte buffer. Old pointer is invalid after call.
  ;; Only used for alloc.realloc — not for typed GC objects.
  ;; -------------------------------------------------------
  (func $jswat_realloc (export "__jswat_realloc")
        (param $old i32) (param $new_size i32) (result i32)
    (local $new_ptr  i32)
    (local $old_size i32)
    (local $copy_n   i32)

    ;; Allocate new block
    (local.set $new_ptr (call $jswat_alloc (local.get $new_size)))

    ;; Read old size from large-block header if available,
    ;; else estimate from class size. For simplicity: always use
    ;; the new_size as copy length if smaller.
    ;; In practice alloc.realloc is only called on alloc.bytes buffers
    ;; which are large enough to have a 12-byte header.
    (local.set $old_size
      (i32.and
        (i32.load (i32.add (i32.sub (local.get $old) (i32.const 12)) (i32.const 8)))
        (i32.const 0x7FFFFFFF)))

    (local.set $copy_n
      (if (result i32)
        (i32.lt_u (local.get $old_size) (local.get $new_size))
        (then (local.get $old_size))
        (else (local.get $new_size))
      ))

    (memory.copy
      (local.get $new_ptr)
      (local.get $old)
      (local.get $copy_n))

    (call $jswat_free (local.get $old))
    (local.get $new_ptr)
  )

  ;; -------------------------------------------------------
  ;; __jswat_rc_inc (ptr)
  ;;
  ;; Increment refcount. If sentinel (0xFFFFFFFF) — no-op.
  ;; rc is at ptr+0 (first 4 bytes of every heap object).
  ;; -------------------------------------------------------
  (func $jswat_rc_inc (export "__jswat_rc_inc") (param $ptr i32)
    (local $rc i32)

    ;; null check
    (if (i32.eqz (local.get $ptr)) (then (return)))

    (local.set $rc (i32.load (local.get $ptr)))

    ;; sentinel check: -1 (0xFFFFFFFF) = manual, skip
    (if (i32.eq (local.get $rc) (i32.const -1)) (then (return)))

    ;; increment, strip class bits first, re-apply
    ;; rc is stored in bits [27:0], class in [31:28]
    (i32.store
      (local.get $ptr)
      (i32.or
        (i32.and (local.get $rc) (i32.const 0xF0000000))  ;; preserve class bits
        (i32.add
          (i32.and (local.get $rc) (i32.const 0x0FFFFFFF))  ;; extract rc bits
          (i32.const 1))
      )
    )
  )

  ;; -------------------------------------------------------
  ;; __jswat_rc_dec (ptr)
  ;;
  ;; Decrement refcount. If sentinel — no-op.
  ;; If rc reaches 0 — call __jswat_dispose, then __jswat_free.
  ;; -------------------------------------------------------
  (func $jswat_rc_dec (export "__jswat_rc_dec") (param $ptr i32)
    (local $rc  i32)
    (local $new_rc i32)

    ;; null check
    (if (i32.eqz (local.get $ptr)) (then (return)))

    (local.set $rc (i32.load (local.get $ptr)))

    ;; sentinel check
    (if (i32.eq (local.get $rc) (i32.const -1)) (then (return)))

    (local.set $new_rc
      (i32.sub
        (i32.and (local.get $rc) (i32.const 0x0FFFFFFF))
        (i32.const 1)))

    (if (i32.eqz (local.get $new_rc))
      (then
        ;; rc hit 0 — dispose + free
        (call $jswat_dispose (local.get $ptr))
        (call $jswat_free    (local.get $ptr))
        (return)
      )
    )

    ;; store updated rc (preserve class bits)
    (i32.store
      (local.get $ptr)
      (i32.or
        (i32.and (local.get $rc) (i32.const 0xF0000000))
        (local.get $new_rc)
      )
    )
  )

  ;; -------------------------------------------------------
  ;; __jswat_dispose (ptr)
  ;;
  ;; Calls the Symbol.dispose method on the object at `ptr`
  ;; if one exists. The vtable pointer is stored at a well-
  ;; known offset agreed with the compiler.
  ;;
  ;; Vtable layout (compiler-generated per class):
  ;;   [ dispose_fn: i32 | ... other symbol slots ]
  ;;
  ;; The compiler stores the vtable address at (ptr + 4) for
  ;; GC objects that have at least one symbol method. If the
  ;; vtable pointer is 0, the object has no dispose — skip.
  ;;
  ;; dispose_fn signature: (param $self i32)
  ;;
  ;; Note: for objects without any symbols the compiler emits
  ;; no vtable and writes 0 to slot ptr+4. This function is
  ;; always safe to call.
  ;; -------------------------------------------------------

  ;; Indirect call table — compiler populates at link time with
  ;; all dispose functions. We use call_indirect with type (i32)->(void).
  (table $vtable_dispatch 0 funcref)
  (type $dispose_sig (func (param i32)))

  (func $jswat_dispose (export "__jswat_dispose") (param $ptr i32)
    (local $vtable   i32)
    (local $disp_fn  i32)

    (if (i32.eqz (local.get $ptr)) (then (return)))

    ;; Vtable pointer at ptr+4 (second i32 slot)
    (local.set $vtable (i32.load (i32.add (local.get $ptr) (i32.const 4))))
    (if (i32.eqz (local.get $vtable)) (then (return)))

    ;; dispose_fn is first entry in vtable
    (local.set $disp_fn (i32.load (local.get $vtable)))
    (if (i32.eqz (local.get $disp_fn)) (then (return)))

    ;; call_indirect with (i32) -> ()
    (call_indirect (type $dispose_sig)
      (local.get $ptr)
      (local.get $disp_fn))
  )

  ;; -------------------------------------------------------
  ;; Arena allocator
  ;;
  ;; Arena header (GC-allocated, rc managed):
  ;;   [ rc_class:4 | vtable_ptr:4 | class_id:4 | buf_ptr:4 | used:4 | capacity:4 | growable:4 ]
  ;; Total: 28 bytes header.
  ;;
  ;; buf_ptr points to a raw byte buffer.
  ;; Growable arenas double their buffer on overflow.
  ;; Fixed arenas trap on overflow.
  ;; -------------------------------------------------------
  (func $jswat_arena_new (export "__jswat_arena_new") (param $size i32) (result i32)
    (local $arena i32)
    (local $buf   i32)

    ;; Allocate arena header — 28 bytes, class 2 (32-byte slot)
    (local.set $arena (call $jswat_alloc (i32.const 28)))
    ;; rc = 1 (GC-managed), class_id written by compiler at link time
    (i32.store (local.get $arena) (i32.const 1))

    ;; If size = 0, start with 4096
    (if (i32.eqz (local.get $size))
      (then
        (local.set $size (i32.const 4096))
        ;; Mark growable: write 1 at offset 24 (growable field)
        (i32.store (i32.add (local.get $arena) (i32.const 24)) (i32.const 1))
      )
    )

    ;; Allocate buffer
    (local.set $buf (call $jswat_alloc (local.get $size)))
    (i32.store8 (local.get $buf) (i32.const -1))  ;; sentinel for buf block
    ;; Header layout (past 12-byte object header):
    ;;   offset 12 = buf_ptr
    ;;   offset 16 = used
    ;;   offset 20 = capacity
    ;;   offset 24 = growable (i32, 0 or 1)
    (i32.store (i32.add (local.get $arena) (i32.const 12)) (local.get $buf))
    (i32.store (i32.add (local.get $arena) (i32.const 16)) (i32.const 0))     ;; used=0
    (i32.store (i32.add (local.get $arena) (i32.const 20)) (local.get $size)) ;; capacity

    (local.get $arena)
  )

  (func $jswat_arena_alloc (export "__jswat_arena_alloc")
        (param $arena i32) (param $size i32) (result i32)
    (local $used   i32)
    (local $cap    i32)
    (local $buf    i32)
    (local $result i32)
    (local $new_cap i32)
    (local $new_buf i32)

    ;; Align size to 8 bytes
    (local.set $size
      (i32.and
        (i32.add (local.get $size) (i32.const 7))
        (i32.const -8)))

    (local.set $used (i32.load (i32.add (local.get $arena) (i32.const 16))))
    (local.set $cap  (i32.load (i32.add (local.get $arena) (i32.const 20))))
    (local.set $buf  (i32.load (i32.add (local.get $arena) (i32.const 12))))

    (if (i32.gt_u (i32.add (local.get $used) (local.get $size)) (local.get $cap))
      (then
        ;; Check if growable
        (if (i32.eqz
              (i32.load (i32.add (local.get $arena) (i32.const 24))))
          (then unreachable)  ;; fixed arena overflow — trap
        )

        ;; Grow: double capacity until sufficient
        (local.set $new_cap (local.get $cap))
        (block $done
          (loop $grow
            (local.set $new_cap (i32.shl (local.get $new_cap) (i32.const 1)))
            (br_if $grow
              (i32.lt_u
                (local.get $new_cap)
                (i32.add (local.get $used) (local.get $size))))
            (br $done)
          )
        )

        (local.set $new_buf (call $jswat_realloc (local.get $buf) (local.get $new_cap)))
        (i32.store (i32.add (local.get $arena) (i32.const 12)) (local.get $new_buf))
        (i32.store (i32.add (local.get $arena) (i32.const 20)) (local.get $new_cap))
        (local.set $buf (local.get $new_buf))
        (local.set $cap (local.get $new_cap))
      )
    )

    ;; Bump within arena buffer
    (local.set $result (i32.add (local.get $buf) (local.get $used)))
    (memory.fill (local.get $result) (i32.const 0) (local.get $size))
    ;; Write sentinel — arena objects never GC-freed individually
    (i32.store (local.get $result) (i32.const -1))

    (i32.store
      (i32.add (local.get $arena) (i32.const 16))
      (i32.add (local.get $used) (local.get $size)))

    (local.get $result)
  )

  (func $jswat_arena_reset (export "__jswat_arena_reset") (param $arena i32)
    ;; Reset used counter — no individual frees
    (i32.store (i32.add (local.get $arena) (i32.const 16)) (i32.const 0))
  )

  (func $jswat_arena_free (export "__jswat_arena_free") (param $arena i32)
    (local $buf i32)
    (local.set $buf (i32.load (i32.add (local.get $arena) (i32.const 12))))
    (call $jswat_free (local.get $buf))
    (call $jswat_free (local.get $arena))
  )

  ;; -------------------------------------------------------
  ;; Pool allocator
  ;;
  ;; Pool<T> header (GC-allocated):
  ;;   [ rc_class:4 | vtable_ptr:4 | class_id:4 | buf_ptr:4 | stride:4 | capacity:4 | free_head:4 ]
  ;; Total: 28 bytes.
  ;;
  ;; buf_ptr points to capacity * stride raw bytes.
  ;; Free slots: their first 4 bytes are a next-free-index (1-based).
  ;; 0 = no next free slot.
  ;; free_head: index of first free slot (1-based, 0 = pool full).
  ;;
  ;; On pool creation all slots are chained into the free list.
  ;; -------------------------------------------------------
  (func $jswat_pool_new (export "__jswat_pool_new")
        (param $stride i32) (param $cap i32) (result i32)
    (local $pool i32)
    (local $buf  i32)
    (local $i    i32)
    (local $slot i32)

    (local.set $pool (call $jswat_alloc (i32.const 28)))
    (i32.store (local.get $pool) (i32.const 1))  ;; rc = 1

    ;; If capacity = 0, use 16
    (if (i32.eqz (local.get $cap))
      (then (local.set $cap (i32.const 16))))

    (local.set $buf (call $jswat_alloc (i32.mul (local.get $stride) (local.get $cap))))

    ;; Pool header layout (past 12-byte object header):
    ;;   offset 12 = buf_ptr
    ;;   offset 16 = stride
    ;;   offset 20 = capacity
    ;;   offset 24 = free_head (1-based index, 0 = full)
    (i32.store (i32.add (local.get $pool) (i32.const 12)) (local.get $buf))
    (i32.store (i32.add (local.get $pool) (i32.const 16)) (local.get $stride))
    (i32.store (i32.add (local.get $pool) (i32.const 20)) (local.get $cap))
    (i32.store (i32.add (local.get $pool) (i32.const 24)) (i32.const 1)) ;; free_head = slot 1

    ;; Chain free list: slot[i].next = i+2 for i in 1..cap-1; last.next = 0
    (local.set $i (i32.const 0))
    (block $done
      (loop $chain
        (br_if $done (i32.ge_u (local.get $i) (local.get $cap)))
        (local.set $slot
          (i32.add (local.get $buf)
            (i32.mul (local.get $i) (local.get $stride))))

        ;; Write sentinel header
        (i32.store (local.get $slot) (i32.const -1))

        ;; Write next index in slot+4 (reuse vtable slot for free-list next)
        (i32.store
          (i32.add (local.get $slot) (i32.const 4))
          (if (result i32)
            (i32.lt_u (i32.add (local.get $i) (i32.const 1)) (local.get $cap))
            (then (i32.add (local.get $i) (i32.const 2)))  ;; 1-based next
            (else (i32.const 0))                            ;; last slot
          ))

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $chain)
      )
    )

    (local.get $pool)
  )

  (func $jswat_pool_alloc (export "__jswat_pool_alloc") (param $pool i32) (result i32)
    (local $free_head i32)
    (local $buf       i32)
    (local $stride    i32)
    (local $slot      i32)
    (local $next      i32)

    (local.set $free_head (i32.load (i32.add (local.get $pool) (i32.const 24))))

    (if (i32.eqz (local.get $free_head))
      (then unreachable)  ;; pool exhausted — trap
    )

    (local.set $buf    (i32.load (i32.add (local.get $pool) (i32.const 12))))
    (local.set $stride (i32.load (i32.add (local.get $pool) (i32.const 16))))

    ;; Convert 1-based index to offset
    (local.set $slot
      (i32.add (local.get $buf)
        (i32.mul
          (i32.sub (local.get $free_head) (i32.const 1))
          (local.get $stride))))

    ;; Read next free index from slot+4
    (local.set $next (i32.load (i32.add (local.get $slot) (i32.const 4))))

    ;; Update free head
    (i32.store (i32.add (local.get $pool) (i32.const 24)) (local.get $next))

    ;; Zero the slot and write sentinel
    (memory.fill (local.get $slot) (i32.const 0) (local.get $stride))
    (i32.store (local.get $slot) (i32.const -1))

    (local.get $slot)
  )

  (func $jswat_pool_free (export "__jswat_pool_free")
        (param $pool i32) (param $slot i32)
    (local $buf       i32)
    (local $stride    i32)
    (local $cap       i32)
    (local $idx       i32)
    (local $free_head i32)

    (local.set $buf    (i32.load (i32.add (local.get $pool) (i32.const 12))))
    (local.set $stride (i32.load (i32.add (local.get $pool) (i32.const 16))))
    (local.set $cap    (i32.load (i32.add (local.get $pool) (i32.const 20))))

    ;; Convert pointer to 1-based index
    (local.set $idx
      (i32.add
        (i32.div_u
          (i32.sub (local.get $slot) (local.get $buf))
          (local.get $stride))
        (i32.const 1)))

    (local.set $free_head (i32.load (i32.add (local.get $pool) (i32.const 24))))

    ;; Push onto free list
    (i32.store (i32.add (local.get $slot) (i32.const 4)) (local.get $free_head))
    (i32.store (local.get $slot) (i32.const -1))  ;; keep sentinel
    (i32.store (i32.add (local.get $pool) (i32.const 24)) (local.get $idx))
  )

  ;; -------------------------------------------------------
  ;; __jswat_init
  ;;
  ;; Called by the compiler-generated _start function before
  ;; any user code runs. Sets up free-list table and $bump.
  ;; -------------------------------------------------------
  (func $jswat_init (export "__jswat_init")
    ;; fl_base = heap_base
    (global.set $fl_base (global.get $heap_base))

    ;; $bump = heap_base + 44 (11 free-list slots * 4 bytes)
    (global.set $bump
      (i32.add (global.get $heap_base) (i32.const 44)))

    ;; Zero the free-list table
    (memory.fill (global.get $fl_base) (i32.const 0) (i32.const 44))
  )

)
```

---

## 24. Standard Library Source

All stdlib modules are written in js.wat itself. The compiler is bootstrapped — it can compile its own stdlib. Each module is listed below with full source.

### 24.1 `std/wasm`
```js
// std/wasm — WASM instruction intrinsics
// Version 1.3
//
// Every export compiles to exactly ONE WASM instruction.
// Zero runtime overhead — the compiler inlines the instruction
// directly at every call site.
//
// Tier 1: pure value ops — safe for all code.
// Tier 2: raw memory ops — use only in low-level code.

// ============================================================
// Tier 1 — Bit ops (i32)
// ============================================================
export function i32_clz   (x = i32(0))             { return i32(0); }  // i32.clz
export function i32_ctz   (x = i32(0))             { return i32(0); }  // i32.ctz
export function i32_popcnt(x = i32(0))             { return i32(0); }  // i32.popcnt
export function i32_rotl  (x = i32(0), n = i32(0)) { return i32(0); }  // i32.rotl
export function i32_rotr  (x = i32(0), n = i32(0)) { return i32(0); }  // i32.rotr

// ============================================================
// Tier 1 — Bit ops (i64)
// ============================================================
export function i64_clz   (x = i64(0))             { return i64(0); }  // i64.clz
export function i64_ctz   (x = i64(0))             { return i64(0); }  // i64.ctz
export function i64_popcnt(x = i64(0))             { return i64(0); }  // i64.popcnt
export function i64_rotl  (x = i64(0), n = i64(0)) { return i64(0); }  // i64.rotl
export function i64_rotr  (x = i64(0), n = i64(0)) { return i64(0); }  // i64.rotr

// ============================================================
// Tier 1 — Float ops (f32)
// ============================================================
export function f32_sqrt    (x = f32(0.0))               { return f32(0.0); }  // f32.sqrt
export function f32_floor   (x = f32(0.0))               { return f32(0.0); }  // f32.floor
export function f32_ceil    (x = f32(0.0))               { return f32(0.0); }  // f32.ceil
export function f32_trunc   (x = f32(0.0))               { return f32(0.0); }  // f32.trunc
export function f32_nearest (x = f32(0.0))               { return f32(0.0); }  // f32.nearest
export function f32_abs     (x = f32(0.0))               { return f32(0.0); }  // f32.abs
export function f32_neg     (x = f32(0.0))               { return f32(0.0); }  // f32.neg
export function f32_min     (a = f32(0.0), b = f32(0.0)) { return f32(0.0); }  // f32.min
export function f32_max     (a = f32(0.0), b = f32(0.0)) { return f32(0.0); }  // f32.max
export function f32_copysign(x = f32(0.0), y = f32(0.0)) { return f32(0.0); }  // f32.copysign

// ============================================================
// Tier 1 — Float ops (f64)
// ============================================================
export function f64_sqrt    (x = 0.0)          { return 0.0; }  // f64.sqrt
export function f64_floor   (x = 0.0)          { return 0.0; }  // f64.floor
export function f64_ceil    (x = 0.0)          { return 0.0; }  // f64.ceil
export function f64_trunc   (x = 0.0)          { return 0.0; }  // f64.trunc
export function f64_nearest (x = 0.0)          { return 0.0; }  // f64.nearest
export function f64_abs     (x = 0.0)          { return 0.0; }  // f64.abs
export function f64_neg     (x = 0.0)          { return 0.0; }  // f64.neg
export function f64_min     (a = 0.0, b = 0.0) { return 0.0; }  // f64.min
export function f64_max     (a = 0.0, b = 0.0) { return 0.0; }  // f64.max
export function f64_copysign(x = 0.0, y = 0.0) { return 0.0; }  // f64.copysign

// ============================================================
// Tier 1 — Reinterpret (bit-identical type pun)
// ============================================================
export function i32_reinterpret_f32(x = f32(0.0)) { return i32(0);   }  // i32.reinterpret_f32
export function f32_reinterpret_i32(x = i32(0))   { return f32(0.0); }  // f32.reinterpret_i32
export function i64_reinterpret_f64(x = 0.0)      { return i64(0);   }  // i64.reinterpret_f64
export function f64_reinterpret_i64(x = i64(0))   { return 0.0;      }  // f64.reinterpret_i64

// ============================================================
// Tier 2 — Raw memory load/store
// addr is a raw usize linear memory address.
// These bypass the type system. Use only in allocator/string code.
// ============================================================
export function i32_load   (addr = usize(0))                 { return i32(0);   }
export function i32_store  (addr = usize(0), v = i32(0))     { }
export function i64_load   (addr = usize(0))                 { return i64(0);   }
export function i64_store  (addr = usize(0), v = i64(0))     { }
export function f32_load   (addr = usize(0))                 { return f32(0.0); }
export function f32_store  (addr = usize(0), v = f32(0.0))   { }
export function f64_load   (addr = usize(0))                 { return 0.0;      }
export function f64_store  (addr = usize(0), v = 0.0)        { }

export function i32_load8_s (addr = usize(0))                { return i32(0); }
export function i32_load8_u (addr = usize(0))                { return i32(0); }
export function i32_store8  (addr = usize(0), v = i32(0))    { }
export function i32_load16_s(addr = usize(0))                { return i32(0); }
export function i32_load16_u(addr = usize(0))                { return i32(0); }
export function i32_store16 (addr = usize(0), v = i32(0))    { }

// ============================================================
// Tier 2 — Memory control
// ============================================================
export function memory_size()                                          { return usize(0); }
export function memory_grow(delta = usize(0))                         { return usize(0); }
export function memory_copy(dst = usize(0), src = usize(0), n = usize(0)) { }
export function memory_fill(dst = usize(0), val = u8(0), n = usize(0))    { }
```

### 24.2 `std/math`
```js
// std/math — Math default export
// Version 1.3
//
// All transcendentals implemented in pure js.wat using
// minimax polynomial approximations and bit manipulation
// via reinterpret intrinsics. No host imports required.
// Degrades gracefully in WASI-free environments.

import { f64_sqrt, f64_floor, f64_ceil, f64_trunc, f64_abs,
         f64_min,  f64_max,   f64_nearest,
         f32_sqrt, f32_floor, f32_ceil, f32_trunc, f32_abs,
         f32_min,  f32_max,   f32_nearest,
         i32_clz,  i32_popcnt, i32_rotl,
         i64_reinterpret_f64, f64_reinterpret_i64,
         i32_reinterpret_f32, f32_reinterpret_i32 } from "std/wasm";

// ============================================================
// Constants
// ============================================================
class Math {
  static PI      = 3.141592653589793;
  static E       = 2.718281828459045;
  static LN2     = 0.6931471805599453;
  static LN10    = 2.302585092994046;
  static LOG2E   = 1.4426950408889634;
  static LOG10E  = 0.4342944819032518;
  static SQRT2   = 1.4142135623730951;
  static SQRT1_2 = 0.7071067811865476;

  // ============================================================
  // Reinterpret — single WASM instruction each
  // ============================================================
  static reinterpretAsI64(x = 0.0)      { return i64_reinterpret_f64(x); }
  static reinterpretAsF64(x = i64(0))   { return f64_reinterpret_i64(x); }
  static reinterpretAsI32(x = f32(0.0)) { return i32_reinterpret_f32(x); }
  static reinterpretAsF32(x = i32(0))   { return f32_reinterpret_i32(x); }

  // ============================================================
  // Native float ops — delegated to std/wasm intrinsics
  // Monomorphize for Float (f32/f64).
  // ============================================================
  static sqrt (x = Float) { return f64_sqrt(f64(x));  }   // monomorphized per type
  static floor(x = Float) { return f64_floor(f64(x)); }
  static ceil (x = Float) { return f64_ceil(f64(x));  }
  static round(x = Float) { return f64_nearest(f64(x)); }
  static trunc(x = Float) { return f64_trunc(f64(x)); }
  static fround(x = 0.0)  { return f32(x); }               // round to f32

  // ============================================================
  // Arithmetic — work on all numeric types via Number generic
  // ============================================================
  static abs(x = Number) {
    if (x < 0) return -x;
    return x;
  }

  static min(a = Number, b = Number) { return a < b ? a : b; }
  static max(a = Number, b = Number) { return a > b ? a : b; }

  static sign(x = Number) {
    if (x > 0) return 1;
    if (x < 0) return -1;
    return 0;
  }

  static clamp(val = Number, lo = Number, hi = Number) {
    if (val < lo) return lo;
    if (val > hi) return hi;
    return val;
  }

  // ============================================================
  // Integer-specific
  // ============================================================
  static clz32(x = i32(0))               { return i32_clz(x); }
  static imul (a = i32(0), b = i32(0))   { return a * b; }
  static popcnt(x = i32(0))              { return i32_popcnt(x); }

  // ============================================================
  // Float extras
  // ============================================================
  static lerp(a = Float, b = Float, t = Float) {
    return a + (b - a) * t;
  }

  static smoothstep(e0 = Float, e1 = Float, x = Float) {
    let t = Math.clamp((x - e0) / (e1 - e0), f64(0.0), f64(1.0));
    return t * t * (3.0 - 2.0 * t);
  }

  static map(val = Float, inMin = Float, inMax = Float,
             outMin = Float, outMax = Float) {
    return outMin + (outMax - outMin) * ((val - inMin) / (inMax - inMin));
  }

  static degToRad(deg = Float) { return deg * (Math.PI / 180.0); }
  static radToDeg(rad = Float) { return rad * (180.0 / Math.PI); }

  // ============================================================
  // Exponential/logarithmic — minimax polynomial approximations
  // ============================================================

  // exp(x) — range-reduced polynomial, relative error < 2^-52
  static exp(x = 0.0) {
    // Special cases
    if (x > 709.0)  return 1.0 / 0.0;   // +Inf
    if (x < -745.0) return 0.0;

    // Range reduction: x = k*ln2 + r,  |r| <= 0.5*ln2
    const ln2Hi = 6.93147180369123816490e-1;
    const ln2Lo = 1.90821492927058770002e-10;
    const inv_ln2 = 1.44269504088896338700;

    const k = Math.round(x * inv_ln2);
    const ki = i64(k);
    const r = x - k * ln2Hi - k * ln2Lo;

    // Polynomial: exp(r) ≈ 1 + r + r²/2! + ... (Horner form, degree 6)
    const p = r * (1.0 +
              r * (0.5 +
              r * (1.6666666666666666e-1 +
              r * (4.1666666666666664e-2 +
              r * (8.3333333333333332e-3 +
              r * 1.3888888888888888e-3)))));

    // Multiply by 2^k via bit manipulation
    const pow2k = Math.reinterpretAsF64(
      i64((ki + i64(1023)) << i64(52)));
    return (1.0 + p) * pow2k;
  }

  static expm1(x = 0.0) { return Math.exp(x) - 1.0; }

  // log(x) — natural log, x > 0
  static log(x = 0.0) {
    if (x <= 0.0) return 0.0 / 0.0;  // NaN
    if (x == 1.0) return 0.0;

    // Decompose: x = 2^e * m,  m in [1, 2)
    const bits = Math.reinterpretAsI64(x);
    const e = i64(i32(bits >> i64(52))) - i64(1023);
    const m = Math.reinterpretAsF64(
      (bits & i64(0x000FFFFFFFFFFFFF)) | i64(0x3FF0000000000000));

    // Polynomial: log((1+t)/(1-t)), t = (m-1)/(m+1)
    const t = (m - 1.0) / (m + 1.0);
    const t2 = t * t;
    const p = t * (2.0 +
              t2 * (0.6666666666666666 +
              t2 * (0.4 +
              t2 * (0.2857142857142857 +
              t2 * 0.2222222222222222))));

    return p + f64(e) * Math.LN2;
  }

  static log2 (x = 0.0) { return Math.log(x) * Math.LOG2E;  }
  static log10(x = 0.0) { return Math.log(x) * Math.LOG10E; }
  static log1p(x = 0.0) {
    if (x < -1.0) return 0.0 / 0.0;
    if (f64_abs(x) < 1e-8) return x - x * x * 0.5;
    return Math.log(1.0 + x);
  }

  static pow(base = 0.0, exp = 0.0) {
    if (exp == 0.0) return 1.0;
    if (exp == 1.0) return base;
    if (base == 0.0) return 0.0;
    return Math.exp(exp * Math.log(base));
  }

  static cbrt(x = 0.0) {
    if (x == 0.0) return 0.0;
    const sign = x < 0.0 ? -1.0 : 1.0;
    const ax = f64_abs(x);
    // Initial guess via exponent manipulation
    const bits = Math.reinterpretAsI64(ax);
    const e = i32(bits >> i64(52)) - 1023;
    const adj = e / 3;
    let r = Math.reinterpretAsF64(
      (bits & i64(0x000FFFFFFFFFFFFF)) |
      i64((adj + 1023) << 52));
    // Two Newton iterations: r = (2r + ax/r²) / 3
    r = (2.0 * r + ax / (r * r)) / 3.0;
    r = (2.0 * r + ax / (r * r)) / 3.0;
    r = (2.0 * r + ax / (r * r)) / 3.0;
    return sign * r;
  }

  static hypot(a = 0.0, b = 0.0) {
    const aa = f64_abs(a);
    const ab = f64_abs(b);
    if (aa == 0.0) return ab;
    if (ab == 0.0) return aa;
    const big = f64_max(aa, ab);
    const small = f64_min(aa, ab);
    const ratio = small / big;
    return big * f64_sqrt(1.0 + ratio * ratio);
  }

  // ============================================================
  // Trigonometric — minimax polynomial after range reduction
  // ============================================================

  // sin — kernel for x in [-π/4, π/4]
  static #sinKernel(x = 0.0) {
    const x2 = x * x;
    return x * (1.0 +
           x2 * (-1.6666666666666666e-1 +
           x2 * ( 8.3333333333333329e-3 +
           x2 * (-1.9841269841269841e-4 +
           x2 * ( 2.7557319223985890e-6 +
           x2 * (-2.5052108385441720e-8))))));
  }

  // cos — kernel for x in [-π/4, π/4]
  static #cosKernel(x = 0.0) {
    const x2 = x * x;
    return 1.0 +
           x2 * (-0.5 +
           x2 * ( 4.1666666666666664e-2 +
           x2 * (-1.3888888888888888e-3 +
           x2 * ( 2.4801587301587302e-5 +
           x2 * (-2.7557319223985890e-7)))));
  }

  // Modulo reduction to [-π/4, π/4] range with quadrant tracking
  static sin(x = 0.0) {
    const pi2 = Math.PI * 2.0;
    const n = Math.round(x * (1.0 / (Math.PI * 0.5)));
    const r = x - n * (Math.PI * 0.5);
    const q = i32(n) & 3;
    if (q == 0) return Math.#sinKernel(r);
    if (q == 1) return Math.#cosKernel(r);
    if (q == 2) return -Math.#sinKernel(r);
    return -Math.#cosKernel(r);
  }

  static cos(x = 0.0) {
    const n = Math.round(x * (1.0 / (Math.PI * 0.5)));
    const r = x - n * (Math.PI * 0.5);
    const q = i32(n) & 3;
    if (q == 0) return Math.#cosKernel(r);
    if (q == 1) return -Math.#sinKernel(r);
    if (q == 2) return -Math.#cosKernel(r);
    return Math.#sinKernel(r);
  }

  static tan(x = 0.0) {
    const c = Math.cos(x);
    if (c == 0.0) return 1.0 / 0.0;
    return Math.sin(x) / c;
  }

  static asin(x = 0.0) {
    if (x > 1.0 || x < -1.0) return 0.0 / 0.0;
    if (f64_abs(x) > 0.5) {
      const sign = x < 0.0 ? -1.0 : 1.0;
      return sign * (Math.PI * 0.5 - 2.0 * Math.asin(f64_sqrt((1.0 - f64_abs(x)) * 0.5)));
    }
    const x2 = x * x;
    return x * (1.0 +
           x2 * (1.6666666666666666e-1 +
           x2 * (7.5000000000000000e-2 +
           x2 * (4.4642857142857144e-2 +
           x2 * (3.0381944444444448e-2)))));
  }

  static acos(x = 0.0) { return Math.PI * 0.5 - Math.asin(x); }

  static atan(x = 0.0) {
    // Reduce to [0, 1] via atan(x) = π/2 - atan(1/x) for |x| > 1
    const sign = x < 0.0 ? -1.0 : 1.0;
    const ax = f64_abs(x);
    let r = 0.0;
    if (ax > 1.0) {
      r = Math.PI * 0.5 - Math.#atanKernel(1.0 / ax);
    } else {
      r = Math.#atanKernel(ax);
    }
    return sign * r;
  }

  static #atanKernel(x = 0.0) {
    const x2 = x * x;
    return x * (1.0 +
           x2 * (-3.3333333333333331e-1 +
           x2 * ( 2.0000000000000001e-1 +
           x2 * (-1.4285714285714285e-1 +
           x2 * ( 1.1111111111111110e-1 +
           x2 * (-9.0909090909090912e-2))))));
  }

  static atan2(y = 0.0, x = 0.0) {
    if (x == 0.0) {
      if (y > 0.0) return Math.PI * 0.5;
      if (y < 0.0) return -Math.PI * 0.5;
      return 0.0;
    }
    const r = Math.atan(y / x);
    if (x < 0.0) return y >= 0.0 ? r + Math.PI : r - Math.PI;
    return r;
  }

  // ============================================================
  // Hyperbolic
  // ============================================================
  static sinh(x = 0.0) {
    const e = Math.exp(x);
    return (e - 1.0 / e) * 0.5;
  }

  static cosh(x = 0.0) {
    const e = Math.exp(x);
    return (e + 1.0 / e) * 0.5;
  }

  static tanh(x = 0.0) {
    if (x > 20.0)  return  1.0;
    if (x < -20.0) return -1.0;
    const e2 = Math.exp(2.0 * x);
    return (e2 - 1.0) / (e2 + 1.0);
  }

  static asinh(x = 0.0) { return Math.log(x + f64_sqrt(x * x + 1.0)); }
  static acosh(x = 0.0) {
    if (x < 1.0) return 0.0 / 0.0;
    return Math.log(x + f64_sqrt(x * x - 1.0));
  }
  static atanh(x = 0.0) {
    if (f64_abs(x) >= 1.0) return 0.0 / 0.0;
    return 0.5 * Math.log((1.0 + x) / (1.0 - x));
  }

  // ============================================================
  // Random — alias to global Random instance
  // ============================================================
  static random() { return Random.float(); }
}

export default Math;
```

### 24.3 `std/string`
```js
// std/string — heap-allocated mutable string
// Version 1.3
//
// Memory layout:
//   [ rc_class:4 | vtable_ptr:4 | class_id:4 | length:4 | capacity:4 | hash:4 | *buffer:4 ]
//   Total header: 28 bytes. Buffer is a raw alloc.bytes block.
//
// hash is lazily computed on first access and cached.
// hash == 0 means "not computed" — the empty string uses hash=1 as sentinel.

import { i32_load8_u, i32_store8, i32_load, i32_store,
         memory_copy, memory_fill } from "std/wasm";

class String {
  #length;    // usize
  #capacity;  // usize
  #hash;      // u32 — cached, 0 = not yet computed
  #buf;       // u8? — raw byte buffer (alloc.bytes)

  constructor(src = "") {
    const srcLen = src.length;
    this.#length   = srcLen;
    this.#capacity = srcLen < usize(8) ? usize(8) : srcLen;
    this.#hash     = u32(0);
    this.#buf      = alloc.bytes(this.#capacity);
    alloc.copy(this.#buf, src, srcLen);
  }

  // ============================================================
  // Properties
  // ============================================================
  get length() { return this.#length; }

  get capacity() { return this.#capacity; }

  // ============================================================
  // Buffer access
  // ============================================================

  // Raw address of byte buffer — for host interop
  dataPtr() { return usize(this.#buf); }

  // Zero-copy str view — valid only while String lives
  asStr() {
    // Compiler synthesizes a str slice from (buf, length)
    // This is a compiler intrinsic — returns str pointing at #buf
    return __str_from_ptr(this.#buf, this.#length);
  }

  // ============================================================
  // Mutation
  // ============================================================
  set(i = usize(0), ch = "") {
    if (i >= this.#length) return;
    i32_store8(usize(this.#buf) + i, i32(ch.at(usize(0))));
    this.#hash = u32(0);  // invalidate hash
  }

  append(other = "") {
    const otherLen = other.length;
    const newLen   = this.#length + otherLen;
    this.#grow(newLen);
    alloc.copy(
      __u8_offset(this.#buf, this.#length),
      other,
      otherLen);
    this.#length = newLen;
    this.#hash   = u32(0);
  }

  // ============================================================
  // Internal: grow buffer to at least `need` bytes
  // ============================================================
  #grow(need = usize(0)) {
    if (need <= this.#capacity) return;
    let newCap = this.#capacity;
    while (newCap < need) { newCap = newCap * usize(2); }
    this.#buf      = alloc.realloc(this.#buf, newCap);
    this.#capacity = newCap;
  }

  // ============================================================
  // Read ops — mirrors str API
  // ============================================================
  at(i = usize(0)) {
    if (i >= this.#length) return "";
    return __char_at(this.#buf, i);   // compiler intrinsic
  }

  slice(start = usize(0), end = usize(0)) {
    const s = new String("");
    if (end > this.#length) { let end = this.#length; }
    if (start >= end) return s;
    const len = end - start;
    s.#grow(len);
    alloc.copy(s.#buf, __u8_offset(this.#buf, start), len);
    s.#length = len;
    return s;
  }

  indexOf(needle = "") {
    const nl = needle.length;
    if (nl > this.#length) return -1;
    const limit = this.#length - nl;
    for (let i = usize(0); i <= limit; i++) {
      if (__mem_eq(this.#buf, i, needle, usize(0), nl)) return isize(i);
    }
    return isize(-1);
  }

  includes   (s = "")              { return this.indexOf(s) >= 0; }
  startsWith (s = "")              { return this.indexOf(s) == 0; }
  endsWith   (s = "") {
    const idx = isize(this.#length) - isize(s.length);
    if (idx < 0) return false;
    return __mem_eq(this.#buf, usize(idx), s, usize(0), s.length);
  }

  trim()      { return this.#trimImpl(true, true);  }
  trimStart() { return this.#trimImpl(true, false); }
  trimEnd()   { return this.#trimImpl(false, true); }

  #trimImpl(left = true, right = true) {
    let lo = usize(0);
    let hi = this.#length;
    if (left)  { while (lo < hi && __is_whitespace(this.#buf, lo)) { lo++; } }
    if (right) { while (hi > lo && __is_whitespace(this.#buf, hi - usize(1))) { hi--; } }
    return this.slice(lo, hi);
  }

  toUpperCase() { return __str_case(this, true);  }
  toLowerCase() { return __str_case(this, false); }

  replace(from = "", to = "") {
    const idx = this.indexOf(from);
    if (idx < 0) return this.slice(usize(0), this.#length);
    const before = this.slice(usize(0), usize(idx));
    const after  = this.slice(usize(idx) + from.length, this.#length);
    const result = new String(before.asStr());
    result.append(to);
    result.append(after.asStr());
    return result;
  }

  padStart(width = usize(0), fill = " ") {
    if (this.#length >= width) return this.slice(usize(0), this.#length);
    const pad = width - this.#length;
    const s = new String("");
    for (let i = usize(0); i < pad; i++) { s.append(fill); }
    s.append(this.asStr());
    return s;
  }

  padEnd(width = usize(0), fill = " ") {
    if (this.#length >= width) return this.slice(usize(0), this.#length);
    const s = this.slice(usize(0), this.#length);
    const pad = width - this.#length;
    for (let i = usize(0); i < pad; i++) { s.append(fill); }
    return s;
  }

  repeat(n = usize(0)) {
    const s = new String("");
    for (let i = usize(0); i < n; i++) { s.append(this.asStr()); }
    return s;
  }

  split(sep = "") {
    const result = [new String("")];
    const sl = sep.length;
    let  prev = usize(0);
    for (let i = usize(0); i + sl <= this.#length; i++) {
      if (__mem_eq(this.#buf, i, sep, usize(0), sl)) {
        result.push(this.slice(prev, i));
        i += sl;
        prev = i;
        i--;
      }
    }
    result.push(this.slice(prev, this.#length));
    return result;
  }

  // ============================================================
  // Hash — FNV-1a 32-bit, cached
  // ============================================================
  //@symbol(Symbol.hash)
  hash() {
    if (this.#hash != u32(0)) return isize(this.#hash);
    let h = u32(2166136261);
    for (let i = usize(0); i < this.#length; i++) {
      h ^= u32(i32_load8_u(usize(this.#buf) + i));
      h *= u32(16777619);
    }
    if (h == u32(0)) { h = u32(1); }  // 0 is reserved for "not computed"
    this.#hash = h;
    return isize(h);
  }

  //@symbol(Symbol.equals)
  equals(other = String) {
    if (this.#length != other.#length) return false;
    return __mem_eq(this.#buf, usize(0), other.#buf, usize(0), this.#length);
  }

  //@symbol(Symbol.toStr)
  toStr() { return this.asStr(); }

  //@symbol(Symbol.dispose)
  dispose() { alloc.free(this.#buf); }

  // ============================================================
  // Static constructors
  // ============================================================

  // fromCodePoint — single Unicode codepoint to String
  static fromCodePoint(cp = u32(0)) {
    return new String(__char_from_codepoint(cp));  // compiler intrinsic
  }

  // Note: String.from and String.fromBool are removed.
  // Use template literals for all number/bool → String conversions:
  //   `${n}`   `${b}`   `${obj}`  (obj must implement Symbol.toStr)
}

export default String;
```

### 24.4 `std/mem`
```js
// std/mem — Manual memory management.
// Import what you need:
//   import { ptr, alloc } from "std/mem";
//   import { ptr } from "std/mem";
//   import { alloc } from "std/mem";

import {
  i32_load, i32_store, i64_load, i64_store,
  f32_load, f32_store, f64_load, f64_store,
  memory_copy, memory_fill
} from "std/wasm";

// ── ptr ────────────────────────────────────────────────────
// ptr() boxes any value onto the heap, giving it a stable address.
// The box itself is GC-managed (refcounted). The value is accessed
// and mutated via .val. ptr is both callable and a namespace.
//
// ptr(value)                    → Ptr<T>   box a scalar or object
// ptr.fromAddr(addr, typeAnchor)→ Ptr<T>   interpret raw address as T
// ptr.diff(a, b)                → isize    a.addr - b.addr (signed)
//
// Ptr<T> fields:
//   .val          T       read/write the boxed value
//   .addr         usize   raw byte address of the box (read only)
//
// These are compiler builtins — the bodies below anchor return types only.

export function ptr(value = 0) { return ptr(value); }      // compiler replaces
// ptr.fromAddr and ptr.diff are compiler builtins on the ptr namespace

// ── alloc ─────────────────────────────────────────────────
// alloc.create(Type [, args | {named}])  → T?   manual, sentinel header
// alloc.free(obj)                        → void  calls dispose, returns to pool
// alloc.bytes(n)                         → u8?   raw byte buffer
// alloc.realloc(ptr, oldN, newN)         → u8?   grow/shrink raw buffer
// alloc.copy(dst, src, n)                → void  memcopy
// alloc.fill(dst, val, n)                → void  memfill
// alloc.arena(capacity)                  → Arena
// alloc.pool(Type, capacity)             → Pool<T>
//
// All backed by runtime WAT functions via __jswat_* imports.
// The compiler synthesises the correct __jswat_alloc / __jswat_pool_alloc
// call for each alloc.create / pool.alloc call site.

//@external("__jswat", "alloc")
function __alloc(sz = usize(0)) { return usize(0); }

//@external("__jswat", "gc_alloc")
function __gcAlloc(sz = usize(0)) { return usize(0); }

//@external("__jswat", "free")
function __free(ptr = usize(0), sz = usize(0)) { }

//@external("__jswat", "alloc_bytes")
function __allocBytes(n = usize(0)) { return usize(0); }

//@external("__jswat", "realloc")
function __realloc(ptr = usize(0), old = usize(0), newSz = usize(0)) { return usize(0); }

//@external("__jswat", "memcopy")
function __memcopy(dst = usize(0), src = usize(0), n = usize(0)) { }

//@external("__jswat", "memfill")
function __memfill(dst = usize(0), v = i32(0), n = usize(0)) { }

//@external("__jswat", "arena_new")
function __arenaNew(cap = usize(0)) { return usize(0); }

//@external("__jswat", "arena_alloc_bytes")
function __arenaAllocBytes(arena = usize(0), n = usize(0)) { return usize(0); }

//@external("__jswat", "arena_reset")
function __arenaReset(arena = usize(0)) { }

//@external("__jswat", "arena_used")
function __arenaUsed(arena = usize(0)) { return usize(0); }

//@external("__jswat", "arena_capacity")
function __arenaCapacity(arena = usize(0)) { return usize(0); }

//@external("__jswat", "pool_new")
function __poolNew(stride = usize(0), cap = usize(0)) { return usize(0); }

//@external("__jswat", "pool_alloc")
function __poolAlloc(pool = usize(0)) { return usize(0); }

//@external("__jswat", "pool_free")
function __poolFree(pool = usize(0), slot = usize(0)) { }

//@external("__jswat", "pool_available")
function __poolAvailable(pool = usize(0)) { return usize(0); }

//@external("__jswat", "pool_capacity")
function __poolCapacity(pool = usize(0)) { return usize(0); }

// Arena — bump allocator. Returned by alloc.arena().
// arena.alloc(Type [,...]) and arena.bytes(n) are compiler-synthesised.
class Arena {
  #handle;  // raw WAT arena pointer
  constructor(handle = usize(0)) { this.#handle = handle; }

  // arena.alloc(Type, ...) — compiler synthesises call to __arenaAllocBytes
  // then writes the object into that region with sentinel header

  bytes(n = usize(0)) {
    return __arenaAllocBytes(this.#handle, n);
  }

  reset()              { __arenaReset(this.#handle); }
  used()               { return __arenaUsed(this.#handle); }      // usize
  capacity()           { return __arenaCapacity(this.#handle); }  // usize
}

// Pool<T> — fixed-size free-list allocator.
// Returned by alloc.pool(Type, capacity).
// pool.alloc([...] | {named} | ) — compiler synthesises.
class Pool {
  #handle;
  constructor(handle = usize(0)) { this.#handle = handle; }

  free(obj = usize(0))   { __poolFree(this.#handle, obj); }
  available()            { return __poolAvailable(this.#handle); } // usize
  capacity()             { return __poolCapacity(this.#handle); }  // usize
}

// alloc namespace — compiler recognises these names as allocation sites
// and synthesises the correct typed calls. Exposed here for documentation.
export const alloc = {
  // create(Type [,...args | {named}]) → T?
  // Compiler lowers to: __alloc(Type.byteSize) + constructor call
  create: null,

  // free(obj) → void
  // Compiler lowers to: dispose(obj) + __free(obj, Type.byteSize)
  free: null,

  // bytes(n) → u8?
  bytes(n = usize(0)) { return __allocBytes(n); },

  // realloc(buf, oldN, newN) → u8?
  realloc(buf = u8, oldN = usize(0), newN = usize(0)) {
    return __realloc(usize(buf), oldN, newN);
  },

  // copy(dst, src, n) → void
  copy(dst = u8, src = u8, n = usize(0)) {
    __memcopy(usize(dst), usize(src), n);
  },

  // fill(dst, val, n) → void
  fill(dst = u8, val = u8(0), n = usize(0)) {
    __memfill(usize(dst), i32(val), n);
  },

  // arena(capacity) → Arena
  arena(capacity = usize(0)) {
    return new Arena(__arenaNew(capacity));
  },

  // pool(Type, capacity) → Pool<T>
  // Compiler knows Type.byteSize at call site
  pool: null,
};
```

### 24.5 `std/range`
```js
// std/range — Range and StepRange
// Version 1.3

// Range — half-open integer interval [start, end)
// Implements Symbol.iterator and Symbol.next.
// Monomorphizes for any Integer subtype.

class RangeIter {
  #cur;
  #end;

  constructor(cur = isize(0), end = isize(0)) {
    this.#cur = cur;
    this.#end = end;
  }

  //@symbol(Symbol.next)
  next() {
    if (this.#cur < this.#end) {
      const val = this.#cur;
      this.#cur++;
      return new IteratorResult(val, false);
    }
    return new IteratorResult(this.#end, true);
  }
}

export class Range {
  start;
  end;

  constructor(start = isize(0), end = isize(0)) {
    this.start = start;
    this.end   = end;
  }

  //@symbol(Symbol.iterator)
  iter() { return new RangeIter(this.start, this.end); }

  get size() { return this.end > this.start ? this.end - this.start : isize(0); }

  includes(n = isize(0)) { return n >= this.start && n < this.end; }
}

// ============================================================
// StepRange — Range with step size, may be negative
// ============================================================

class StepRangeIter {
  #cur;
  #end;
  #step;

  constructor(cur = isize(0), end = isize(0), step = isize(1)) {
    this.#cur  = cur;
    this.#end  = end;
    this.#step = step;
  }

  //@symbol(Symbol.next)
  next() {
    const done = this.#step > isize(0)
      ? this.#cur >= this.#end
      : this.#cur <= this.#end;
    if (!done) {
      const val = this.#cur;
      this.#cur += this.#step;
      return new IteratorResult(val, false);
    }
    return new IteratorResult(this.#cur, true);
  }
}

export class StepRange {
  start;
  end;
  step;

  constructor(start = isize(0), end = isize(0), step = isize(1)) {
    this.start = start;
    this.end   = end;
    this.step  = step;
  }

  //@symbol(Symbol.iterator)
  iter() { return new StepRangeIter(this.start, this.end, this.step); }
}
```

### 24.6 `std/iter`
```js
// std/iter — iterator combinators
// Version 1.3
//
// iter(iterable) returns an Iter<T> wrapper with chainable methods.
// All combinators are lazy — no allocation until collect/forEach.

class Iter {
  // Anchor the source iterable type
  #src;

  constructor(src = Symbol.iterator) { this.#src = src; }

  // Lazy map
  map(fn = (x = 0) => x) {
    return new MappedIter(this.#src, fn);
  }

  // Lazy filter
  filter(pred = (x = 0) => true) {
    return new FilteredIter(this.#src, pred);
  }

  // Lazy take
  take(n = usize(0)) {
    return new TakenIter(this.#src, n);
  }

  // Lazy skip
  skip(n = usize(0)) {
    return new SkippedIter(this.#src, n);
  }

  // Eager: reduce to a single value
  reduce(fn = (acc = 0, x = 0) => acc, init = 0) {
    let acc = init;
    for (const x of this.#src) { acc = fn(acc, x); }
    return acc;
  }

  // Eager: collect into array
  collect() {
    const result = [this.#src.iter().next().value];
    result.pop();
    for (const x of this.#src) { result.push(x); }
    return result;
  }

  // Eager: forEach
  forEach(fn = (x = 0) => {}) {
    for (const x of this.#src) { fn(x); }
  }

  // Eager: count
  count() {
    let n = usize(0);
    for (const _ of this.#src) { n++; }
    return n;
  }

  // Eager: find first match
  find(pred = (x = 0) => true) {
    for (const x of this.#src) {
      if (pred(x)) return x;
    }
    return null;
  }

  // Eager: any
  any(pred = (x = 0) => true) {
    for (const x of this.#src) { if (pred(x)) return true; }
    return false;
  }

  // Eager: all
  all(pred = (x = 0) => true) {
    for (const x of this.#src) { if (!pred(x)) return false; }
    return true;
  }

  // Eager: sum (numeric only)
  sum() {
    let s = 0;
    for (const x of this.#src) { s += x; }
    return s;
  }

  // Eager: min / max
  min() {
    let first = true;
    let result = 0;
    for (const x of this.#src) {
      if (first || x < result) { result = x; first = false; }
    }
    return result;
  }

  max() {
    let first = true;
    let result = 0;
    for (const x of this.#src) {
      if (first || x > result) { result = x; first = false; }
    }
    return result;
  }

  //@symbol(Symbol.iterator)
  iter() { return this.#src.iter(); }
}

// ---- Lazy wrapper types ----

class MappedIter {
  #src; #fn;
  constructor(src = Symbol.iterator, fn = (x = 0) => x) { this.#src = src; this.#fn = fn; }

  //@symbol(Symbol.iterator)
  iter() { return new MappedIterState(this.#src.iter(), this.#fn); }
}

class MappedIterState {
  #inner; #fn;
  constructor(inner = Symbol.next, fn = (x = 0) => x) { this.#inner = inner; this.#fn = fn; }

  //@symbol(Symbol.next)
  next() {
    const r = this.#inner.next();
    if (r.done) return r;
    return new IteratorResult(this.#fn(r.value), false);
  }
}

class FilteredIter {
  #src; #pred;
  constructor(src = Symbol.iterator, pred = (x = 0) => true) { this.#src = src; this.#pred = pred; }

  //@symbol(Symbol.iterator)
  iter() { return new FilteredIterState(this.#src.iter(), this.#pred); }
}

class FilteredIterState {
  #inner; #pred;
  constructor(inner = Symbol.next, pred = (x = 0) => true) { this.#inner = inner; this.#pred = pred; }

  //@symbol(Symbol.next)
  next() {
    while (true) {
      const r = this.#inner.next();
      if (r.done) return r;
      if (this.#pred(r.value)) return r;
    }
  }
}

class TakenIter {
  #src; #n;
  constructor(src = Symbol.iterator, n = usize(0)) { this.#src = src; this.#n = n; }

  //@symbol(Symbol.iterator)
  iter() { return new TakenIterState(this.#src.iter(), this.#n); }
}

class TakenIterState {
  #inner; #remaining;
  constructor(inner = Symbol.next, n = usize(0)) { this.#inner = inner; this.#remaining = n; }

  //@symbol(Symbol.next)
  next() {
    if (this.#remaining == usize(0)) return new IteratorResult(0, true);
    this.#remaining--;
    return this.#inner.next();
  }
}

class SkippedIter {
  #src; #n;
  constructor(src = Symbol.iterator, n = usize(0)) { this.#src = src; this.#n = n; }

  //@symbol(Symbol.iterator)
  iter() { return new SkippedIterState(this.#src.iter(), this.#n); }
}

class SkippedIterState {
  #inner; #skip;
  constructor(inner = Symbol.next, n = usize(0)) { this.#inner = inner; this.#skip = n; }

  //@symbol(Symbol.next)
  next() {
    while (this.#skip > usize(0)) {
      this.#inner.next();
      this.#skip--;
    }
    return this.#inner.next();
  }
}

// ---- Entry point ----

export function iter(src = Symbol.iterator) {
  return new Iter(src);
}
```

### 24.7 `std/collections`
```js
// std/collections — Map, Set, Queue, Stack, Deque
// Version 1.3
//
// Map and Set use open-addressing hash tables with
// Robin Hood probing. Keys must implement Symbol.hash
// and Symbol.equals.
//
// Queue, Stack, Deque are ring-buffer based.

import String from "std/string";

// ============================================================
// Map<K, V> — hash table, open addressing, Robin Hood probing
//
// Requires K to implement:
//   Symbol.hash   -> isize
//   Symbol.equals -> bool
//
// Bucket layout: flat arrays (parallel arrays for key/value/psl)
//   psl: probe sequence length (0 = empty, -1 = tombstone)
// ============================================================

class Map {
  #keys;      // K?[]   — nullable array of keys
  #vals;      // V?[]   — nullable array of values
  #psls;      // i32[]  — probe sequence lengths
  #size;      // usize  — number of live entries
  #cap;       // usize  — current bucket count (power of 2)

  // K and V types anchored by constructor usage.
  // The constructor takes sentinel key/value to lock types.
  constructor(key = Symbol.hash, val = 0) {
    this.#cap  = usize(16);
    this.#size = usize(0);
    this.#keys = Array.filled(this.#cap, key);
    this.#vals = Array.filled(this.#cap, val);
    this.#psls = Array.filled(this.#cap, i32(0));
  }

  get size() { return this.#size; }

  // ----------------------------------------------------------------
  // Internal: hash to bucket index
  // ----------------------------------------------------------------
  #bucket(h = isize(0)) {
    // cap is power of 2 — use & instead of %
    return usize(h) & (this.#cap - usize(1));
  }

  // ----------------------------------------------------------------
  // get(key) -> V?
  // ----------------------------------------------------------------
  get(k = Symbol.hash) {
    const h = k.hash();
    let   b = this.#bucket(h);
    let   psl = i32(0);

    while (true) {
      const entry_psl = this.#psls[b];
      if (entry_psl == i32(0)) return null;     // empty slot
      if (psl > entry_psl)     return null;     // Robin Hood invariant: would have displaced
      if (this.#keys[b].equals(k)) return this.#vals[b];
      b = (b + usize(1)) & (this.#cap - usize(1));
      psl++;
    }
  }

  has(k = Symbol.hash) { return this.get(k) != null; }

  // ----------------------------------------------------------------
  // set(key, val)
  // ----------------------------------------------------------------
  set(k = Symbol.hash, v = 0) {
    // Grow at 75% load
    if (this.#size * usize(4) >= this.#cap * usize(3)) {
      this.#resize(this.#cap * usize(2));
    }

    const h = k.hash();
    let   b = this.#bucket(h);
    let   psl = i32(1);    // 1-based (0 = empty sentinel)
    let   curKey = k;
    let   curVal = v;

    while (true) {
      const slot_psl = this.#psls[b];

      if (slot_psl == i32(0)) {
        // Empty slot — insert
        this.#keys[b] = curKey;
        this.#vals[b] = curVal;
        this.#psls[b] = psl;
        this.#size++;
        return;
      }

      if (this.#keys[b].equals(curKey)) {
        // Update existing
        this.#vals[b] = curVal;
        return;
      }

      if (psl > slot_psl) {
        // Robin Hood: steal the rich slot, continue with displaced entry
        const tmpK = this.#keys[b];
        const tmpV = this.#vals[b];
        const tmpP = this.#psls[b];
        this.#keys[b] = curKey;
        this.#vals[b] = curVal;
        this.#psls[b] = psl;
        curKey = tmpK;
        curVal = tmpV;
        psl = tmpP;
      }

      b = (b + usize(1)) & (this.#cap - usize(1));
      psl++;
    }
  }

  // ----------------------------------------------------------------
  // delete(key) -> bool
  // ----------------------------------------------------------------
  delete(k = Symbol.hash) {
    const h = k.hash();
    let   b = this.#bucket(h);
    let   psl = i32(1);

    while (true) {
      const slot_psl = this.#psls[b];
      if (slot_psl == i32(0)) return false;
      if (psl > slot_psl)     return false;
      if (this.#keys[b].equals(k)) {
        // Backward shift deletion
        let cur = b;
        while (true) {
          const next = (cur + usize(1)) & (this.#cap - usize(1));
          const next_psl = this.#psls[next];
          if (next_psl <= i32(1)) {
            this.#psls[cur] = i32(0);
            break;
          }
          this.#keys[cur] = this.#keys[next];
          this.#vals[cur] = this.#vals[next];
          this.#psls[cur] = next_psl - i32(1);
          cur = next;
        }
        this.#size--;
        return true;
      }
      b = (b + usize(1)) & (this.#cap - usize(1));
      psl++;
    }
  }

  // ----------------------------------------------------------------
  // Internal: resize to newCap (must be power of 2)
  // ----------------------------------------------------------------
  #resize(newCap = usize(0)) {
    const oldKeys = this.#keys;
    const oldVals = this.#vals;
    const oldPsls = this.#psls;
    const oldCap  = this.#cap;

    this.#cap  = newCap;
    this.#size = usize(0);
    this.#keys = Array.filled(newCap, this.#keys[usize(0)]);
    this.#vals = Array.filled(newCap, this.#vals[usize(0)]);
    this.#psls = Array.filled(newCap, i32(0));

    for (let i = usize(0); i < oldCap; i++) {
      if (oldPsls[i] != i32(0)) {
        this.set(oldKeys[i], oldVals[i]);
      }
    }
  }

  // ----------------------------------------------------------------
  // Iteration — yields [K, V] pairs as IteratorResult
  // ----------------------------------------------------------------
  //@symbol(Symbol.iterator)
  iter() { return new MapIter(this.#keys, this.#vals, this.#psls, this.#cap); }
}

class MapIter {
  #keys; #vals; #psls; #cap; #i;

  constructor(keys = [Symbol.hash], vals = [0], psls = [i32(0)], cap = usize(0)) {
    this.#keys = keys;
    this.#vals = vals;
    this.#psls = psls;
    this.#cap  = cap;
    this.#i    = usize(0);
  }

  //@symbol(Symbol.next)
  next() {
    while (this.#i < this.#cap) {
      const i = this.#i;
      this.#i++;
      if (this.#psls[i] != i32(0)) {
        return new IteratorResult(new MapEntry(this.#keys[i], this.#vals[i]), false);
      }
    }
    return new IteratorResult(new MapEntry(this.#keys[usize(0)], this.#vals[usize(0)]), true);
  }
}

class MapEntry {
  key; val;
  constructor(key = Symbol.hash, val = 0) { this.key = key; this.val = val; }
}

// ============================================================
// Set<T> — wraps Map<T, bool>
// ============================================================

class Set {
  #map;

  constructor(elem = Symbol.hash) {
    this.#map = new Map(elem, false);
  }

  get size()              { return this.#map.size; }
  add   (v = Symbol.hash) { this.#map.set(v, true); }
  has   (v = Symbol.hash) { return this.#map.has(v); }
  delete(v = Symbol.hash) { return this.#map.delete(v); }

  //@symbol(Symbol.iterator)
  iter() { return new SetIter(this.#map.iter()); }
}

class SetIter {
  #inner;
  constructor(inner = MapIter) { this.#inner = inner; }

  //@symbol(Symbol.next)
  next() {
    const r = this.#inner.next();
    return new IteratorResult(r.value.key, r.done);
  }
}

// ============================================================
// Stack<T> — LIFO, backed by dynamic array
// ============================================================

export class Stack {
  #items;
  #size;

  constructor(elem = 0) {
    this.#items = [elem];
    this.#items.pop();   // start empty but typed
    this.#size = usize(0);
  }

  push(item = 0)  { this.#items.push(item); this.#size++; }

  pop() {
    if (this.#size == usize(0)) return null;
    this.#size--;
    return this.#items.pop();
  }

  peek() {
    if (this.#size == usize(0)) return null;
    return this.#items[this.#size - usize(1)];
  }

  get size()  { return this.#size; }
  get empty() { return this.#size == usize(0); }
}

// ============================================================
// Queue<T> — FIFO ring buffer
// ============================================================

export class Queue {
  #buf;
  #head;   // usize — index of front element
  #tail;   // usize — index of next write slot
  #size;   // usize — number of elements
  #cap;    // usize — buffer capacity

  constructor(elem = 0) {
    this.#cap  = usize(8);
    this.#buf  = Array.filled(this.#cap, elem);
    this.#head = usize(0);
    this.#tail = usize(0);
    this.#size = usize(0);
  }

  enqueue(item = 0) {
    if (this.#size == this.#cap) { this.#grow(); }
    this.#buf[this.#tail] = item;
    this.#tail = (this.#tail + usize(1)) % this.#cap;
    this.#size++;
  }

  dequeue() {
    if (this.#size == usize(0)) return null;
    const item = this.#buf[this.#head];
    this.#head = (this.#head + usize(1)) % this.#cap;
    this.#size--;
    return item;
  }

  peek() {
    if (this.#size == usize(0)) return null;
    return this.#buf[this.#head];
  }

  get size()  { return this.#size; }
  get empty() { return this.#size == usize(0); }

  #grow() {
    const newCap = this.#cap * usize(2);
    const newBuf = Array.filled(newCap, this.#buf[usize(0)]);
    for (let i = usize(0); i < this.#size; i++) {
      newBuf[i] = this.#buf[(this.#head + i) % this.#cap];
    }
    this.#buf  = newBuf;
    this.#head = usize(0);
    this.#tail = this.#size;
    this.#cap  = newCap;
  }
}

// ============================================================
// Deque<T> — double-ended queue, ring buffer
// ============================================================

export class Deque {
  #buf;
  #head;
  #tail;
  #size;
  #cap;

  constructor(elem = 0) {
    this.#cap  = usize(8);
    this.#buf  = Array.filled(this.#cap, elem);
    this.#head = usize(0);
    this.#tail = usize(0);
    this.#size = usize(0);
  }

  pushFront(item = 0) {
    if (this.#size == this.#cap) { this.#grow(); }
    this.#head = (this.#head + this.#cap - usize(1)) % this.#cap;
    this.#buf[this.#head] = item;
    this.#size++;
  }

  pushBack(item = 0) {
    if (this.#size == this.#cap) { this.#grow(); }
    this.#buf[this.#tail] = item;
    this.#tail = (this.#tail + usize(1)) % this.#cap;
    this.#size++;
  }

  popFront() {
    if (this.#size == usize(0)) return null;
    const item = this.#buf[this.#head];
    this.#head = (this.#head + usize(1)) % this.#cap;
    this.#size--;
    return item;
  }

  popBack() {
    if (this.#size == usize(0)) return null;
    this.#tail = (this.#tail + this.#cap - usize(1)) % this.#cap;
    this.#size--;
    return this.#buf[this.#tail];
  }

  peekFront() {
    if (this.#size == usize(0)) return null;
    return this.#buf[this.#head];
  }

  peekBack() {
    if (this.#size == usize(0)) return null;
    return this.#buf[(this.#tail + this.#cap - usize(1)) % this.#cap];
  }

  get size()  { return this.#size; }
  get empty() { return this.#size == usize(0); }

  #grow() {
    const newCap = this.#cap * usize(2);
    const newBuf = Array.filled(newCap, this.#buf[usize(0)]);
    for (let i = usize(0); i < this.#size; i++) {
      newBuf[i] = this.#buf[(this.#head + i) % this.#cap];
    }
    this.#buf  = newBuf;
    this.#head = usize(0);
    this.#tail = this.#size;
    this.#cap  = newCap;
  }
}

export { Map, Set };
```

### 24.8 `std/random`
```js
// std/random — xoshiro256** PRNG
// Version 1.3
//
// WASI path: wasi_snapshot_preview1.random_get for seeding.
// WASI-free: falls back to seed(0) — deterministic.
// Math.random() is an alias to the global Random instance.

import { i64_rotl } from "std/wasm";

// WASI extern — stubbed to no-op in WASI-free environments
//@external("wasi_snapshot_preview1", "random_get")
function wasi_random_get(buf = usize(0), len = usize(0)) { return i32(0); }

class Random {
  // xoshiro256** state — four u64 words
  #s0; #s1; #s2; #s3;

  constructor(seed = isize(0)) {
    // Splitmix64 to derive initial state from seed
    this.#s0 = Random.#splitmix(i64(seed));
    this.#s1 = Random.#splitmix(this.#s0);
    this.#s2 = Random.#splitmix(this.#s1);
    this.#s3 = Random.#splitmix(this.#s2);
  }

  static #splitmix(x = i64(0)) {
    let z = x + i64(0x9E3779B97F4A7C15);
    z = (z ^ (z >> i64(30))) * i64(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> i64(27))) * i64(0x94D049BB133111EB);
    return z ^ (z >> i64(31));
  }

  // xoshiro256** next raw u64
  #next() {
    const result = i64_rotl(this.#s1 * i64(5), i64(7)) * i64(9);
    const t = this.#s1 << i64(17);
    this.#s2 ^= this.#s0;
    this.#s3 ^= this.#s1;
    this.#s1 ^= this.#s2;
    this.#s0 ^= this.#s3;
    this.#s2 ^= t;
    this.#s3 = i64_rotl(this.#s3, i64(45));
    return result;
  }

  // float() — f64 in [0.0, 1.0)
  // Technique: set exponent bits to 1023 (value in [1,2)), subtract 1.0
  float() {
    const bits = (this.#next() >> i64(12)) | i64(0x3FF0000000000000);
    return __reinterpret_f64(bits) - 1.0;
  }

  // int() — uniformly distributed isize
  int() { return isize(this.#next()); }

  // range(min, max) — inclusive isize
  range(min = isize(0), max = isize(0)) {
    const span = isize(max - min + isize(1));
    if (span <= isize(0)) return min;
    return min + isize(this.#next() % i64(span));
  }

  bool() { return (this.#next() >> i64(63)) == i64(1); }

  // Re-seed
  seed(s = isize(0)) {
    this.#s0 = Random.#splitmix(i64(s));
    this.#s1 = Random.#splitmix(this.#s0);
    this.#s2 = Random.#splitmix(this.#s1);
    this.#s3 = Random.#splitmix(this.#s2);
  }

  // ----------------------------------------------------------------
  // Global instance — seeded from WASI at startup if available
  // ----------------------------------------------------------------
  static #global = new Random(0);

  static #initGlobal() {
    // Attempt WASI seeding into a stack buffer
    // The compiler emits this call from _start before user code
    let buf = i64(0);
    const ok = wasi_random_get(usize(buf), usize(8));
    if (ok == i32(0)) {
      Random.#global = new Random(isize(buf));
    }
  }

  static float()        { return Random.#global.float(); }
  static int()          { return Random.#global.int();   }
  static range(lo = isize(0), hi = isize(0)) { return Random.#global.range(lo, hi); }
  static bool()         { return Random.#global.bool();  }
  static seed(s = isize(0)) { Random.#global.seed(s);   }
}

export default Random;
```

### 24.9 `std/error`
```js
// std/error — Error hierarchy
// Version 1.3

export class AppError {
  message;
  constructor(message = "") { this.message = message; }

  //@symbol(Symbol.toStr)
  toStr() { return this.message; }
}

export class ValueError extends AppError {
  constructor(message = "") { super(message); }
}

export class RangeError extends AppError {
  constructor(message = "") { super(message); }
}

export class IOError extends AppError {
  constructor(message = "") { super(message); }
}

export class ParseError extends AppError {
  field;
  constructor(message = "", field = "") { super(message); this.field = field; }
}

export class NotFoundError extends AppError {
  constructor(message = "") { super(message); }
}
```

### 24.10 `std/io`
```js
// std/io — console, stdout, stderr, stdin
// Version 1.3
//
// All functions degrade gracefully in WASI-free environments
// (silent no-op for writes, null for reads).

import String from "std/string";

// WASI externs
//@external("wasi_snapshot_preview1", "fd_write")
function wasi_fd_write(fd = i32(0), iovs = usize(0), iovs_len = usize(0), nwritten = usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "fd_read")
function wasi_fd_read(fd = i32(0), iovs = usize(0), iovs_len = usize(0), nread = usize(0)) { return i32(0); }

// ----------------------------------------------------------------
// Internal: write a str slice to an fd using iovec on the stack
// iovec layout: [ptr:4, len:4]
// The compiler provides __stack_alloc(n) for short-lived stack frames.
// ----------------------------------------------------------------
function fdWrite(fd = i32(1), s = "") {
  if (!__wasi_available) return;
  const iov = __stack_alloc(usize(8));   // 8-byte iovec on stack
  const ptr = usize(s);
  const len = usize(s.length);
  __stack_store_u32(iov, usize(0), u32(ptr));
  __stack_store_u32(iov, usize(4), u32(len));
  const nwritten = __stack_alloc(usize(4));
  wasi_fd_write(fd, iov, i32(1), nwritten);
}

function fdWriteString(fd = i32(1), s = String) {
  fdWrite(fd, s.asStr());
}

// ----------------------------------------------------------------
// Stdout
// ----------------------------------------------------------------
class Stdout {
  write(s = "")          { fdWrite(i32(1), s); }
  writeln(s = "")        { fdWrite(i32(1), s); fdWrite(i32(1), "\n"); }
  writeString(s = String){ fdWriteString(i32(1), s); }
}

// ----------------------------------------------------------------
// Stderr
// ----------------------------------------------------------------
class Stderr {
  write(s = "")          { fdWrite(i32(2), s); }
  writeln(s = "")        { fdWrite(i32(2), s); fdWrite(i32(2), "\n"); }
  writeString(s = String){ fdWriteString(i32(2), s); }
}

// ----------------------------------------------------------------
// Stdin
// ----------------------------------------------------------------
class Stdin {
  // Read up to maxBytes. Returns null if WASI unavailable.
  read(maxBytes = usize(1024)) {
    if (!__wasi_available) return null;
    const buf = alloc.bytes(maxBytes);
    const iov = __stack_alloc(usize(8));
    __stack_store_u32(iov, usize(0), u32(usize(buf)));
    __stack_store_u32(iov, usize(4), u32(maxBytes));
    const nread_ptr = __stack_alloc(usize(4));
    wasi_fd_read(i32(0), iov, i32(1), nread_ptr);
    const nread = usize(__stack_load_u32(nread_ptr, usize(0)));
    const result = new String("");
    result.append(__str_from_ptr(buf, nread));
    alloc.free(buf);
    return result;
  }

  // Read a single line (up to newline or EOF)
  readLine() {
    return this.read(usize(4096));
  }
}

// ----------------------------------------------------------------
// console — convenience wrapper matching browser/Node convention
// ----------------------------------------------------------------
class ConsoleClass {
  log(s = "")   { stdout.writeln(s); }
  error(s = "") { stderr.writeln(s); }
  warn(s = "")  { stderr.writeln(s); }
}

export const stdout = new Stdout;
export const stderr = new Stderr;
export const stdin  = new Stdin;
export const console = new ConsoleClass;
```

### 24.11 `std/fs`
```js
// std/fs — filesystem access via WASI
// Version 1.3
//
// Degrades gracefully: all functions return null/false in WASI-free.

import String from "std/string";

//@external("wasi_snapshot_preview1", "path_open")
function wasi_path_open(fd=i32(0),dirflags=i32(0),path=usize(0),path_len=usize(0),
                        oflags=i32(0),fs_rights_base=i64(0),fs_rights_inheriting=i64(0),
                        fdflags=i32(0),opened_fd=usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "fd_close")
function wasi_fd_close(fd = i32(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "fd_read")
function wasi_fd_read(fd=i32(0),iovs=usize(0),iovs_len=usize(0),nread=usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "fd_write")
function wasi_fd_write(fd=i32(0),iovs=usize(0),iovs_len=usize(0),nwritten=usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "path_unlink_file")
function wasi_path_unlink(dirfd=i32(0),path=usize(0),path_len=usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "path_create_directory")
function wasi_mkdir(dirfd=i32(0),path=usize(0),path_len=usize(0)) { return i32(0); }

// FS preopened root fd is always 3 in WASI preview1
const ROOT_FD = i32(3);

class FS {
  // Read entire file. Returns String? (null on error/unavailable).
  static read(path = "") {
    if (!__wasi_available) return null;
    const fd_slot = __stack_alloc(usize(4));
    const plen = usize(path.length);
    const pptr = usize(path);
    const ret = wasi_path_open(
      ROOT_FD, i32(0),
      pptr, plen,
      i32(0),             // oflags
      i64(0x02),          // rights: fd_read
      i64(0x02),
      i32(0),             // fdflags
      fd_slot);
    if (ret != i32(0)) return null;
    const fd = i32(__stack_load_u32(fd_slot, usize(0)));

    const bufSize = usize(65536);
    const buf = alloc.bytes(bufSize);
    const iov = __stack_alloc(usize(8));
    __stack_store_u32(iov, usize(0), u32(usize(buf)));
    __stack_store_u32(iov, usize(4), u32(bufSize));
    const nread_ptr = __stack_alloc(usize(4));
    wasi_fd_read(fd, iov, i32(1), nread_ptr);
    const nread = usize(__stack_load_u32(nread_ptr, usize(0)));
    wasi_fd_close(fd);

    const result = new String(__str_from_ptr(buf, nread));
    alloc.free(buf);
    return result;
  }

  // Write file. Returns bool success.
  static write(path = "", content = "") {
    if (!__wasi_available) return false;
    const fd_slot = __stack_alloc(usize(4));
    const plen = usize(path.length);
    const pptr = usize(path);
    // oflags: O_CREAT | O_TRUNC = 0x0001 | 0x0002 = 0x0003
    const ret = wasi_path_open(
      ROOT_FD, i32(0),
      pptr, plen,
      i32(0x0003),
      i64(0x40),          // rights: fd_write
      i64(0x40),
      i32(0),
      fd_slot);
    if (ret != i32(0)) return false;
    const fd = i32(__stack_load_u32(fd_slot, usize(0)));

    const clen = usize(content.length);
    const cptr = usize(content);
    const iov = __stack_alloc(usize(8));
    __stack_store_u32(iov, usize(0), u32(cptr));
    __stack_store_u32(iov, usize(4), u32(clen));
    const nwritten_ptr = __stack_alloc(usize(4));
    wasi_fd_write(fd, iov, i32(1), nwritten_ptr);
    wasi_fd_close(fd);
    return true;
  }

  static append(path = "", content = "") {
    if (!__wasi_available) return false;
    const existing = FS.read(path);
    if (existing != null) {
      existing.append(content);
      return FS.write(path, existing.asStr());
    }
    return FS.write(path, content);
  }

  static delete(path = "") {
    if (!__wasi_available) return false;
    return wasi_path_unlink(ROOT_FD, usize(path), usize(path.length)) == i32(0);
  }

  static mkdir(path = "") {
    if (!__wasi_available) return false;
    return wasi_mkdir(ROOT_FD, usize(path), usize(path.length)) == i32(0);
  }

  static exists(path = "") {
    if (!__wasi_available) return false;
    const content = FS.read(path);
    return content != null;
  }
}

export { FS };
```

### 24.12 `std/clock`
```js
// std/clock — wall clock and monotonic clock via WASI
// Version 1.3

//@external("wasi_snapshot_preview1", "clock_time_get")
function wasi_clock_time_get(id=i32(0), precision=i64(0), time=usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "sched_yield")
function wasi_sched_yield() { return i32(0); }

class Clock {
  // Returns nanoseconds since Unix epoch. 0 if WASI unavailable.
  static now() {
    if (!__wasi_available) return i64(0);
    const buf = __stack_alloc(usize(8));
    wasi_clock_time_get(i32(0), i64(1), buf);  // CLOCK_REALTIME = 0
    return __stack_load_i64(buf, usize(0));
  }

  // Returns nanoseconds from an arbitrary epoch. 0 if WASI unavailable.
  static monotonic() {
    if (!__wasi_available) return i64(0);
    const buf = __stack_alloc(usize(8));
    wasi_clock_time_get(i32(1), i64(1), buf);  // CLOCK_MONOTONIC = 1
    return __stack_load_i64(buf, usize(0));
  }

  // Returns milliseconds since epoch (f64 for JS compatibility)
  static nowMs() { return f64(Clock.now()) / 1_000_000.0; }

  // Sleep for nanoseconds (blocks — only useful in WASM threads or runtimes)
  static sleep(ns = i64(0)) {
    if (!__wasi_available) return;
    // WASI preview1 has no sleep — spin with sched_yield
    const start = Clock.monotonic();
    while (Clock.monotonic() - start < ns) { wasi_sched_yield(); }
  }

  // Sleep for milliseconds
  static sleepMs(ms = 0) { Clock.sleep(i64(ms) * i64(1_000_000)); }
}

export { Clock };
```

### 24.13 `std/process`
```js
// std/process — process exit, args, env
// Version 1.3

import String from "std/string";

//@external("wasi_snapshot_preview1", "proc_exit")
function wasi_proc_exit(code = i32(0)) { }

//@external("wasi_snapshot_preview1", "args_sizes_get")
function wasi_args_sizes_get(argc=usize(0), argv_buf_size=usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "args_get")
function wasi_args_get(argv=usize(0), argv_buf=usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "environ_sizes_get")
function wasi_environ_sizes_get(count=usize(0), buf_size=usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "environ_get")
function wasi_environ_get(environ=usize(0), environ_buf=usize(0)) { return i32(0); }

class Process {
  // Exit with code. Uses WASM unreachable if WASI unavailable.
  static exit(code = i32(0)) {
    if (__wasi_available) {
      wasi_proc_exit(code);
    }
    unreachable;   // compiler keyword — emits WASM unreachable instruction
  }

  // Returns command-line args as String[]. Empty array if unavailable.
  static args() {
    const result = [new String("")];
    result.pop();
    if (!__wasi_available) return result;

    const argc_ptr    = __stack_alloc(usize(4));
    const buf_sz_ptr  = __stack_alloc(usize(4));
    wasi_args_sizes_get(argc_ptr, buf_sz_ptr);
    const argc   = usize(__stack_load_u32(argc_ptr, usize(0)));
    const buf_sz = usize(__stack_load_u32(buf_sz_ptr, usize(0)));

    const argv_ptrs = alloc.bytes(argc * usize(4));
    const argv_buf  = alloc.bytes(buf_sz);
    wasi_args_get(usize(argv_ptrs), usize(argv_buf));

    for (let i = usize(0); i < argc; i++) {
      const ptr = usize(__u32_load(usize(argv_ptrs) + i * usize(4)));
      result.push(new String(__cstr_to_str(ptr)));
    }

    alloc.free(argv_ptrs);
    alloc.free(argv_buf);
    return result;
  }

  // Returns env var by name. Null if not found or WASI unavailable.
  static env(name = "") {
    if (!__wasi_available) return null;

    const count_ptr  = __stack_alloc(usize(4));
    const buf_sz_ptr = __stack_alloc(usize(4));
    wasi_environ_sizes_get(count_ptr, buf_sz_ptr);
    const count  = usize(__stack_load_u32(count_ptr, usize(0)));
    const buf_sz = usize(__stack_load_u32(buf_sz_ptr, usize(0)));

    const env_ptrs = alloc.bytes(count * usize(4));
    const env_buf  = alloc.bytes(buf_sz);
    wasi_environ_get(usize(env_ptrs), usize(env_buf));

    for (let i = usize(0); i < count; i++) {
      const ptr = usize(__u32_load(usize(env_ptrs) + i * usize(4)));
      const entry = __cstr_to_str(ptr);  // "KEY=VALUE"
      const eq = entry.indexOf("=");
      if (eq >= 0) {
        const key = entry.slice(usize(0), usize(eq));
        if (key == name) {
          const val = entry.slice(usize(eq) + usize(1), entry.length);
          alloc.free(env_ptrs);
          alloc.free(env_buf);
          return new String(val);
        }
      }
    }

    alloc.free(env_ptrs);
    alloc.free(env_buf);
    return null;
  }
}

export { Process };
```

### 24.14 `std/encoding`
```js
// std/encoding — Base64 and UTF-8 utilities
// Version 1.3

import String from "std/string";
import { i32_load8_u, i32_store8 } from "std/wasm";

// ============================================================
// Base64
// ============================================================

class Base64 {
  static #TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  // Encode raw bytes (u8?) to Base64 String
  static encode(buf = u8, len = usize(0)) {
    const outLen = ((len + usize(2)) / usize(3)) * usize(4);
    const out = alloc.bytes(outLen);
    let i = usize(0);
    let j = usize(0);

    while (i + usize(2) < len) {
      const b0 = u32(i32_load8_u(usize(buf) + i));
      const b1 = u32(i32_load8_u(usize(buf) + i + usize(1)));
      const b2 = u32(i32_load8_u(usize(buf) + i + usize(2)));
      i32_store8(usize(out) + j,             Base64.#idx((b0 >> u32(2)) & u32(0x3F)));
      i32_store8(usize(out) + j + usize(1),  Base64.#idx(((b0 & u32(3)) << u32(4)) | (b1 >> u32(4))));
      i32_store8(usize(out) + j + usize(2),  Base64.#idx(((b1 & u32(15)) << u32(2)) | (b2 >> u32(6))));
      i32_store8(usize(out) + j + usize(3),  Base64.#idx(b2 & u32(0x3F)));
      i += usize(3);
      j += usize(4);
    }

    const rem = len - i;
    if (rem == usize(1)) {
      const b0 = u32(i32_load8_u(usize(buf) + i));
      i32_store8(usize(out) + j,            Base64.#idx((b0 >> u32(2)) & u32(0x3F)));
      i32_store8(usize(out) + j + usize(1), Base64.#idx((b0 & u32(3)) << u32(4)));
      i32_store8(usize(out) + j + usize(2), u8(61));  // '='
      i32_store8(usize(out) + j + usize(3), u8(61));
    } else if (rem == usize(2)) {
      const b0 = u32(i32_load8_u(usize(buf) + i));
      const b1 = u32(i32_load8_u(usize(buf) + i + usize(1)));
      i32_store8(usize(out) + j,            Base64.#idx((b0 >> u32(2)) & u32(0x3F)));
      i32_store8(usize(out) + j + usize(1), Base64.#idx(((b0 & u32(3)) << u32(4)) | (b1 >> u32(4))));
      i32_store8(usize(out) + j + usize(2), Base64.#idx((b1 & u32(15)) << u32(2)));
      i32_store8(usize(out) + j + usize(3), u8(61));
    }

    const result = new String(__str_from_ptr(out, outLen));
    alloc.free(out);
    return result;
  }

  // Decode Base64 String to raw bytes. Returns u8?.
  // outLen receives decoded byte count via Ptr<usize>.
  static decode(s = "", outLen = ptr(usize(0))) {
    const inLen = s.length;
    const buf   = alloc.bytes((inLen / usize(4)) * usize(3));
    let   i = usize(0);
    let   j = usize(0);

    while (i + usize(3) < inLen) {
      const c0 = Base64.#val(usize(s), i);
      const c1 = Base64.#val(usize(s), i + usize(1));
      const c2 = Base64.#val(usize(s), i + usize(2));
      const c3 = Base64.#val(usize(s), i + usize(3));
      i32_store8(usize(buf) + j,            u8((c0 << u32(2)) | (c1 >> u32(4))));
      if (c2 != u32(64)) {
        i32_store8(usize(buf) + j + usize(1), u8(((c1 & u32(0xF)) << u32(4)) | (c2 >> u32(2))));
      }
      if (c3 != u32(64)) {
        i32_store8(usize(buf) + j + usize(2), u8(((c2 & u32(3)) << u32(6)) | c3));
      }
      i += usize(4);
      j += usize(3);
    }

    outLen.val = j;
    return buf;
  }

  static #idx(n = u32(0)) { return u8(i32_load8_u(usize(Base64.#TABLE) + usize(n))); }

  static #val(ptr = usize(0), i = usize(0)) {
    const c = u32(i32_load8_u(ptr + i));
    if (c >= u32(65) && c <= u32(90))  return c - u32(65);        // A-Z
    if (c >= u32(97) && c <= u32(122)) return c - u32(71);        // a-z
    if (c >= u32(48) && c <= u32(57))  return c + u32(4);         // 0-9
    if (c == u32(43)) return u32(62);                              // +
    if (c == u32(47)) return u32(63);                              // /
    return u32(64);                                                // = (pad)
  }
}

// ============================================================
// UTF8 — validation and codepoint iteration
// ============================================================

class UTF8 {
  // Validate a str is valid UTF-8. Returns bool.
  static validate(s = "") {
    let i = usize(0);
    const len = s.length;
    while (i < len) {
      const b = u32(i32_load8_u(usize(s) + i));
      let seqLen = usize(0);
      if (b < u32(0x80))       { seqLen = usize(1); }
      else if (b < u32(0xC0))  { return false; }      // continuation byte
      else if (b < u32(0xE0))  { seqLen = usize(2); }
      else if (b < u32(0xF0))  { seqLen = usize(3); }
      else if (b < u32(0xF8))  { seqLen = usize(4); }
      else                      { return false; }

      i++;
      let n = usize(1);
      while (n < seqLen) {
        if (i >= len) return false;
        const cb = u32(i32_load8_u(usize(s) + i));
        if ((cb & u32(0xC0)) != u32(0x80)) return false;
        i++;
        n++;
      }
    }
    return true;
  }

  // Count Unicode codepoints in a UTF-8 str
  static charCount(s = "") {
    let count = usize(0);
    const len = s.length;
    for (let i = usize(0); i < len; i++) {
      const b = u32(i32_load8_u(usize(s) + i));
      // Count only leading bytes (not 10xxxxxx continuation bytes)
      if ((b & u32(0xC0)) != u32(0x80)) { count++; }
    }
    return count;
  }
}

export { Base64, UTF8 };
```

### 24.15 `std/prelude`
```js
// std/prelude — convenient bundle import
// Version 1.3
//
// import "std/prelude"; brings in all commonly used stdlib items.
// Avoid in library code — prefer explicit imports.

import Math    from "std/math";
import String  from "std/string";
import Random  from "std/random";
import { Range, StepRange }              from "std/range";
import { iter }                          from "std/iter";
import { Map, Set, Stack, Queue, Deque } from "std/collections";
import { AppError, ValueError, RangeError,
         IOError, ParseError, NotFoundError } from "std/error";
import { console, stdout, stderr, stdin } from "std/io";
import { FS }      from "std/fs";
import { Clock }   from "std/clock";
import { Process } from "std/process";
import { Base64, UTF8 } from "std/encoding";

export {
  Math, String, Random,
  Range, StepRange, iter,
  Map, Set, Stack, Queue, Deque,
  AppError, ValueError, RangeError, IOError, ParseError, NotFoundError,
  console, stdout, stderr, stdin,
  FS, Clock, Process,
  Base64, UTF8
};
```

---

## 25. Errors

### 25.1 Philosophy

js.wat errors fall into three populations with distinct costs and recovery semantics:

```
Compile errors (CE)     — programmer mistakes caught statically. Zero runtime cost.
Runtime traps (RT)      — unrecoverable. Emit WASM unreachable. Module survives in
                          browser contexts (JS catches WebAssembly.RuntimeError).
Runtime exceptions (RX) — recoverable. WASM exception instructions. throw/catch/finally.
```

**Null dereference is UB.** The safe path is `?.` and `??`. If you use `.` on a nullable type you are asserting non-null — the compiler trusts you. In debug builds the compiler inserts a null check and traps with a message. In release builds the optimizer assumes `.` is never null, enabling zero-overhead field access. This is an intentional design decision — the cost of safety is always explicit in js.wat.

### 25.2 Updated Object Header

Every heap object carries a 12-byte header before its user fields:

```
Offset 0   rc_class    i32   bits[31:28]=size-class index, bits[27:0]=refcount
                              0xFFFFFFFF = manual sentinel (never GC-freed)
Offset 4   vtable_ptr  i32   pointer to vtable, 0 if no symbol methods
Offset 8   class_id    i32   unique u32 per class, compiler-assigned at build time
```

`class_id` is used by `instanceof`, `switch` type narrowing, and `catch` dispatch — all reduce to a single `i32.load offset=8` + `i32.eq`.

### 25.3 Compile-Time Errors (CE)

Error format: `file:line:col  CE-XXX  message\n  hint`

**Type errors:**

| Code | Condition | Example |
|---|---|---|
| CE-T01 | Type mismatch on assignment | `let x = u8(0); x = 300;` |
| CE-T02 | Implicit coercion — mixed types without explicit cast | `u8(0) + i32(0)` |
| CE-T03 | Out-of-range literal for target type | `u8(256)`, `u8(-1)` |
| CE-T04 | Nullable used where non-null required | `let x: Player = maybePlayer` |
| CE-T05 | `bool` used in numeric expression | `i32(true)` |
| CE-T06 | Abstract type instantiated | `new Integer`, `new Number` |
| CE-T07 | Wrong return type | `function f() { return 1; }` when return is `str` |
| CE-T08 | Missing return on reachable path | non-void function with exit path that falls off |
| CE-T09 | Class interpolated without `Symbol.toStr` | `` `${p}` `` where Player has no `Symbol.toStr` |

**Variable/binding errors:**

| Code | Condition | Example |
|---|---|---|
| CE-V01 | `const` reassignment | `const x = 1; x = 2;` |
| CE-V02 | Undeclared variable | `x + 1` with no `let x` |
| CE-V03 | Use before declaration | `x; let x = 0;` |
| CE-V04 | Duplicate declaration in same scope | `let x = 0; let x = 1;` |

**Class errors:**

| Code | Condition | Example |
|---|---|---|
| CE-C01 | Unknown key in named construction block | `new Vec2({ z: 1.0 })` |
| CE-C02 | Named block key type mismatch | `new Vec2({ x: i32(0) })` when x is f64 |
| CE-C03 | Private field accessed outside class | `p.#score` from outside Player |
| CE-C04 | Static-only class instantiated | `new IdGen` when all members are static |
| CE-C05 | `this` outside class method | `this.x` at top level |
| CE-C06 | `this` accessed before `super()` in child | `this.x = 1; super();` |
| CE-C07 | Setter without getter | `set x(v) { }` with no `get x()` |
| CE-C08 | Duplicate field or method name | two `score` fields |
| CE-C09 | Child class defines no-arg constructor that doesn't call `super()` | |

**Function errors:**

| Code | Condition | Example |
|---|---|---|
| CE-F01 | Parameter without default | `function f(x) { }` |
| CE-F02 | Wrong argument count | `add(1, 2, 3)` when `add` takes 2 |
| CE-F03 | Argument type mismatch | `add(1.0, 2)` when both params are `isize` |
| CE-F04 | `arguments` object used | `arguments[0]` |
| CE-F05 | Arrow function used as constructor | `new (() => {})()` |

**Control flow errors:**

| Code | Condition | Example |
|---|---|---|
| CE-CF01 | `for...in` used | `for (const k in obj)` |
| CE-CF02 | Switch fallthrough | implicit fall between cases |
| CE-CF03 | Non-exhaustive switch on tagged union | missing variant in `switch` |
| CE-CF04 | `break`/`continue` outside loop | `break;` at top level |
| CE-CF05 | Unreachable code after `return`/`throw`/`unreachable` | code after `return` |
| CE-CF06 | Ternary branches return different types | `true ? 1 : "a"` |

**Access errors:**

| Code | Condition | Example |
|---|---|---|
| CE-A01 | Bracket notation on non-array | `obj["key"]` |
| CE-A02 | `eval` / `Function()` / `new Function` | `eval("1+1")` |
| CE-A03 | Prototype access | `Player.prototype`, `obj.__proto__` |
| CE-A04 | Nested destructuring | `const { a: { b } } = obj` |
| CE-A05 | Destructuring of nullable without null check | `const { x } = maybePoint` |
| CE-A06 | `delete` on object property | `delete obj.x` |
| CE-A07 | `?.` on non-nullable type | `n?.toString()` where n is `i32` |

**Module errors:**

| Code | Condition | Example |
|---|---|---|
| CE-M01 | Import of non-existent export | `import { Foo } from "./bar"` — no Foo |
| CE-M02 | Circular import | `a → b → a` |
| CE-M03 | Bare specifier | `import x from "lodash"` |
| CE-M04 | `.wasm` import arity mismatch | declared 2 params, binary has 3 |
| CE-M05 | `.wasm` import type mismatch | declared `f64` return, binary returns `i32` |
| CE-M06 | Explicit import of prelude member | `import String from "std/string"` — warning |

**Pragma errors:**

| Code | Condition | Example |
|---|---|---|
| CE-P01 | Unknown pragma | `//@unknown` |
| CE-P02 | `//@symbol` on non-method | `//@symbol(Symbol.hash)` on a class |
| CE-P03 | `//@export` on non-function non-static | `//@export` on a field |
| CE-P04 | `//@ordered` on non-class | `//@ordered` on a function |
| CE-P05 | `//@external` missing module or name | `//@external("env")` — missing name |

### 25.4 Runtime Traps (RT)

Hard traps — emit `unreachable`. The current call terminates. In browser contexts the WASM module instance survives; in WASI contexts the process exits. No recovery, no cleanup, no `Symbol.dispose` calls for in-flight stack frames.

| Code | Condition | Debug behaviour | Release behaviour |
|---|---|---|---|
| RT-01 | OOM — `memory.grow` returns -1 | trap with message | trap |
| RT-02 | Pool exhausted — `pool.alloc()` on full pool | trap with message | trap |
| RT-03 | Fixed arena overflow | trap with message | trap |
| RT-04 | Call stack overflow | host-defined | host-defined |
| RT-05 | Programmer `unreachable` statement | trap with message | trap |
| RT-06 | Null dereference via `.` | trap with location | **UB — no check** |
| RT-07 | Array out-of-bounds (release) | trap with index | **UB — no check** |

RT-06 and RT-07 are the two UB cases — debug builds insert the check and trap with a useful message; release builds elide the check entirely and assume the condition never occurs.

### 25.5 Runtime Exceptions (RX)

Exceptions use WASM exception instructions (WASM 2.0). One shared exception tag carries the thrown object as an `i32` heap pointer:

```wat
(tag $jswat_exn (param i32))
```

**What can be thrown:** any class instance. The class must be accessible at the `throw` site.

**Stdlib exceptions thrown automatically:**

| Exception | Thrown by |
|---|---|
| `BoundsError extends AppError` | Array out-of-bounds in debug builds |
| `MathError extends AppError` | Integer divide by zero |
| `ParseError extends AppError` | `i32.parse`, `f64.parse` etc. on invalid input |
| `IOError extends AppError` | `FS.*`, `stdin.read` on WASI errors |
| `ValueError extends AppError` | Invalid radix in `.parse`, invalid argument |

**`throw` compilation:**

```js
throw new IOError("disk full");
```
Compiles to:
```wat
;; allocate + construct IOError on heap → ptr on stack
call $__jswat_rc_inc   ;; exception owns the reference
throw $jswat_exn       ;; takes i32 ptr from stack
```

**`catch` compilation:**

```js
try { riskyOp(); }
catch (e = IOError) { handle(e); }
catch (e = ParseError) { handle(e); }
```
Compiles to:
```wat
try
  call $riskyOp
catch $jswat_exn          ;; all js.wat exceptions land here, ptr on stack
  local.set $exn_ptr
  ;; try IOError
  local.get $exn_ptr
  i32.load offset=8       ;; read class_id
  i32.const CLASS_ID_IOError
  i32.eq
  if
    ...handle e as IOError...
  else
    ;; try ParseError
    local.get $exn_ptr
    i32.load offset=8
    i32.const CLASS_ID_ParseError
    i32.eq
    if
      ...handle e as ParseError...
    else
      local.get $exn_ptr
      throw $jswat_exn    ;; rethrow — not our type
    end
  end
end
```

**`finally` compilation** uses `catch_all` + `rethrow`:

```wat
try
  ...body...
catch_all
  ...finally body...
  rethrow 0
end
...finally body...   ;; also emitted on normal exit path
```

**Unwind cleanup:** every scope that owns heap references is wrapped in an implicit `catch_all` that emits `rc_dec` for all owned references before rethrowing. This ensures refcounts stay correct across exception unwind — `Symbol.dispose` is called normally when rc hits zero.

**Catch by superclass:** catching a base class catches all subclasses. The `class_id` check uses a compiler-generated table of subclass relationships resolved at compile time.

```js
catch (e = AppError) { }   // catches all AppError subclasses
```

---

## 26. String ↔ Number Conversions

### 26.1 Numbers to Strings — Template Literals

Template literal interpolation `` `${}` `` is the only way to convert a number to a string. `String.from` does not exist.

```js
let n = i32(42);
let s = `${n}`;              // "42" — String
let msg = `value is ${n}`;   // "value is 42" — String

let x = 3.14159;
let t = `${x}`;              // "3.14159" — shortest round-trip f64

let active = true;
let b = `${active}`;         // "true"
```

**Format per type:**

| Type | Format | Examples |
|---|---|---|
| `i8`–`isize` | Decimal, `-` for negatives | `"0"`, `"-42"`, `"127"` |
| `u8`–`usize` | Decimal, unsigned | `"0"`, `"255"`, `"4294967295"` |
| `f64` | Shortest round-trip decimal (Ryu) | `"3.14"`, `"1e100"`, `"0.1"` |
| `f32` | Shortest round-trip at f32 precision | `"3.14"` not `"3.1400001"` |
| `bool` | `"true"` or `"false"` | |
| `str` | Direct — zero copy, no allocation | |
| `String` | Copies content into output | |
| class with `Symbol.toStr` | Calls `toStr()`, returns `str` | |

**`Symbol.toStr` for classes:**

```js
class Point {
  x; y;
  constructor(x = 0.0, y = 0.0) { this.x = x; this.y = y; }

  //@symbol(Symbol.toStr)
  toStr() { return `(${this.x}, ${this.y})`; }
  // Note: x and y are f64 — interpolatable directly
  // toStr must return str, not String
}

const p = new Point(1.0, 2.0);
console.log(`point: ${p}`);   // "point: (1.0, 2.0)"
```

`Symbol.toStr` must return `str` (not `String`). The compiler enforces this. If you need heap string construction inside `toStr`, build it and call `.asStr()` at the end.

**No implicit coercion:** class instances without `Symbol.toStr` in `${}` are a compile error `CE-T09`. There is no `[object Object]` fallback.

### 26.2 Strings to Numbers — `.parse()`

Every numeric type has a static `.parse()` method. Parsing always throws `ParseError` on failure — no nullable return.

**Integers — with optional radix:**

```js
i8.parse(s = "")                  // i8  — throws ParseError on failure
u8.parse(s = "")                  // u8
i16.parse(s = "")                 // i16
u16.parse(s = "")                 // u16
i32.parse(s = "", radix = i32(10))  // i32
u32.parse(s = "", radix = i32(10))  // u32
i64.parse(s = "", radix = i32(10))  // i64
u64.parse(s = "", radix = i32(10))  // u64
isize.parse(s = "", radix = i32(10)) // isize
usize.parse(s = "", radix = i32(10)) // usize
```

**Floats — no radix:**

```js
f32.parse(s = "")    // f32 — throws ParseError on failure
f64.parse(s = "")    // f64
```

**Behaviour:**

```js
i32.parse("42")          // 42
i32.parse("-17")         // -17
i32.parse("ff", 16)      // 255
i32.parse("0xff", 16)    // 255 — 0x prefix stripped automatically
i32.parse("0b1010", 2)   // 10  — 0b prefix stripped
i32.parse("0o17", 8)     // 15  — 0o prefix stripped
i32.parse("abc")         // throws ParseError("invalid integer: \"abc\"")
i32.parse("999", 2)      // throws ParseError("invalid digit '9' for radix 2")
i32.parse("42", 1)       // throws ValueError("radix must be between 2 and 36")
f64.parse("3.14")        // 3.14
f64.parse("1e100")       // 1e100
f64.parse("inf")         // +Infinity
f64.parse("-inf")        // -Infinity
f64.parse("nan")         // NaN
f64.parse("abc")         // throws ParseError("invalid float: \"abc\"")
```

Leading and trailing whitespace is rejected — use `.trim()` on the input string first if needed.

All `.parse()` methods are compiler builtins — the implementation is in the compiler, not js.wat source.

**Common pattern with try/catch:**

```js
try {
  const n = i32.parse(userInput);
  processNumber(n);
} catch (e = ParseError) {
  console.log(`bad input: ${e.message}`);
}
```

**Common pattern with known-valid input** — if you know the string is always valid (e.g. from your own serialization), let the exception propagate naturally:

```js
// No try/catch needed — ParseError bubbles up to caller
const n = i32.parse(record.get("count"));
```

---

## 27. Modules

### 27.1 Resolution Algorithm

The compiler resolves import specifiers according to three rules, checked in order:

```
1. Stdlib path   "std/*"         → compiler built-in module
2. WASM import   "./foo.wasm"    → pre-compiled WASM binary
                 "../foo.wasm"
3. Relative path "./foo"         → resolves to ./foo.js
                 "./foo.js"      → literal file path
                 "../foo"        → parent directory
                 "./dir"         → resolves to ./dir/index.js
```

**No bare specifiers.** `import x from "lodash"` is `CE-M03`. There is no package registry.

**Directory imports** resolve to `index.js` in that directory. This is the only convention — no `package.json`, no `main` field.

### 27.2 Pre-compiled WASM Imports

Any `.wasm` file can be imported directly. The compiler reads the export section and synthesizes declarations automatically:

```js
import { vec3Dot, mat4Multiply, vec3Cross } from "./mathlib.wasm";

// Now call them like normal functions — type-checked against inferred types
const d = vec3Dot(a, b);
```

**Type inference from WASM binary** (conservative defaults):

| WASM type | Inferred js.wat type |
|---|---|
| `i32` | `isize` |
| `i64` | `i64` |
| `f32` | `f32` |
| `f64` | `f64` |

**`.extern.js` sidecar** — if a file `./mathlib.extern.js` exists alongside `./mathlib.wasm`, its type annotations take priority:

```js
// mathlib.extern.js — precise types override binary inference
//@external("mathlib", "vec3_dot")
export function vec3Dot(a = ptr(0.0), b = ptr(0.0)) { return 0.0; }
```

The compiler validates the sidecar types against the binary signatures. Mismatch = `CE-M04`/`CE-M05`. The `.wasm` import automatically adds the binary to the `--link` list — no manual flag needed.

### 27.3 Compilation Unit

All source files in a project compile to **one WASM module**. Import/export is a source-level visibility mechanism — it does not create WASM module boundaries. The linker sees a single flat namespace.

Consequences:
- No dynamic import — the whole graph is resolved at compile time
- No lazy loading
- Dead code elimination works across all files
- All cross-file calls are intra-module calls — zero overhead at the WASM level

### 27.4 Export Forms

```js
// Named exports
export function foo() { }
export class Foo { }
export const X = 42;
export { foo, Foo, X }
export { foo as bar }             // renamed export

// Default export — one per file
export default Math;

// Re-exports — no intermediate binding
export { Range } from "./range";
export { Range as R } from "./range";
export * from "./range";          // all named exports of ./range
```

### 27.5 Import Forms

```js
// Default import
import Math from "std/math";

// Named imports
import { Range, StepRange } from "std/range";
import { Range as R } from "std/range";     // renamed

// Namespace import — all exports as properties of ns
import * as col from "std/collections";
col.Map; col.Set; col.Stack;

// WASM binary import
import { vec3Dot } from "./mathlib.wasm";
```

Side-effect imports (`import "std/prelude"`) are removed — the prelude is now implicit (§28). No other side-effect import form is supported.

### 27.6 `//@export` vs `export`

These are orthogonal and independent:

| Mechanism | Controls |
|---|---|
| `export` | js.wat source-level visibility — which names other `.js` files can import |
| `//@export` | WASM host visibility — which functions appear in the WASM export section |

A function can have both, either, or neither:

```js
// Visible to other js.wat files AND to the WASM host
//@export("game_update")
export function update(dt = 0.0) { }

// Visible to other js.wat files only
export function helperFn() { }

// Visible to WASM host only (internal function exported for host tooling)
//@export("debug_state")
function dumpState() { }

// Visible to neither — file-private
function internalHelper() { }
```

### 27.7 Initialisation Order

Top-level code (static field initialisers, module-level `const`/`let` with non-trivial values) runs in the `_start` sequence before user `main`. Order:

1. **Topological sort** of the import graph — leaf modules first
2. **Within each file** — top to bottom
3. Cycles detected at compile time → `CE-M02` with full cycle path

```
error: CE-M02  circular import detected
  src/a.js → src/b.js → src/c.js → src/a.js
```

### 27.8 `.extern.js` Files

`.extern.js` files participate in the module graph as normal source files. The compiler identifies them by the presence of `//@external` pragmas on their exports — not by filename convention. The `.extern.js` suffix is a recommended convention for documentation, not a compiler requirement.

```js
// mathlib.extern.js — can be imported by any file
import { vec3Dot } from "./mathlib.extern.js";
// OR via the .wasm directly (sidecar applied automatically):
import { vec3Dot } from "./mathlib.wasm";
```

---

## 28. Implicit Prelude

The prelude is never imported — its members are always in scope in every js.wat file. This is identical to Rust's prelude model. The prelude contains only names that would be genuinely tedious to import in nearly every file.

Explicitly importing a prelude member is a `CE-M06` warning (not an error).

**Always in scope — no import needed:**

```
From std/string:
  String

From std/io:
  console

From std/math:
  Math

From std/random:
  Random

From std/range:
  Range

From std/collections:
  Map, Set, Stack, Queue, Deque

From std/error:
  AppError, ValueError, RangeError, IOError, ParseError, NotFoundError
```

**Requires explicit import:**

```js
import { iter }              from "std/iter";       // iterator combinators
import { StepRange }         from "std/range";      // less common
import { Clock }             from "std/clock";      // system concern
import { FS }                from "std/fs";         // system concern
import { Process }           from "std/process";    // system concern
import { Base64, UTF8 }      from "std/encoding";   // specific use
import { ptr, alloc }        from "std/mem";        // explicit intent matters
import { ... }               from "std/wasm";       // explicitly low-level
```

**Tree-shaking applies to prelude members.** Being in scope does not root anything in the call graph. `Math` being in the prelude contributes zero bytes to the binary unless a `Math.*` method is actually called. `Map` contributes zero bytes unless instantiated.

---

## 29. Tree-Shaking

Tree-shaking in js.wat is automatic and operates at five levels. No annotations or configuration required beyond the `--wasi` flag.

### 29.1 Level 1 — User Module Dead Code Elimination

The compiler builds a call graph rooted at:
- All `//@export` functions
- The `_start` entry point
- All static field initialisers reachable from the above

Any function, class, or static field not reachable from these roots is not emitted. A whole class that is never instantiated — including all its methods — produces zero bytes. This works across files because the entire module graph is one compilation unit.

### 29.2 Level 2 — Stdlib Dead Code Elimination

The stdlib is compiled as js.wat source alongside user code. The compiler sees the full unified call graph. Unused stdlib functions are never emitted:

- Use `Range` but not `StepRange` → `StepRange` not emitted
- Use `Math.sqrt` but not `Math.sin` → `Math.sin` polynomial not emitted
- Use `Map` but not `Set` → `Set` not emitted
- Use `String.slice` but not `String.split` → `split` not emitted

### 29.3 Level 3 — Runtime Internals DCE

After `wasm-merge`, `wasm-opt --dce` eliminates unreachable runtime functions. The runtime functions are only called from compiler-emitted call sites — never from user code directly — so DCE is precise.

Runtime functions and their conditions for inclusion:

| Function | Included when |
|---|---|
| `__jswat_alloc` | Any heap allocation (`new`, `String`, `Array`) |
| `__jswat_free` | `__jswat_alloc` included |
| `__jswat_realloc` | `alloc.realloc()` used |
| `__jswat_rc_inc` | Any heap value crosses a scope boundary |
| `__jswat_rc_dec` | Any heap value goes out of scope |
| `__jswat_dispose` | Any class implements `Symbol.dispose` |
| `__jswat_arena_new` | `alloc.arena()` used |
| `__jswat_arena_alloc` | `arena.alloc()` or `arena.bytes()` used |
| `__jswat_arena_reset` | `arena.reset()` used |
| `__jswat_arena_free` | `arena.free()` used |
| `__jswat_pool_new` | `alloc.pool()` used |
| `__jswat_pool_alloc` | `pool.alloc()` used |
| `__jswat_pool_free` | `pool.free()` used |

A pure computation module — numeric processing, no heap allocation — emits zero allocator or GC code.

### 29.4 Level 4 — Refcount Elimination

The compiler marks a class as **cycle-free** when none of its fields (transitively) hold a reference to the same class or any of its ancestors. For cycle-free classes, binaryen's escape analysis can prove short-lived instances never escape their allocation scope and eliminate their refcount — stack-allocating them with zero GC overhead.

The compiler emits a `!cycle_free` hint in the merged WASM for binaryen to exploit. No user annotation needed.

### 29.5 Level 5 — WASI Branch Folding

The `--wasi` compiler flag folds the `__wasi_available` global at compile time, enabling the dead-code elimination passes to remove entire branches:

```bash
jswat compile src/main.js                # runtime probe (default) — both paths kept
jswat compile src/main.js --wasi=yes     # fold to 1 — WASI-free paths removed
jswat compile src/main.js --wasi=no      # fold to 0 — all WASI call paths removed
```

With `--wasi=no`:
- All `wasi_snapshot_preview1` imports disappear from the binary
- `std/fs`, `std/clock`, `std/process`, `std/io` degrade to their no-op paths, which DCE then removes entirely if the functions are called but trivially return
- `std/random` loses WASI seeding but keeps the PRNG

`jswat.json`:
```json
{ "wasi": "no" }
```

### 29.6 Full Pipeline

```
1. Parse + type-check full module graph (user code + stdlib source)
2. --wasi= flag folds __wasi_available (if specified)
3. Build call graph rooted at //@export + _start
4. Mark reachable: functions, classes, static fields, vtable entries
5. Emit only reachable symbols → user.wasm
6. wasm-merge user.wasm runtime.wasm → merged.wasm
7. wasm-opt --dce merged.wasm          (runtime internals DCE)
8. wasm-opt -O3 merged.wasm            (inline rc hot paths, constant fold,
                                        escape analysis, refcount elimination)
9. → final.wasm
```

binaryen's `-O3` pass handles levels 4 and the inlining of `rc_inc`/`rc_dec` hot paths. The typical hot path after inlining:

```wat
;; rc_inc for a non-null, non-sentinel GC object — inlined to ~5 instructions
local.get $ptr
i32.load                          ;; read rc_class word
i32.const -1
i32.ne                            ;; sentinel check
if
  local.get $ptr
  local.get $ptr
  i32.load
  i32.const 1
  i32.add
  i32.store                       ;; rc++
end
```

The sentinel check (`rc != -1`) is the only branch. For GC objects it is always predicted-taken by branch predictors after warmup.

---

*End of js.wat Spec v1.3*