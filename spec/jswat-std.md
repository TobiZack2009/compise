# js.wat Standard Library Reference
### Version 1.6

> Complete API reference for all `std/*` modules.
> Prelude members are always in scope — no import needed.

**v1.6 changes:** `str` is now a fat pointer `(ptr, len)` · `str` is nullable · `void` replaced by `undefined` in all return positions · `rawAlloc` replaces `alloc` in `std/mem` · `alloc` builtin always in scope without import · `.raise()` replaces `?` propagation operator

*See also: [jswat-spec.md](jswat-spec.md) — Language Spec | [jswat-compiler.md](jswat-compiler.md) — Compiler Reference*

---

## Module Map

```
std/
├── core          — compiler builtins (always linked, zero imports)
├── wasm          — WASM instruction intrinsics
├── mem           — ptr, rawAlloc (raw), Arena, Pool
├── math          — Math (default export)
├── string        — String, StringBuilder
├── random        — Random (default export)
├── range         — Range, StepRange
├── iter          — iter() combinator chain
├── collections   — Map, Set, Stack, Queue, Deque
├── result        — Result<T>
├── error         — AppError and subclasses
├── io            — console, stdout, stderr, stdin
├── fs            — FS
├── clock         — Clock
├── process       — Process
└── encoding      — Base64, UTF8
```

---

## Target Availability

All stdlib modules are written in js.wat source with `__target_*` compile-time globals gating target-specific branches. Level 5 DCE folds these at compile time — the binary contains exactly one implementation path per module per target. Layer 1 modules (pure computation) have no target branches and produce identical code on all targets.

| Module | `wasip1` | `unknown` | `ld` | `component` |
|---|---|---|---|---|
| `std/core`, `std/wasm`, `std/mem` | ✅ | ✅ | ✅ | ✅ |
| `std/math`, `std/string`, `std/encoding` | ✅ | ✅ | ✅ | ✅ |
| `std/collections`, `std/error`, `std/range`, `std/iter`, `std/result` | ✅ | ✅ | ✅ | ✅ |
| `std/random` | ✅ WASI-seeded | ⚠️ seed=0, hook | ✅ WASI-seeded | ✅ WIT-seeded |
| `std/io` | ✅ | ⚠️ no-op, hook | ✅ | ✅ WIT |
| `std/fs` | ✅ | ⚠️ null/false | ✅ | ✅ WIT |
| `std/clock` | ✅ | ⚠️ returns 0 | ✅ | ✅ WIT |
| `std/process` | ✅ | ⚠️ exit traps | ✅ | ✅ WIT |

`wasm32-ld` is identical to `wasm32-wasip1` for all system modules — both emit `wasi_snapshot_preview1` imports; the linker resolves them. Only allocator sourcing differs, which is internal to `std/mem` and `runtime.wat`.

For `wasm32-unknown`, ⚠️ modules degrade silently by default. The programmer can inject host implementations via `@external` hooks (see spec — Host Interop).

---

## `std/wasm` — WASM Instruction Intrinsics

Single WASM instruction per function. Compiler inlines the instruction directly — zero call overhead. Explicit import required — signals low-level intent.

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

**Tier 2 — raw memory ops, bypass type system:**

```js
import { i32_load, i32_store, i32_load8_s, i32_load8_u, i32_store8,
         i32_load16_s, i32_load16_u, i32_store16,
         i64_load, i64_store, f32_load, f32_store, f64_load, f64_store,
         memory_size, memory_grow, memory_copy, memory_fill } from "std/wasm";
```

Use Tier 2 only in allocator internals and low-level encoding code.

---

## `std/mem` — Raw Memory

Explicit import required. All operations here are untracked and unsafe. These are distinct from the `alloc` compiler builtin (always in scope) which handles typed GC-managed and manual allocations.

```js
import { ptr, rawAlloc } from "std/mem";
```

**Raw pointer operations:**

```js
ptr.fromAddr(addr = usize(0), type)  // raw typed pointer — unowned, untracked
ptr.diff(a, b)                        // isize — address difference
```

`ptr.fromAddr` produces an unowned pointer. No RC, no sentinel, no lifetime tracking. Use-after-free is RT-08 in debug, UB in release.

**Raw byte allocation:**

```js
rawAlloc.bytes(n = usize(0))                           // u8? — zeroed buffer
rawAlloc.bytes(n = usize(0), fill = u8(0))             // u8? — filled buffer
rawAlloc.realloc(buf = usize(0), newSize = usize(0))   // u8? — resize, old ptr invalid
rawAlloc.copy(dst = usize(0), src = usize(0), n = usize(0))         // undefined
rawAlloc.fill(dst = usize(0), value = u8(0), n = usize(0))          // undefined
```

These operations return raw byte addresses with no header. Use `ptr.fromAddr` to access typed data within raw buffers.

---

## `std/math` — Math

```js
import Math from "std/math";  // or use from prelude — Math is always in scope
```

All functions are pure js.wat — no host imports required.

**Constants:** `Math.PI`, `Math.E`, `Math.LN2`, `Math.LN10`, `Math.LOG2E`, `Math.LOG10E`, `Math.SQRT2`, `Math.SQRT1_2`

**Reinterpret (single WASM instruction each):**

```js
Math.reinterpretAsI64(x = 0.0)        // f64 → i64
Math.reinterpretAsF64(x = i64(0))     // i64 → f64
Math.reinterpretAsI32(x = f32(0.0))   // f32 → i32
Math.reinterpretAsF32(x = i32(0))     // i32 → f32
```

**Float (monomorphizes for f32/f64):** `sqrt`, `floor`, `ceil`, `round`, `trunc`, `fround`

**Arithmetic (all numeric types):** `abs`, `min`, `max`, `sign`, `clamp`

**Transcendental (f64):** `exp`, `expm1`, `log`, `log1p`, `log2`, `log10`, `pow`, `cbrt`, `hypot`

**Trig (f64):** `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`

**Integer-specific:** `clz32`, `imul`, `popcnt`

**Extras:**

```js
Math.lerp(a = Float, b = Float, t = Float)
Math.smoothstep(e0 = Float, e1 = Float, x = Float)
Math.map(val = Float, inMin = Float, inMax = Float, outMin = Float, outMax = Float)
Math.degToRad(deg = Float)
Math.radToDeg(rad = Float)
Math.random()   // f64 — alias to global Random instance
```

---

## `std/string` — String, StringBuilder

`String` is in the implicit prelude. `StringBuilder` requires explicit import.

```js
import { StringBuilder } from "std/string";
```

**`String` — full method surface:**

Read methods (available on both `str` and `String`):

```js
s.length                          // usize
s.at(n = usize(0))                // str
s.slice(s = usize(0), e = usize(0))  // str (str source) / String (String source)
s.indexOf(sub = "")               // isize? — null if not found
s.lastIndexOf(sub = "")           // isize?
s.includes(sub = "")              // bool
s.startsWith(pre = "")            // bool
s.endsWith(suf = "")              // bool
s.trim()                          // str (str source) / String (String source)
s.trimStart()                     // str / String
s.trimEnd()                       // str / String
s.toUpperCase()                   // String — always allocates
s.toLowerCase()                   // String — always allocates
s.replace(from = "", to = "")     // String — always allocates
s.replaceAll(from = "", to = "")  // String — always allocates
s.split(sep = "")                 // str[] — no allocation
s.padStart(n = usize(0), fill = "")  // String — always allocates
s.padEnd(n = usize(0), fill = "")    // String — always allocates
s.repeat(n = usize(0))            // String — always allocates
```

Mutation methods (mutable `let` `String` binding, unaliased only):

```js
s.append(other = "")           // undefined — CE-S01 if aliased, CE-S03 if const
s.set(i = usize(0), ch = "")  // undefined — single character replacement
```

Low-level (`$`-prefixed):

```js
s.$asView()    // str — zero-copy fat pointer into this String's buffer.
               //       Compiler promotes automatically if str escapes scope.
s.$dataPtr()   // usize — raw UTF-8 buffer address (past header)
s.$capacity    // usize
```

Static:

```js
String.fromCodePoint(cp = u32(0))  // String
```

**`str` — immutable string slice. Nullable. Fat pointer `(ptr: usize, len: usize)`.**

`str` literals live in the WASM data segment as raw UTF-8 bytes with no header prefix. `str` is nullable — null sentinel is `ptr == 0`. An empty non-null `str` has `ptr != 0` and `len == 0`.

On the non-escaping path, `str` is a zero-allocation fat pointer. When the compiler detects escape (field assignment, closure capture, return, collection storage), it automatically promotes to a `StrRef` — a heap-allocated RC object that holds `(ptr, len)` and a strong reference to the owning `String`. Promotion is invisible to the programmer.

```js
str.fromCodePoint(cp = u32(0))  // str — single codepoint, data segment
```

**`StringBuilder` — building strings in loops without intermediate allocations:**

```js
const sb = new StringBuilder();
sb.append(s = "")    // undefined
sb.build()           // String
sb.$length           // usize — current content length
sb.$capacity         // usize
```

---

## `std/random` — Random

```js
import Random from "std/random";  // or use from prelude — Random is always in scope
```

xoshiro256** PRNG. Seeded from `wasi_random_get` on `wasm32-wasip1`/`wasm32-ld`. Seeded from WIT random interface on `wasm32-component`. Defaults to seed 0 on `wasm32-unknown` unless the host provides seed via hook or exported function.

```js
const rng = new Random(42);  // seeded — deterministic
rng.float()                  // f64 in [0.0, 1.0)
rng.int()                    // isize
rng.range(min = 0, max = 0)  // isize — inclusive
rng.bool()                   // bool
rng.seed(s = 0)              // undefined

Random.float()               // global instance
Random.seed(s = 0)           // undefined
Math.random()                // alias to Random.float()
```

On `wasm32-unknown`, expose a seed entry point if needed:

```js
/** @export seed_rng */
function seedRng(s = 0) { Random.seed(s); }
```

---

## `std/range` — Range, StepRange

```js
import { StepRange } from "std/range";  // Range is in the prelude
```

```js
for (const i of new Range(usize(0), usize(10))) { }       // 0..9
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

const first5 = iter(myArray).take(usize(5)).collect();
```

**Lazy combinators:** `map`, `filter`, `take`, `skip`

**Terminators:** `collect`, `forEach`, `reduce`, `count`, `find`, `any`, `all`, `sum`, `min`, `max`

**Generator — lazy sequence from a function, `null` = end:**

```js
iter.from(fn = Fn(() => T?))   // Iter<T>
```

```js
// Infinite random sequence
const randoms = iter.from(() => Random.float());
randoms.take(usize(10)).collect();  // f64[10]
```

---

## `std/collections` — Map, Set, Stack, Queue, Deque

All in the implicit prelude.

**`Map<K, V>`** — open-addressing Robin Hood hash table. K must implement `Symbol.hash` (returns `isize`) and `Symbol.equals`:

```js
const m = new Map(Symbol.hash, isize(0));
m.set(key, 42);
m.get(key);     // isize? — null if not found
m.has(key);     // bool
m.delete(key);  // bool
m.size;         // usize
for (const entry of m) { entry.key; entry.val; }
```

**`Set<T>`** — wraps `Map<T, bool>`:

```js
const s = new Set(Symbol.hash);
s.add(key); s.has(key); s.delete(key); s.size;
```

**`Stack<T>`:** `push`, `pop` (`T?`), `peek`, `size`, `empty`

**`Queue<T>`:** `enqueue`, `dequeue` (`T?`), `peek`, `size`, `empty`

**`Deque<T>`:** `pushFront`, `pushBack`, `popFront` (`T?`), `popBack` (`T?`), `peekFront`, `peekBack`, `size`, `empty`

All `pop`/`dequeue`/`popFront`/`popBack` methods return `T?` — null if empty, never panic.

---

## `std/result` — Result<T>

```js
import { Result } from "std/result";
```

Makes recoverable error paths visible in function return types.

```js
Result.ok(value)           // Result<T> — success
Result.err(error)          // Result<T> — error must extend AppError

result.ok                  // T? — null if error
result.err                 // AppError? — null if ok
result.unwrap()            // T — throws if error
result.unwrapOr(fallback)  // T — fallback if error
result.isOk()              // bool
result.isErr()             // bool
result.raise()             // T — if called inside @returns {Result<T>} function:
                           //     returns error early if err, unwraps if ok.
                           //     outside that context: throws on error, returns value on ok.
```

`.raise()` is valid JS at runtime. The compiler recognizes it inside a `@returns {Result<T>}` function and emits early-return code instead of a throw. Outside that context it behaves as a normal method call — CE-T10 is not raised, no special behaviour.

```js
/** @returns {Result<isize>} */
function processLine(line = "") {
  const n = parseInt(line).raise();  // propagates error early if err, unwraps if ok
  return Result.ok(n * 2);
}
```

---

## `std/error` — Error Hierarchy

All in the implicit prelude.

All extend `AppError` with a `message: str` field. All implement `Symbol.toStr`.

```
AppError
├── ValueError      — invalid argument or value
├── RangeError      — out of bounds
├── IOError         — I/O failure
├── ParseError      — parse failure
└── NotFoundError   — resource not found
```

---

## `std/io` — console, stdout, stderr, stdin

`console` is in the implicit prelude. Others require import.

```js
import { stdout, stderr, stdin } from "std/io";

console.log("hello");           // to stdout with newline
console.error("oops");          // to stderr with newline
stdout.write("no newline");
stdout.writeln("with newline");
stdout.writeString(myString);   // accepts heap String

const input = stdin.read(usize(1024));  // String? — null on wasm32-unknown
const line  = stdin.readLine();         // String?
```

On `wasm32-unknown`, all writes are no-ops and reads return null unless the `__jswat_io_write`/`__jswat_io_read` hooks are declared via `@external` (see spec — Host Interop).

---

## `std/fs` — Filesystem

```js
import { FS } from "std/fs";

FS.read("data.txt")           // String? — null on wasm32-unknown
FS.write("out.txt", "hello")  // bool
FS.append("log.txt", "\n")    // bool
FS.delete("tmp.txt")          // bool
FS.mkdir("build/")            // bool
FS.exists("config.json")      // bool
```

On `wasm32-wasip1` and `wasm32-ld`: backed by `wasi_snapshot_preview1` filesystem calls. On `wasm32-component`: backed by `wasi:filesystem/types` WIT interface. On `wasm32-unknown`: all ops return null/false.

---

## `std/clock` — Clock

```js
import { Clock } from "std/clock";

Clock.now()         // i64 — nanoseconds since Unix epoch (0 on wasm32-unknown)
Clock.monotonic()   // i64 — nanoseconds, arbitrary epoch
Clock.nowMs()       // f64 — milliseconds
Clock.sleep(ns = i64(0))    // undefined
Clock.sleepMs(ms = 0)       // undefined
```

---

## `std/process` — Process

```js
import { Process } from "std/process";

Process.exit(i32(0))   // undefined — exits cleanly, or traps on wasm32-unknown
Process.args()         // String[] — empty on wasm32-unknown
Process.env("HOME")    // String? — null if not found or wasm32-unknown
```

---

## `std/encoding` — Base64, UTF8

```js
import { Base64, UTF8 } from "std/encoding";

Base64.encode(buf = usize(0), len = usize(0))  // String
Base64.decode(s = "", outLen = Box)            // u8? — outLen.$val set to byte count

UTF8.validate(s = "")      // bool
UTF8.charCount(s = "")     // usize — Unicode codepoints
```

---

## Implicit Prelude

The prelude is never imported — always in scope. Explicitly importing a prelude member is CW-M10 (warning). Tree-shaking applies — being in scope contributes zero bytes unless actually used.

**Always in scope:**

```
std/string:      String
std/io:          console
std/math:        Math
std/random:      Random
std/range:       Range
std/collections: Map, Set, Stack, Queue, Deque, List
std/error:       AppError, ValueError, RangeError, IOError, ParseError, NotFoundError
```

**`alloc` builtin — always in scope, no import required:**

```js
alloc.create(Type)                    // T — manual allocation, all defaults
alloc.create(Type, ...args)           // T — positional args
alloc.create(Type, { key: val })      // T — named arg block
alloc.free(e)                         // undefined — dispose + free, consumes binding
alloc.arena(size = usize(0))          // Arena — bump arena, 0 = growable
alloc.pool(Type, capacity = usize(0)) // Pool<T> — free-list pool
```

**Requires explicit import:**

```js
import { iter }              from "std/iter";
import { StepRange }         from "std/range";
import { Clock }             from "std/clock";
import { FS }                from "std/fs";
import { Process }           from "std/process";
import { Base64, UTF8 }      from "std/encoding";
import { StringBuilder }     from "std/string";
import { Result }            from "std/result";
import { ptr, rawAlloc }     from "std/mem";
import { ... }               from "std/wasm";
```

---

*End of js.wat Standard Library Reference v1.6*