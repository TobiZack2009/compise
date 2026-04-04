# js.wat Standard Library Reference
### Version 1.9

> Complete API reference for all `std/*` modules.
> Prelude members are always in scope — no import needed.

**v1.7 changes:** `std/js` module group added (`JSObject`, `JSValue`, `JSFn`, `JSSymbol`) · `std/js/dom`, `std/js/canvas`, `std/js/audio`, `std/js/worker`, `std/js/storage`, `std/js/net` · `std/js/threads` · `str` is fat pointer · `undefined` replaces `void` · `rawAlloc` replaces `alloc` in `std/mem` · `alloc` builtin always in scope

**v1.8 changes:** `JSObject` all operations are instance methods · `JSValue` all operations are instance methods · `coerce*` methods added to `JSValue` · `JSObject.deleteSymbol` added · `JSSymbol.eq` instance method · `jsSymbol`, `jsSymbolFor`, well-known constants clarified · removed obsolete static `JSObject.*` helper functions · `std/js` section restructured to match instance-method model

**v1.9 changes:** `StringBuilder` removed; `String` absorbs all string-building; `new String()` and `new String(capacity)` constructors; `std/js/threads` removed; module map and target availability updated; implicit prelude updated

*See also: [jswat-spec.md](jswat-spec.md) — Language Spec v1.9 | [jswat-compiler.md](jswat-compiler.md) — Compiler Reference v1.9*

---

## Module Map

```
std/
├── core          — compiler builtins (always linked)
├── wasm          — WASM instruction intrinsics
├── mem           — ptr, rawAlloc
├── math          — Math (prelude)
├── string        — String (prelude)
├── random        — Random (prelude)
├── range         — Range (prelude), StepRange
├── iter          — iter() combinator chain
├── collections   — Map, Set, Stack, Queue, Deque (all prelude)
├── result        — Result<T>
├── error         — AppError hierarchy (prelude)
├── io            — console (prelude), stdout, stderr, stdin
├── fs            — FS
├── clock         — Clock
├── process       — Process
├── encoding      — Base64, UTF8
└── js/           — wasm32-js-* targets only (degrade to null on others)
    ├── index     — JSObject, JSValue, JSFn, JSSymbol, jsGlobal, jsSymbol, jsSymbolFor
    ├── dom       — HTMLElement, document, MouseEvent, KeyboardEvent
    ├── canvas    — Canvas2D, Canvas2DContext, WebGL2
    ├── audio     — AudioContext, AudioNode
    ├── worker    — Worker
    ├── storage   — localStorage, sessionStorage, IDB
    └── net       — fetch
```

---

## Target Availability

| Module | `wasip1` | `unknown` | `ld` | `component` | `js-*` |
|---|---|---|---|---|---|
| `std/core`, `std/wasm`, `std/mem` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `std/math`, `std/string`, `std/encoding` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `std/collections`, `std/error`, `std/range`, `std/iter`, `std/result` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `std/random` | ✅ WASI-seeded | ⚠️ seed=0 | ✅ WASI-seeded | ✅ WIT-seeded | ✅ `crypto.getRandomValues` |
| `std/io` | ✅ | ⚠️ no-op/hook | ✅ | ✅ WIT | ✅ `console.*` |
| `std/fs` | ✅ | ⚠️ null/false | ✅ | ✅ WIT | ✅ Node / ⚠️ null in browser |
| `std/clock` | ✅ | ⚠️ returns 0 | ✅ | ✅ WIT | ✅ `performance.now` / `Date.now` |
| `std/process` | ✅ | ⚠️ exit traps | ✅ | ✅ WIT | ✅ Node / ⚠️ partial in browser |
| `std/js` (types, DOM, canvas, audio, worker, storage, net) | ⚠️ null/no-op | ⚠️ null/no-op | ⚠️ null/no-op | ⚠️ null/no-op | ✅ |

`std/js` types (`JSObject`, `JSValue`, `JSFn`, `JSSymbol`) are available on all targets. On non-`wasm32-js-*` targets they are always null and all operations are no-ops. CW-JS01 fires once per file that imports them.

`wasm32-ld` is identical to `wasm32-wasip1` for all system modules — both emit `wasi_snapshot_preview1` imports. Only allocator sourcing differs, internal to `std/mem` and `runtime.wat`.

---

## `std/wasm` — WASM Instruction Intrinsics

Single WASM instruction per function. Compiler inlines directly — zero call overhead. Explicit import required.

**Tier 1 — pure value ops:**

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

**Tier 2 — raw memory ops (bypass type system — allocator/encoding use only):**

```js
import { i32_load, i32_store, i32_load8_s, i32_load8_u, i32_store8,
         i32_load16_s, i32_load16_u, i32_store16,
         i64_load, i64_store, f32_load, f32_store, f64_load, f64_store,
         memory_size, memory_grow, memory_copy, memory_fill } from "std/wasm";
```

---

## `std/mem` — Raw Memory

Explicit import required. Operations are untracked and unsafe. Distinct from the `alloc` compiler builtin.

```js
import { ptr, rawAlloc } from "std/mem";
```

**Raw pointer operations:**

```js
ptr.fromAddr(addr = usize(0), type)   // raw typed pointer — unowned, untracked
ptr.diff(a, b)                         // isize — address difference
```

`ptr.fromAddr` is unowned. Use-after-free is RT-08 in debug, UB in release.

**Raw byte allocation:**

```js
rawAlloc.bytes(n = usize(0))                          // u8? — zeroed buffer
rawAlloc.bytes(n = usize(0), fill = u8(0))            // u8? — filled buffer
rawAlloc.realloc(buf = usize(0), newSize = usize(0))  // u8? — resize, old ptr invalid
rawAlloc.copy(dst = usize(0), src = usize(0), n = usize(0))        // undefined
rawAlloc.fill(dst = usize(0), value = u8(0), n = usize(0))         // undefined
```

These return raw byte addresses with no header. Use `ptr.fromAddr` to access typed data.

---

## `std/math` — Math

```js
import Math from "std/math";  // or use from prelude
```

All functions are pure js.wat — no host imports.

**Constants:** `Math.PI`, `Math.E`, `Math.LN2`, `Math.LN10`, `Math.LOG2E`, `Math.LOG10E`, `Math.SQRT2`, `Math.SQRT1_2`

**Reinterpret:** `Math.reinterpretAsI64`, `Math.reinterpretAsF64`, `Math.reinterpretAsI32`, `Math.reinterpretAsF32`

**Float (monomorphizes f32/f64):** `sqrt`, `floor`, `ceil`, `round`, `trunc`, `fround`

**Arithmetic (all numeric):** `abs`, `min`, `max`, `sign`, `clamp`

**Transcendental (f64):** `exp`, `expm1`, `log`, `log1p`, `log2`, `log10`, `pow`, `cbrt`, `hypot`

**Trig (f64):** `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`

**Integer-specific:** `clz32`, `imul`, `popcnt`

**Extras:** `lerp`, `smoothstep`, `map`, `degToRad`, `radToDeg`, `Math.random()` (alias to global Random)

---

## `std/string` — String

`String` is in the implicit prelude. There is no separate `StringBuilder` — append directly to a `String`.

**`str` — immutable string slice. Nullable. Fat pointer `(ptr: usize, len: usize)`.**

`str` literals are raw UTF-8 bytes in the WASM data segment — no header. Null sentinel: `ptr == 0`. Non-escaping `str` is a zero-allocation fat pointer. Escaping `str` is automatically promoted to a `StrRef` (compiler-internal RC object). Promotion is invisible.

```js
str.fromCodePoint(cp = u32(0))   // str — single codepoint from data segment
```

**`String` — heap-allocated mutable string. Nullable. RC-managed. Prelude.**

Construction:

```js
new String()                        // empty String, default capacity
new String(capacity = usize(0))     // empty String with capacity hint
new String("hello")                 // String from str literal
`hello, ${name}`                    // String from template literal — always produces String
```

Read methods (available on both `str` and `String`):

```js
s.length                                    // usize
s.at(n = usize(0))                          // str — single character
s.slice(start = usize(0), end = usize(0))   // str (str source) / String (String source)
s.indexOf(sub = "")                         // isize? — null if not found
s.lastIndexOf(sub = "")                     // isize?
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
```

Mutation methods (mutable unaliased `let` `String` binding only):

```js
s.append(other = "")           // undefined — CE-S01 if aliased, CE-S03 if const
s.set(i = usize(0), ch = "")  // undefined — single character replacement
```

Low-level:

```js
s.$asView()    // str — zero-copy view into String's buffer; compiler promotes if escaping
s.$dataPtr()   // usize — raw UTF-8 buffer address
s.$capacity    // usize
```

Static:

```js
String.fromCodePoint(cp = u32(0))   // String — heap
```

**Incremental construction:**

```js
let s = new String(usize(256));   // pre-allocate — avoids reallocation for known sizes
s.append("key: ");
s.append(key);
s.append(", value: ");
s.append(`${value}`);
```

The compiler tracks aliasing: `s.append` on a `const` binding is CE-S03. `s.append` when `s` has an alias is CE-S01.

---

## `std/random` — Random

```js
import Random from "std/random";  // or use from prelude
```

xoshiro256** PRNG. On `wasm32-js-*`: seeded from `crypto.getRandomValues`. On `wasm32-wasip1`/`wasm32-ld`: from `wasi_random_get`. On `wasm32-component`: WIT random interface. On `wasm32-unknown`: seed=0 unless host provides hook.

```js
const rng = new Random(42);        // seeded — deterministic
rng.float()                        // f64 in [0.0, 1.0)
rng.int()                          // isize
rng.range(min = 0, max = 0)       // isize — inclusive
rng.bool()                         // bool
rng.seed(s = 0)                    // undefined

Random.float()                     // global instance
Random.seed(s = 0)                 // undefined
Math.random()                      // alias to Random.float()
```

---

## `std/range` — Range, StepRange

```js
import { StepRange } from "std/range";   // Range is in the prelude

for (const i of new Range(usize(0), usize(10))) { }           // 0..9
for (const i of new StepRange(isize(0), isize(10), isize(2))) { }  // 0,2,4,6,8
```

`Range.length` → `usize`. `Range.includes(n)` → `bool`.

---

## `std/iter` — Iterator Combinators

```js
import { iter } from "std/iter";

const sum = iter(new Range(usize(0), usize(100)))
  .filter(n => n % 2 == 0)
  .map(n => n * n)
  .sum();
```

**Lazy combinators:** `map`, `filter`, `take`, `skip`

**Terminators:** `collect`, `forEach`, `reduce`, `count`, `find`, `any`, `all`, `sum`, `min`, `max`

**Generator:**

```js
iter.from(fn = Fn(() => T?))   // Iter<T> — null = end
```

---

## `std/collections` — Map, Set, Stack, Queue, Deque

All in the implicit prelude.

**`Map<K, V>`** — open-addressing Robin Hood hash table. K must implement `Symbol.hash` (→ `isize`) and `Symbol.equals`:

```js
const m = new Map(Symbol.hash, isize(0));
m.set(key, 42); m.get(key); m.has(key); m.delete(key); m.size;
for (const entry of m) { entry.key; entry.val; }
```

**`Set<T>`:** `add`, `has`, `delete`, `size`

**`Stack<T>`:** `push`, `pop` (`T?`), `peek`, `size`, `empty`

**`Queue<T>`:** `enqueue`, `dequeue` (`T?`), `peek`, `size`, `empty`

**`Deque<T>`:** `pushFront`, `pushBack`, `popFront` (`T?`), `popBack` (`T?`), `peekFront`, `peekBack`, `size`, `empty`

---

## `std/result` — Result<T>

```js
import { Result } from "std/result";

Result.ok(value)           // Result<T>
Result.err(error)          // Result<T> — error must extend AppError

result.ok                  // T? — null if error
result.err                 // AppError? — null if ok
result.unwrap()            // T — throws if error
result.unwrapOr(fallback)  // T
result.isOk()              // bool
result.isErr()             // bool
result.raise()             // T — inside @returns {Result<T>}: early return on error.
                           //     outside: throws on error, returns value on ok.
```

`.raise()` is valid JS at runtime. The compiler generates early-return code only when it appears inside a `@returns {Result<T>}` function.

---

## `std/error` — Error Hierarchy

All in the implicit prelude. All extend `AppError` with `message: str`. All implement `Symbol.toStr`.

```
AppError
├── ValueError
├── RangeError
├── IOError
├── ParseError
└── NotFoundError
```

---

## `std/io` — console, stdout, stderr, stdin

`console` is in the implicit prelude.

```js
import { stdout, stderr, stdin } from "std/io";

console.log("hello");            // → stdout + newline
console.error("oops");           // → stderr + newline
stdout.write("no newline");
stdout.writeln("with newline");
stdout.writeString(myString);    // heap String

const input = stdin.read(usize(1024));   // String?
const line  = stdin.readLine();          // String?
```

On `wasm32-js-*` targets: `console.log`/`console.error` delegate to the JS `console` object via the `__jswat_io_write` bridge hook.

---

## `std/fs` — Filesystem

```js
import { FS } from "std/fs";

FS.read("data.txt")           // String?
FS.write("out.txt", "hello")  // bool
FS.append("log.txt", "\n")    // bool
FS.delete("tmp.txt")          // bool
FS.mkdir("build/")            // bool
FS.exists("config.json")      // bool
```

On `wasm32-js-*` Node.js: backed by `node:fs`. On `wasm32-js-*` browser: all ops return null/false.

---

## `std/clock` — Clock

```js
import { Clock } from "std/clock";

Clock.now()                     // i64 — nanoseconds since Unix epoch
Clock.monotonic()               // i64 — nanoseconds, arbitrary epoch
Clock.nowMs()                   // f64 — milliseconds
Clock.sleep(ns = i64(0))        // undefined
Clock.sleepMs(ms = 0)           // undefined
```

On `wasm32-js-*`: `Clock.now()` → `Date.now() * 1_000_000`. `Clock.monotonic()` → `performance.now() * 1_000_000`.

---

## `std/process` — Process

```js
import { Process } from "std/process";

Process.exit(i32(0))    // undefined
Process.args()          // String[] — empty in browser
Process.env("HOME")     // String? — null if not found or browser
```

---

## `std/encoding` — Base64, UTF8

```js
import { Base64, UTF8 } from "std/encoding";

Base64.encode(buf = usize(0), len = usize(0))   // String
Base64.decode(s = "", outLen = Box)             // u8?

UTF8.validate(s = "")     // bool
UTF8.charCount(s = "")    // usize — Unicode codepoints
```

---

## JavaScript Target Modules

The following modules are specific to the `wasm32-js-*` targets. All types and functions are importable on any target; on non-`wasm32-js-*` targets all values are null/no-op and CW-JS01 fires once per file.

---

## `std/js` — JS Interop Core

Available on all targets. On non-`wasm32-js-*` targets, all types are null/no-op (CW-JS01 fires once per file).

```js
import { JSObject, JSValue, JSFn, JSSymbol,
         jsGlobal, jsGlobalThis,
         jsSymbol, jsSymbolFor,
         JS_SYMBOL_ITERATOR, JS_SYMBOL_ASYNC_ITERATOR,
         JS_SYMBOL_TO_PRIMITIVE, JS_SYMBOL_TO_STRING_TAG,
         JS_SYMBOL_HAS_INSTANCE, JS_SYMBOL_DISPOSE,
         JSUndefined, JSNull, JSBool, JSInt, JSNumber,
         JSBigInt, JSString, JSObj, JSArr } from "std/js";
```

### `JSObject`

Opaque reference to any JS heap value. `i32` externref table index. Nullable (index 0). All operations are **instance methods** — called on the object handle directly.

```js
// property access — typed variants throw JS TypeError if value doesn't match type
obj.get(key = "")                            // JSValue — always succeeds
obj.getStr(key = "")                         // str
obj.getF64(key = "")                         // f64
obj.getI32(key = "")                         // i32
obj.getBool(key = "")                        // bool
obj.getObj(key = "")                         // JSObject?

// property set
obj.set(key = "", val = JSValue)             // undefined
obj.setStr(key = "", val = "")               // undefined
obj.setF64(key = "", val = 0.0)             // undefined
obj.setI32(key = "", val = i32(0))          // undefined
obj.setBool(key = "", val = false)          // undefined

// Symbol-keyed property access
obj.getSymbol(key = JSSymbol)                // JSValue
obj.setSymbol(key = JSSymbol, val = JSValue) // undefined
obj.hasSymbol(key = JSSymbol)                // bool
obj.deleteSymbol(key = JSSymbol)             // bool
obj.callSymbol(key = JSSymbol, ...)          // JSValue — obj[key](...)

// method calls — typed variants throw JS TypeError if return doesn't match type
obj.call(method = "", ...)                   // JSValue — always succeeds
obj.callStr(method = "", ...)                // str
obj.callF64(method = "", ...)                // f64
obj.callI32(method = "", ...)                // i32
obj.callBool(method = "", ...)               // bool
obj.callObj(method = "", ...)                // JSObject?
obj.callVoid(method = "", ...)               // undefined

// type introspection
obj.typeof()                                 // str — "object", "function", "number" etc.
obj.instanceof(ctor = JSObject)              // bool — obj instanceof ctor
obj.isArray()                                // bool
obj.isJSNull()                               // bool — JS null value (not WASM null index 0)
obj.isUndefined()                            // bool — JS undefined value

// conversion to js.wat primitives — applies JS coercion semantics
obj.toStr()                                  // String — JS toString()
obj.toF64()                                  // f64 — JS Number()
obj.toI32()                                  // i32 — JS Number() then | 0
obj.toBool()                                 // bool — JS Boolean() / truthy coercion

// identity
obj.eq(other = JSObject)                     // bool — ===
```

**Static (module-level functions, not on an instance):**

```js
JSObject.new(ctor = JSObject, ...)           // JSObject — new ctor(...)
jsGlobal(name = "")                          // JSObject — globalThis[name]
jsGlobalThis()                               // JSObject — globalThis
```

**Bridge implementation of a `callSymbol` call:**

```js
// adapter generated by compiler for: obj.callSymbol(JS_SYMBOL_ITERATOR)
__jswat_obj_callSymbol: (objIdx, symIdx, ...argIdxs) => {
  const obj = _extGet(objIdx);
  const sym = _extGet(symIdx);
  const result = obj[sym](...argIdxs.map(_unwrapArg));
  return _wrapJSValue(result);
}
```

### `JSValue`

Sealed union of nine variants representing any JS value. Never WASM-nullable. All operations are **instance methods** on the base class, dispatched by variant tag.

**Variants:**

```js
class JSValue     { static $variants = []; }  // compiler-sealed
class JSUndefined extends JSValue { }
class JSNull      extends JSValue { }
class JSBool      extends JSValue { value; }   // bool
class JSInt       extends JSValue { value; }   // i32 — JS integers in [-2^31, 2^31-1]
class JSNumber    extends JSValue { value; }   // f64 — all other JS numbers
class JSBigInt    extends JSValue { value; }   // i64
class JSString    extends JSValue { value; }   // str — bridge-allocated, freed on scope exit
class JSObj       extends JSValue { value; }   // JSObject — extref, freed on scope exit
class JSArr       extends JSValue {
  value;    // JSObject — the JS array
  length;   // usize — populated eagerly from JS array.length
}
```

`JSInt` is produced when the bridge wraps a JS `number` that passes `Number.isInteger(v) && v >= -2147483648 && v <= 2147483647`. All other numbers become `JSNumber`. This is purely a bridge decision — there is no user-visible distinction in the type system other than the variant name.

**Narrowing — switch must be exhaustive (compiler enforces):**

```js
switch (val) {
  case JSUndefined: ...
  case JSNull:      ...
  case JSBool:      val.value   // bool
  case JSInt:       val.value   // i32
  case JSNumber:    val.value   // f64
  case JSBigInt:    val.value   // i64
  case JSString:    val.value   // str
  case JSObj:       val.value   // JSObject
  case JSArr:       val.value; val.length   // JSObject; usize
}
```

**Instance methods (base class, static dispatch on tag — no bridge call for primitive variants):**

```js
// narrowing helpers
val.isNullish()                      // bool — JSNull or JSUndefined
val.isTruthy()                       // bool — JS truthiness semantics
val.isString()                       // bool — JSString variant
val.isNumber()                       // bool — JSNumber or JSInt
val.isBool()                         // bool — JSBool variant
val.isObject()                       // bool — JSObj or JSArr variant
val.isArray()                        // bool — JSArr variant only
val.isBigInt()                       // bool — JSBigInt variant

// as* — type-match or fallback (no coercion)
val.asStr(fallback = "")             // str   — JSString.value or fallback
val.asF64(fallback = 0.0)           // f64   — JSNumber or JSInt value, else fallback
val.asI32(fallback = i32(0))        // i32   — JSInt, or truncated JSNumber, else fallback
val.asBool(fallback = false)        // bool  — JSBool.value, else fallback
val.asObj()                          // JSObject? — JSObj/JSArr .value, else null
val.asBigInt(fallback = i64(0))     // i64   — JSBigInt.value, else fallback

// coerce* — applies JS's own type coercion rules exactly
// Primitive variants: static dispatch, no bridge call.
// JSObj/JSArr variants: bridge call to JS Number()/String()/Boolean().
val.coerceStr()                      // String — JS String(value)
val.coerceF64()                      // f64   — JS Number(value)
val.coerceI32()                      // i32   — JS (value | 0)
val.coerceBool()                     // bool  — JS Boolean(value)
```

**Coercion rules (static dispatch for primitives):**

`coerceStr()`: `JSNull`→`"null"`, `JSUndefined`→`"undefined"`, `JSBool(b)`→`"true"`/`"false"`, `JSInt(n)`→decimal, `JSNumber(n)`→shortest round-trip (Ryu), `JSBigInt(n)`→decimal no `n` suffix, `JSString(s)`→identity, `JSObj`/`JSArr`→bridge `String(obj)`.

`coerceF64()`: `JSNull`→`0.0`, `JSUndefined`→NaN, `JSBool(false)`→`0.0`, `JSBool(true)`→`1.0`, `JSInt(n)`→`f64(n)`, `JSNumber(n)`→identity, `JSBigInt(n)`→`f64(n)` (may lose precision), `JSString(s)`→parse as number (NaN if unparseable), `JSObj`/`JSArr`→bridge `Number(obj)`.

`coerceI32()`: apply `coerceF64()` then `| 0` (signed 32-bit truncation).

`coerceBool()`: `JSUndefined`, `JSNull`, `JSBool(false)`, `JSInt(0)`, `JSNumber(0.0)`, `JSNumber(NaN)`, `JSBigInt(0)`, `JSString("")` → `false`; everything else → `true`.

**Static factory methods:**

```js
JSValue.fromStr(v = "")            // JSValue — JSString variant
JSValue.fromF64(v = 0.0)          // JSValue — JSNumber variant
JSValue.fromI32(v = i32(0))       // JSValue — JSInt variant
JSValue.fromBool(v = false)       // JSValue — JSBool variant
JSValue.fromBigInt(v = i64(0))    // JSValue — JSBigInt variant
JSValue.fromObj(v = JSObject)     // JSValue — JSObj variant
JSValue.null()                     // JSValue — JSNull variant
JSValue.undefined()                // JSValue — JSUndefined variant
```

**`JSArr` additional instance methods:**

```js
arr.at(i = usize(0))                           // JSValue
arr.push(val = JSValue)                        // undefined
arr.forEach(fn = JSFn(JSValue => undefined))   // undefined
```

**Constructor-cast integration:**

```js
JSValue(x)    // wrap any js.wat primitive as JSValue — selects from* at compile time
f64(jsVal)    // jsVal.asF64(0.0)  — extract, no coercion
i32(jsVal)    // jsVal.asI32(0)
str(jsVal)    // jsVal.asStr("")
bool(jsVal)   // jsVal.asBool(false)
```

On non-`wasm32-js-*` targets: all `JSValue` instances are `JSNull`. All `as*`/`coerce*` return their zero fallback. `JSValue.from*` returns `JSNull`. `JSArr.length` is `0`.

### `JSFn<sig>`

Typed JS function reference. `i32` externref table index. Nullable. Distinct from `Fn(...)` — CE-T01 if used interchangeably.

```js
JSFn(isize => bool)             // one param, one return
JSFn(str, f64 => JSValue)       // two params
JSFn(() => undefined)           // no params, no return
JSFn(JSObject => JSObject)     // nullable
```

Calling a `JSFn` generates a dedicated WASM import per signature: `__jswat_call_jsfn_<encoded_sig>`. Different signatures produce different imports. The bridge unmarshals WASM-level parameters to plain JS values, calls the function, and marshals the return.

**Casting:**
- `JSObject(fn)` — widen to `JSObject`. Always valid. Zero cost.
- `JSObject` → `JSFn`: requires `@returns` annotation. No runtime check — JS TypeError if not callable.

### `JSSymbol`

Opaque reference to a JS `Symbol` value. `i32` externref table index. Nullable. Distinct from `JSObject` — CE-T01 if used interchangeably. `JSSymbol` cannot be widened to `JSObject` and vice versa.

A `Symbol()` creates a unique unforgeable identity token. The description string is documentation only — two calls with the same description produce different symbols.

**Creating symbols:**

```js
jsSymbol("description")        // JSSymbol — fresh Symbol("description"). Unique per call.
                               // ALWAYS use at module scope as a const, not inside functions.
jsSymbolFor("com.app.key")     // JSSymbol — Symbol.for("com.app.key"), global registry.
                               // Same key always returns the same symbol.
```

`jsSymbol` at module scope creates the symbol once. Calling inside a loop or function creates a new (distinct) symbol every time, which is almost always a bug.

**Well-known symbol constants (pre-acquired at bridge init):**

```js
JS_SYMBOL_ITERATOR         // Symbol.iterator
JS_SYMBOL_ASYNC_ITERATOR   // Symbol.asyncIterator
JS_SYMBOL_TO_PRIMITIVE     // Symbol.toPrimitive
JS_SYMBOL_TO_STRING_TAG    // Symbol.toStringTag
JS_SYMBOL_HAS_INSTANCE     // Symbol.hasInstance
JS_SYMBOL_DISPOSE          // Symbol.dispose
```

**Instance method:**

```js
sym.eq(other = JSSymbol)   // bool — same Symbol? (===)
```

**Using as object keys:**

```js
obj.getSymbol(JS_SYMBOL_ITERATOR)          // JSValue — obj[Symbol.iterator]
obj.callSymbol(JS_SYMBOL_ITERATOR)         // JSValue — obj[Symbol.iterator]()
obj.setSymbol(myTag, JSValue.fromStr("x")) // obj[myTag] = "x"
obj.hasSymbol(myTag)                       // bool
obj.deleteSymbol(myTag)                    // bool
```

**Bridge implementation note:** `jsSymbol` and `jsSymbolFor` are bridge functions:

```js
__jswat_symbol_new: (descPtr, descLen) => _extSet(Symbol(_readStr(descPtr, descLen))),
__jswat_symbol_for: (keyPtr,  keyLen)  => _extSet(Symbol.for(_readStr(keyPtr, keyLen))),
```

Well-known constants are acquired at module init:

```js
const JS_SYMBOL_ITERATOR = _extSet(Symbol.iterator);
const JS_SYMBOL_DISPOSE  = _extSet(Symbol.dispose);
// ... etc.
```

On non-`wasm32-js-*` targets: `jsSymbol`/`jsSymbolFor` return null. All symbol operations are no-ops.

## `std/js/dom` — DOM Bindings

`.jsbind.js` module. Available on `wasm32-js-*`. Degrades to null/no-op on other targets.

```js
import { document, HTMLElement, MouseEvent, KeyboardEvent } from "std/js/dom";
```

**`HTMLElement`** — `@jsbind.type` wrapping DOM elements:

```js
el.getAttribute(name = "")                   // str?
el.setAttribute(name = "", val = "")         // undefined
el.removeAttribute(name = "")               // undefined
el.hasAttribute(name = "")                  // bool
el.classList.add(cls = "")                  // undefined
el.classList.remove(cls = "")               // undefined
el.classList.toggle(cls = "")               // bool
el.classList.has(cls = "")                  // bool
el.style.set(prop = "", val = "")           // undefined
el.style.get(prop = "")                     // str?
el.appendChild(child = HTMLElement)         // undefined
el.removeChild(child = HTMLElement)         // undefined
el.remove()                                  // undefined
el.addEventListener(event = "", fn = JSFn(JSObject => undefined))   // undefined
el.removeEventListener(event = "", fn = JSFn(JSObject => undefined)) // undefined
el.getBoundingClientRect()                  // DOMRect (struct — see below)
el.querySelector(sel = "")                  // HTMLElement?
el.querySelectorAll(sel = "")              // HTMLElement[]

// getters/setters
el.textContent     // str (get) / str (set)
el.innerHTML       // str (get) / str (set)
el.id              // str (get) / str (set)
el.className       // str (get) / str (set)
el.tagName         // str (read-only)
el.parentElement   // HTMLElement?
el.children        // HTMLElement[]
```

`DOMRect` is a value struct returned by `getBoundingClientRect()`:

```js
// returned as a js.wat class with fields:
class DOMRect {
  x; y; width; height; top; right; bottom; left;
  // all f64
}
```

**`document` static interface:**

```js
document.getElementById(id = "")           // HTMLElement?
document.querySelector(sel = "")           // HTMLElement?
document.querySelectorAll(sel = "")        // HTMLElement[]
document.createElement(tag = "")          // HTMLElement
document.createTextNode(text = "")        // HTMLElement
document.body                              // HTMLElement?
document.head                              // HTMLElement?
document.title                             // str (get/set)
```

**Event helpers (static functions — take `JSObject` event parameter):**

```js
MouseEvent.clientX(e = JSObject)     // f64
MouseEvent.clientY(e = JSObject)     // f64
MouseEvent.button(e = JSObject)      // i32
MouseEvent.shiftKey(e = JSObject)    // bool
MouseEvent.ctrlKey(e = JSObject)     // bool
MouseEvent.altKey(e = JSObject)      // bool
MouseEvent.target(e = JSObject)      // HTMLElement?
Event.preventDefault(e = JSObject)  // undefined
Event.stopPropagation(e = JSObject)  // undefined

KeyboardEvent.key(e = JSObject)      // str
KeyboardEvent.code(e = JSObject)     // str
KeyboardEvent.repeat(e = JSObject)   // bool
KeyboardEvent.shiftKey(e = JSObject) // bool
KeyboardEvent.ctrlKey(e = JSObject)  // bool
```

---

## `std/js/canvas` — 2D and WebGL2

```js
import { Canvas2D, Canvas2DContext, WebGL2 } from "std/js/canvas";
```

**`Canvas2DContext`** — `@jsbind.type`:

```js
ctx.clearRect(x = 0.0, y = 0.0, w = 0.0, h = 0.0)          // undefined
ctx.fillRect(x = 0.0, y = 0.0, w = 0.0, h = 0.0)           // undefined
ctx.strokeRect(x = 0.0, y = 0.0, w = 0.0, h = 0.0)         // undefined
ctx.fillText(text = "", x = 0.0, y = 0.0)                   // undefined
ctx.strokeText(text = "", x = 0.0, y = 0.0)                 // undefined
ctx.measureText(text = "")                                    // f64 — width
ctx.beginPath()                                              // undefined
ctx.closePath()                                              // undefined
ctx.moveTo(x = 0.0, y = 0.0)                               // undefined
ctx.lineTo(x = 0.0, y = 0.0)                               // undefined
ctx.arc(x = 0.0, y = 0.0, r = 0.0, start = 0.0, end = 0.0)  // undefined
ctx.bezierCurveTo(cp1x = 0.0, cp1y = 0.0, cp2x = 0.0, cp2y = 0.0, x = 0.0, y = 0.0)  // undefined
ctx.fill()                                                   // undefined
ctx.stroke()                                                 // undefined
ctx.save()                                                   // undefined
ctx.restore()                                                // undefined
ctx.translate(x = 0.0, y = 0.0)                            // undefined
ctx.rotate(angle = 0.0)                                     // undefined
ctx.scale(x = 0.0, y = 0.0)                                // undefined
ctx.setTransform(a = 0.0, b = 0.0, c = 0.0, d = 0.0, e = 0.0, f = 0.0)  // undefined
ctx.drawImageData(buf = List, T = u8, width = usize(0))     // undefined — RGBA pixel data

// getters/setters
ctx.fillStyle       // str (get/set)
ctx.strokeStyle     // str (get/set)
ctx.lineWidth       // f64 (get/set)
ctx.font            // str (get/set)
ctx.globalAlpha     // f64 (get/set)
ctx.canvas          // JSObject — the canvas element
```

**`Canvas2D` static:**

```js
Canvas2D.getContext(canvasId = "")   // Canvas2DContext?
```

**`WebGL2`** — `@jsbind.type`. All methods follow the standard WebGL2 API. Key differences from raw WebGL:

- `bufferData(target, buf, T, usage)` where `buf` is `List<T>` — generates a zero-copy `TypedArray` view into `SharedArrayBuffer` linear memory
- `uniformMatrix4fv(loc, transpose, buf, T)` — same zero-copy path
- WebGL handles (buffers, shaders, programs, textures, VAOs) are `i32` — stored in the WebGL handle table, not the externref table

```js
WebGL2.getContext(canvasId = "")   // WebGL2?

// handle creation
gl.createBuffer()                  // i32
gl.createShader(type = i32)        // i32
gl.createProgram()                 // i32
gl.createTexture()                 // i32
gl.createVertexArray()             // i32

// buffer ops — zero-copy List<T> path
gl.bufferData(target = i32, buf = List, T = f32, usage = i32)          // undefined
gl.bufferSubData(target = i32, offset = usize, buf = List, T = f32)    // undefined
gl.texImage2D_rgba(target = i32, level = i32, w = i32, h = i32, buf = List, T = u8)

// uniforms — zero-copy List<T> path
gl.uniformMatrix4fv(loc = i32, transpose = false, buf = List, T = f32) // undefined
gl.uniform1f(loc = i32, v = 0.0)        // undefined
gl.uniform2f(loc = i32, x = 0.0, y = 0.0)
gl.uniform3f(loc = i32, x = 0.0, y = 0.0, z = 0.0)
gl.uniform4f(loc = i32, x = 0.0, y = 0.0, z = 0.0, w = 0.0)
gl.uniform1i(loc = i32, v = i32(0))    // undefined

// standard WebGL2 operations (complete — not exhaustive here)
gl.bindBuffer(target = i32, buffer = i32)
gl.bindVertexArray(vao = i32)
gl.useProgram(program = i32)
gl.shaderSource(shader = i32, source = "")
gl.compileShader(shader = i32)
gl.attachShader(program = i32, shader = i32)
gl.linkProgram(program = i32)
gl.getProgramLinkStatus(program = i32)   // bool
gl.getShaderInfoLog(shader = i32)        // String
gl.getAttribLocation(program = i32, name = "")   // i32
gl.getUniformLocation(program = i32, name = "")  // i32
gl.vertexAttribPointer(index = i32, size = i32, type = i32, normalized = false, stride = i32, offset = i32)
gl.enableVertexAttribArray(index = i32)
gl.drawArrays(mode = i32, first = i32, count = i32)
gl.drawElements(mode = i32, count = i32, type = i32, offset = i32)
gl.enable(cap = i32)
gl.disable(cap = i32)
gl.viewport(x = i32, y = i32, w = i32, h = i32)
gl.clearColor(r = 0.0, g = 0.0, b = 0.0, a = 1.0)
gl.clear(mask = i32)

// WebGL constants (static fields — full set available)
WebGL2.ARRAY_BUFFER              // i32
WebGL2.ELEMENT_ARRAY_BUFFER      // i32
WebGL2.STATIC_DRAW               // i32
WebGL2.DYNAMIC_DRAW              // i32
WebGL2.FLOAT                     // i32
WebGL2.UNSIGNED_SHORT            // i32
WebGL2.UNSIGNED_INT              // i32
WebGL2.TRIANGLES                 // i32
WebGL2.VERTEX_SHADER             // i32
WebGL2.FRAGMENT_SHADER           // i32
WebGL2.COLOR_BUFFER_BIT          // i32
WebGL2.DEPTH_TEST                // i32
WebGL2.BLEND                     // i32
WebGL2.TEXTURE_2D                // i32
WebGL2.RGBA                      // i32
WebGL2.UNSIGNED_BYTE             // i32
// ... full WebGL2 constant set
```

---

## `std/js/audio` — Web Audio API

```js
import { AudioContext, AudioNode } from "std/js/audio";

const ctx = new AudioContext();
const osc  = ctx.createOscillator();       // AudioNode
const gain = ctx.createGain();             // AudioNode

AudioNode.connect(osc, gain);
AudioNode.connect(gain, ctx.destination);
AudioNode.setParam(osc, "frequency", 440.0);
AudioNode.setParam(gain, "gain", 0.5);
AudioNode.start(osc);
AudioNode.stop(osc, ctx.currentTime + 1.0);

ctx.currentTime   // f64
ctx.close()       // undefined
```

---

## `std/js/worker` — Web Workers

```js
import { Worker } from "std/js/worker";

const w = Worker.spawn(workerUrl = "")                         // Worker
Worker.post(w, msg = JSObject)                                  // undefined
Worker.onMessage(w, handler = JSFn(JSObject => undefined))     // undefined
Worker.terminate(w)                                             // undefined

// from worker thread
Worker.postToMain(msg = JSObject)                               // undefined
Worker.onMainMessage(handler = JSFn(JSObject => undefined))    // undefined
```

---

## `std/js/storage` — Web Storage

```js
import { localStorage, sessionStorage } from "std/js/storage";

localStorage.set(key = "", val = "")    // undefined
localStorage.get(key = "")             // String?
localStorage.remove(key = "")          // undefined
localStorage.clear()                    // undefined
localStorage.length                     // usize
localStorage.key(i = usize(0))         // String?
```

---

## `std/js/net` — fetch

```js
import { fetch } from "std/js/net";

fetch(url = "", callback = JSFn(JSObject, JSObject? => undefined)) { }

fetch("https://api.example.com/data", {
  method: "POST",
  body: JSValue.fromStr(jsonStr),
  headers: [["Content-Type", "application/json"]]
}, (response = JSObject, err = JSObject?) => {
  if (err != null) { handleError(err); return; }
  const status = response.getI32("status");
});
```

Async execution happens on the JS side. The callback is called from JS back into WASM when the response arrives.

---


## Implicit Prelude

Never imported — always in scope. Tree-shaking applies — unused members contribute zero bytes.

**Always in scope:**

```
std/string:      String
std/io:          console
std/math:        Math
std/random:      Random
std/range:       Range
std/collections: Map, Set, Stack, Queue, Deque, List
std/error:       AppError, ValueError, RangeError, IOError, ParseError, NotFoundError
alloc            (compiler builtin — no import)
```

**`alloc` builtin — always in scope, no import required:**

```js
alloc.create(Type)                     // T — manual allocation, all defaults
alloc.create(Type, ...args)            // T — positional args
alloc.create(Type, { key: val })       // T — named arg block
alloc.free(e)                          // undefined — dispose + free, consumes binding
alloc.arena(size = usize(0))           // Arena — 0 = growable
alloc.pool(Type, capacity = usize(0))  // Pool<T>
```

**Requires explicit import:**

```js
import { iter }              from "std/iter";
import { StepRange }         from "std/range";
import { Clock }             from "std/clock";
import { FS }                from "std/fs";
import { Process }           from "std/process";
import { Base64, UTF8 }      from "std/encoding";

import { Result }            from "std/result";
import { ptr, rawAlloc }     from "std/mem";
import { ... }               from "std/wasm";

// JS types (all targets — null/no-op on non-JS targets)
import { JSObject, JSValue, JSFn, JSSymbol,
         jsGlobal, jsGlobalThis, jsSymbol, jsSymbolFor,
         JS_SYMBOL_ITERATOR, JS_SYMBOL_DISPOSE,
         JSUndefined, JSNull, JSBool, JSInt, JSNumber,
         JSBigInt, JSString, JSObj, JSArr } from "std/js";

// JS domain modules (all targets — null/no-op on non-JS targets)
import { document, HTMLElement, MouseEvent, KeyboardEvent } from "std/js/dom";
import { Canvas2D, Canvas2DContext, WebGL2 }                from "std/js/canvas";
import { AudioContext, AudioNode }                           from "std/js/audio";
import { Worker }                                            from "std/js/worker";
import { localStorage, sessionStorage }                     from "std/js/storage";
import { fetch }                                             from "std/js/net";
```

Explicit import of a prelude member — CW-M10.

---

*End of js.wat Standard Library Reference v1.7*