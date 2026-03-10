# js.wat Language Specification
### Version 1.1

> A statically-typed, JIT-friendly language with JavaScript syntax that compiles to WebAssembly.
> No eval. No hidden classes. No surprises.

---

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

**`String` — heap-allocated mutable string (default export of std/string):**

```js
import String from "std/string";

let s = new String("hello");
s.append(" world");  s.set(0, "H");
s.asStr();           // str — zero-copy view
s.dataPtr();         // usize — address of raw byte buffer (past header)
s.length;            // usize
```

Memory layout: `[ refcount:4 | length:4 | capacity:4 | hash:4 | *buffer ]`

**Template literals produce `String` — requires import. Only integers, floats, bool, and str can be interpolated.**

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

**Compact layout (default):**

Fields sorted by descending size to minimise padding. Sort is stable within same size class:

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

Compact layout:
```
Offset  Field    Type    Size
0       refcount —       4
4       x        f64     8    ← 8-byte fields first
12      y        f64     8
20      id       isize   4    ← 4-byte fields
24      health   i32     4
28      flags    u16     2    ← 2-byte fields
30      active   bool    1    ← 1-byte fields
31      tag      u8      1
32      (pad)    —       4    ← pad to multiple of largest alignment (8)
```

Total: 36 bytes.

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

Use for network protocols, binary formats, and FFI where host expects a specific field order. Makes pointer arithmetic on fields predictable.

**Inheritance layout:**

Parent fields always form a prefix of child layout — enables safe pointer narrowing:

```
Shape:   [ refcount:4 | color:4 ]
Circle:  [ refcount:4 | color:4 | radius:8 ]
         ↑ identical Shape prefix
```

**Static fields:**

Live in a separate region of linear memory — one allocation per class:
```
Static data region: [ IdGen.#next:4 | Config.MAX:4 | ... ]
```

**Reference fields:**

Class instances, arrays, `String`, and `Ptr` are stored as pointers (4 bytes on WASM32) in the struct layout.

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
Header: [ refcount:4 | length:4 | capacity:4 | *data ]
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

`Ptr` layout: `[ refcount:4 | value:N ]`

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

GC objects must not directly store manually allocated objects — store the `Ptr` instead.

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

No fallthrough. No `break`. Exhaustiveness enforced.

### 5.2 If

```js
if (s instanceof Circle) { s.radius; s.color; }
```

Combinable with `&&`. Elimination narrowing in `else` for two-variant unions. No exhaustiveness check.

---

## 6. Symbols and Traits

Symbols define trait contracts via `//@symbol(SymbolName)` pragma.

**Well-known symbols:**

| Symbol | Purpose | Return type |
|---|---|---|
| `Symbol.iterator` | `for...of` support | class implementing `Symbol.next` |
| `Symbol.next` | iterator step | `IteratorResult<T>` |
| `Symbol.toPrimitive` | numeric conversion | numeric type |
| `Symbol.toStr` | string conversion | `str` |
| `Symbol.compare` | ordering for sort | `isize` |
| `Symbol.hash` | hash for Map/Set | `isize` |
| `Symbol.equals` | equality for Map/Set | `bool` |
| `Symbol.dispose` | cleanup on free | `void` |

`Symbol.dispose` called automatically when refcount hits zero.

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

**`throw`/`catch`:** class instances only. Multiple throws unify to common superclass.

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
    "byteSize": 36,
    "fields": {
      "x":      { "offset": 4,  "type": "f64",  "wasmType": "f64"  },
      "y":      { "offset": 12, "type": "f64",  "wasmType": "f64"  },
      "id":     { "offset": 20, "type": "isize","wasmType": "i32"  },
      "health": { "offset": 24, "type": "i32",  "wasmType": "i32"  },
      "flags":  { "offset": 28, "type": "u16",  "wasmType": "i32"  },
      "active": { "offset": 30, "type": "bool", "wasmType": "i32"  },
      "tag":    { "offset": 31, "type": "u8",   "wasmType": "i32"  }
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

### 13.1 Declaring linked module functions

Functions from a linked WASM module are declared with `//@external` using the module name as the first argument. The declaration can live in any `.js` file, or in a dedicated `.extern.js` file:

```js
// Inline — anywhere in the codebase
//@external("mathlib", "vec3_dot")
function vec3Dot(a = ptr(0.0), b = ptr(0.0)) { return 0.0; }

// Or in mathlib.extern.js — full library interface in one place
//@external("mathlib", "vec3_dot")
export function vec3Dot(a = ptr(0.0), b = ptr(0.0)) { return 0.0; }

//@external("mathlib", "vec3_cross")
export function vec3Cross(a = ptr(0.0), b = ptr(0.0), out = ptr(0.0)) { }

//@external("mathlib", "mat4_multiply")
export function mat4Multiply(a = ptr(0.0), b = ptr(0.0), out = ptr(0.0)) { }
```

### 13.2 Linking at compile time

```bash
# Via CLI flags
jswat compile src/main.js \
  --link mathlib=dist/mathlib.wasm \
  --link physics=dist/physics.wasm \
  -o dist/app.wasm

# Via jswat.json
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
2. Invokes `wasm-merge --merge-memory` with all linked libraries
3. Outputs the merged binary

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
| `alloc.create(Type, ...args)` | `Ptr<T>` | single manual allocation |
| `alloc.free(ptr)` | `void` | free single object |
| `alloc.arena(size = usize(0))` | `Arena` | create arena — 0 = growable |
| `alloc.pool(type, capacity = usize(0))` | `Pool` | create fixed-size pool |

**Arena:** bump allocation O(1). Methods: `alloc(Type, ...args)`, `free()`, `reset()`, `used()` → `usize`, `capacity()` → `usize`.

**Pool:** free-list O(1). Methods: `alloc(...args)`, `free(p)`, `available()` → `usize`, `capacity()` → `usize`.

**GC objects must not directly store manually allocated objects — store the `Ptr` instead.**

| Strategy | API | Free | Use case |
|---|---|---|---|
| GC managed | `new Player()` | automatic | general code |
| Manual | `alloc.create()` / `alloc.free()` | per-object | fine-grained control |
| Arena | `arena.alloc()` / `arena.free()` | all at once | frame allocations |
| Pool | `pool.alloc()` / `pool.free()` | return to slot | high-churn fixed-size |

Debug builds poison freed memory. Release: UB on use-after-free.

---

## 15. WASI and Runtime

### 15.1 Automatic WASI-free degradation

No flag needed. If no WASI host is present, WASI imports become stubs. A `wasiAvailable` global `i32` is set by a startup probe. Stdlib functions degrade gracefully:

| Module | Function | WASI-free behaviour |
|---|---|---|
| `std/io` | `stdout.write`, `console.log` | silent no-op |
| `std/io` | `stderr.write` | silent no-op |
| `std/io` | `stdin.read` | returns `null` |
| `std/fs` | `FS.read` | returns `null` |
| `std/fs` | `FS.write`, `FS.append` | returns `false` |
| `std/fs` | `FS.exists`, `FS.delete`, `FS.mkdir` | returns `false` |
| `std/fs` | `FS.readdir` | returns `null` |
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

### 16.2 Reference Counting

Hidden refcount on all heap values. Managed by compiler. `Symbol.dispose` called when refcount hits zero. Cycle-forming types enrolled in trial deletion cycle collector statically.

---

## 17. Standard Library

### 17.1 `std/core` — always available, WASI independent

```
Numeric casts     i8() u8() i16() u16() i32() u32()
                  i64() u64() isize() usize() f32() f64()
ptr()             pointer creation
ptr.fromAddr()    pointer from raw address
ptr.diff()        pointer distance
alloc             allocation namespace
IteratorResult    iterator protocol builtin
str builtins      length slice indexOf includes startsWith endsWith
                  split trim trimStart trimEnd toUpperCase toLowerCase
                  replace repeat padStart padEnd at
Array builtins    push pop slice map filter reduce find findIndex
                  forEach every some flat flatMap indexOf includes
                  join reverse fill length sort
bool, arithmetic  operators and comparisons
```

### 17.2 `std/prelude` — convenient bundle

```js
import "std/prelude";
// Math, String, Random, Clock, console, stdout, stderr, stdin,
// AppError family, Process
```

### 17.3 `std/math` — default export: `Math`

Must be imported — not global:

```js
import Math from "std/math";
```

**Constants:** `Math.PI` `Math.E` `Math.LN2` `Math.LN10` `Math.LOG2E` `Math.LOG10E` `Math.SQRT2` `Math.SQRT1_2`

**Trigonometry** (constraint: `Float` — monomorphizes for f32/f64):
`sin` `cos` `tan` `asin` `acos` `atan` `atan2` `sinh` `cosh` `tanh` `asinh` `acosh` `atanh`

**Exponential/logarithmic** (`Float`):
`exp` `expm1` `log` `log1p` `log2` `log10` `pow` `sqrt` `cbrt` `hypot`

**Rounding** (`Float` in, `Float` out):
`floor` `ceil` `round` `trunc` `fround`

**Arithmetic** (`Number` — monomorphizes across all numeric types):
`abs` `min` `max` `sign`

**Integer-specific** (`Integer`):
`clz32` `imul`

**Random** (always `f64` — alias to global `Random` instance):
```js
Math.random()   // f64 — WASI: wasi_random_get; no WASI: internal RNG
```

**js.wat extras:**
```js
Math.clamp(val=Number, min=Number, max=Number)
Math.lerp(a=Float, b=Float, t=Float)
Math.smoothstep(e0=Float, e1=Float, x=Float)
Math.map(val=Float, inMin=Float, inMax=Float, outMin=Float, outMax=Float)
Math.degToRad(deg=Float)
Math.radToDeg(rad=Float)
```

### 17.4 `std/string` — default export: `String`

```js
import String from "std/string";
```

Methods: `append` `set` `asStr` `dataPtr` `length` (usize) `slice` `indexOf` `includes` `startsWith` `endsWith` `toUpperCase` `toLowerCase` `trim` `trimStart` `trimEnd` `split` `replace` `padStart` `padEnd` `repeat` `at`

Static: `String.from(n=isize(0))` — monomorphizes for all numeric types and bool.

### 17.5 `std/random` — default export: `Random`

```js
import Random from "std/random";

const rng = new Random(42);   // seeded — deterministic
const rng2 = new Random;      // WASI: truly random; no WASI: seed=0

rng.float()                   // f64 0.0–1.0
rng.int()                     // isize
rng.range(min=0, max=0)       // isize — inclusive
rng.bool()                    // bool
rng.seed(s=0)                 // void

Random.float()                // global instance — same as Math.random()
Random.seed(s=0)
```

### 17.6 `std/range` — Range

```js
import { Range } from "std/range";

new Range(0, 10)                              // 0..10 exclusive, step 1
new Range({ end: 10 })                        // start defaults to 0
new Range({ start: 2, end: 8, step: 2 })     // 2 4 6
new Range(0.0, 1.0, 0.1)                     // Range<f64>

r.includes(5)     // bool
r.count()         // usize
r.toArray()       // Array<T>
```

### 17.7 `std/io`

```js
import { console, stdout, stderr, stdin } from "std/io";

console.log(s="")    console.error(s="")
stdout.write(s="")   stderr.write(s="")
stdin.read()         // str?
stdin.readAll()      // str?
```

### 17.8 `std/fs`

```js
import { FS } from "std/fs";

FS.read(path="")                     // str?
FS.write(path="", content="")        // bool
FS.append(path="", content="")       // bool
FS.exists(path="")                   // bool
FS.delete(path="")                   // bool
FS.mkdir(path="")                    // bool
FS.readdir(path="")                  // Array<str>?
```

### 17.9 `std/clock`

```js
import { Clock } from "std/clock";
Clock.now()            // isize — ms since epoch
Clock.monotonic()      // isize — monotonic ns
Clock.sleep(ms=0)      // void
```

### 17.10 `std/collections`

```js
import { Map, Set, Queue, Stack, Deque } from "std/collections";
```

**`Map`** — constructor defaults anchor key/value types:

```js
const scores = new Map("", 0);   // Map<str, isize>

scores.set("Sz", 100)
scores.get("Sz")         // isize?
scores.has("Sz")         // bool
scores.delete("Sz")      // bool
scores.size              // usize — property not method
scores.clear()
scores.keys()   scores.values()   scores.entries()
scores.forEach((v, k) => { })
for (const [k, v] of scores) { }
```

**`Set`** — constructor default anchors element type:

```js
const ids = new Set(0);   // Set<isize>

ids.add(42)   ids.has(42)   ids.delete(42)
ids.size      ids.clear()
ids.values()  ids.keys()    ids.entries()
for (const id of ids) { }
```

Class instance keys/elements require `Symbol.hash` and `Symbol.equals`. Primitives and `str` have built-in hash/equality.

**`Queue`, `Stack`, `Deque`:** monomorphize per element type via constructor default. All have `size` as a `usize` property.

### 17.11 `std/error`

```js
import { AppError, ValueError, RangeError, IOError } from "std/error";
```

### 17.12 `std/process`

```js
import { Process } from "std/process";
Process.exit(code=0)    Process.args()    Process.env(key="")
```

### 17.13 `std/encoding`

```js
import { Base64, UTF8 } from "std/encoding";

Base64.encode(s="")     // str
Base64.decode(s="")     // str?
UTF8.encode(s="")       // Array<u8>
UTF8.decode(bytes=[u8(0)]) // str?
```

### 17.14 `std/iter`

```js
import { iter } from "std/iter";

iter(new Range(0, 100))
  .filter(x => x % 2 === 0)
  .map(x => x * x)
  .take(5)
  .collect();            // Array<isize>
```

Full API: `map` `filter` `take` `skip` `takeWhile` `skipWhile` `enumerate` `zip` `flat` `flatMap` `collect` `forEach` `find` `some` `every` `count` `first` `last` `reduce`

### 17.15 Full stdlib map

```
std/
├── core          — always available, WASI independent
├── prelude       — convenient bundle
├── math          — Math (default export) — must import
├── string        — String (default export)
├── random        — Random (default export)
├── range         — Range
├── io            — console stdout stderr stdin
├── fs            — FS
├── clock         — Clock
├── collections   — Map Set Queue Stack Deque
├── error         — AppError and subclasses
├── process       — Process
├── encoding      — Base64 UTF8
└── iter          — iter() combinator chain
```

**WASI dependency:**
```
WASI free:     std/core std/math std/string std/encoding
               std/collections std/error std/range std/iter
               std/random (after manual seed)

Degrades gracefully:
               std/io std/fs std/clock std/process std/random
```

Tree-shaking is automatic — only reachable stdlib code appears in the binary.

---

## 18. Compilation Pipeline

```
.js source (js.wat)
    ↓ Lexer → tokens
    ↓ Parser → AST
    ↓ Type inference
        — monomorphization, field resolution, str/String distinction
        — nullability, call graph, throw unification, cycle detection
        — const evaluation (compile-time vs runtime)
        — type propagation, mixed arithmetic promotion
        — abstract type constraint resolution
    ↓ Semantic validation
        — banned features, UB annotation, parameter defaults
        — constructor completeness, switch exhaustiveness
        — GC/manual mixing, symbol trait verification
        — out-of-range literal detection
        — static-only class instantiation detection
    ↓ WASM codegen
        — compact field layout (sorted by size, aligned)
        — str → data segment
        — String → heap stubs
        — struct layout → linear memory offsets
        — refcount instructions, monomorphized copies
        — wasiAvailable probe + stubs
        — alloc namespace stubs
        — ptr.fromAddr / ptr.diff builtins
        — sret for multi-value returns
        — (memory (export "memory") N)
    ↓ .wasm
    ↓ wasm-merge (if --link) → merged .wasm
    ↓ binaryen (if --optimize) → optimised .wasm
    ↓ wasm2c (if --native) → C → clang/gcc → native binary
```

**Compiler:** JavaScript, runs on Node.js.
**Dependencies:** `wabt.js` (WAT + wasm-merge), optional `binaryen.js` (optimisation).

**CLI:**

```bash
jswat compile src/main.js -o dist/main.wasm
jswat compile src/main.js --link mathlib=dist/mathlib.wasm -o dist/app.wasm
jswat build src/main.js -o dist/main           # + wasm2c + clang → native
jswat check src/main.js                         # type check only
jswat inspect dist/main.wasm                    # WAT output
jswat inspect dist/main.wasm --emit-extern      # generate .extern.js declarations
jswat compile src/mathlib.js --lib -o dist/mathlib.wasm   # library build
jswat compile src/ -o dist/                     # compile directory
```

**`jswat.json` config:**

```json
{
  "entry": "src/main.js",
  "output": "dist/app.wasm",
  "lib": false,
  "link": {
    "mathlib": "dist/mathlib.wasm",
    "physics": "dist/physics.wasm"
  },
  "importMemory": false,
  "mergeMemory": true,
  "emitLayout": "dist/layout.json",
  "optimize": true,
  "native": false
}
```

---

## 19. What Is Banned

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
| Dynamic `import()` | Static imports only |
| `Proxy`, `Reflect` | Runtime interception |
| `Symbol` as dynamic key outside trait system | Dynamic property keys |
| `typeof` as branch condition | Use `instanceof` |
| Type annotations | No annotation syntax |
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
| `Math.*` without import | Must import from std/math |
| Manual allocation stored directly in GC object | Store Ptr instead |
| Implicit numeric coercion | Explicit casts required |
| `bool` in numeric expressions | Use ternary |
| Instantiating `Number`, `Integer`, `Float` | Abstract — constraints only |

---

## 20. Why js.wat Is Easy to JIT

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
| UB null fast path | `.` emits zero null checks |
| Manual memory escape hatch | `alloc` bypasses GC entirely |
| Compile-time constants | `const` inlined — zero runtime cost |
| Symbol traits at compile time | No runtime dispatch overhead |
| Type propagation | Eliminates redundant casts in hot paths |
| Whole-program linking | `wasm-merge` enables cross-module inlining |

---

## 21. Sample Programs

### 21.1 Hello World

```js
import { console } from "std/io";

console.log("Hello from js.wat!");
```

---

### 21.2 FizzBuzz

```js
import { console } from "std/io";
import String from "std/string";
import { Range } from "std/range";

for (const i of new Range(1, 101)) {
  const fizz = i % 3 === 0;
  const buzz = i % 5 === 0;
  if (fizz && buzz) console.log("FizzBuzz");
  else if (fizz)    console.log("Fizz");
  else if (buzz)    console.log("Buzz");
  else              console.log(String.from(i));
}
```

---

### 21.3 Fibonacci (iterator)

```js
import { console } from "std/io";
import String from "std/string";

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
  console.log(String.from(n));
  if (++count >= 10) break;
}
// 0 1 1 2 3 5 8 13 21 34
```

---

### 21.4 Generic Stack

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

### 21.5 Result Pattern

```js
import { console } from "std/io";
import String from "std/string";

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
    case Ok:  console.log(`Result: ${String.from(r.value)}`);
    case Err: console.log(`Error: ${r.message}`);
  }
}

printResult(divide(10, 2));   // Result: 5
printResult(divide(10, 0));   // Error: division by zero
```

---

### 21.6 Pixel Buffer (manual memory)

```js
import { Range } from "std/range";

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

### 21.7 WASM Computation Module (WASI-free)

```js
import Math from "std/math";
import Random from "std/random";
import { Range } from "std/range";

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

### 21.8 Linking a WASM Math Library

```js
// mathlib.extern.js — optional, documents full mathlib interface
//@external("mathlib", "vec3_dot")
export function vec3Dot(a = ptr(0.0), b = ptr(0.0)) { return 0.0; }

//@external("mathlib", "vec3_cross")
export function vec3Cross(a = ptr(0.0), b = ptr(0.0), out = ptr(0.0)) { }
```

```js
// main.js — import from the .extern.js or declare inline
import { vec3Dot, vec3Cross } from "./mathlib.extern.js";

class Vec3 {
  x; y; z;
  constructor(x = 0.0, y = 0.0, z = 0.0) { this.x = x; this.y = y; this.z = z; }
}

const a = alloc.create(Vec3, 1.0, 0.0, 0.0);
const b = alloc.create(Vec3, 0.0, 1.0, 0.0);
const dot = vec3Dot(a, b);   // f64 — calls into linked mathlib.wasm
```

```bash
jswat compile src/main.js --link mathlib=dist/mathlib.wasm -o dist/app.wasm
```

---

### 21.9 Game Loop

```js
import Math from "std/math";
import { console } from "std/io";

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

*End of js.wat Spec v1.1*