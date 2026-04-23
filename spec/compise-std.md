# Compise Standard Library Reference

> Complete API reference for all `std/*` modules.
> Prelude members are always in scope — no import needed.

*See also: [compise-spec.md](compise-spec.md) — Language Spec | [compise-compiler.md](compise-compiler.md) — Compiler Reference*

---

## Module Map

```
std/
├── core          — compiler builtins (always linked)
├── wasm          — WASM instruction intrinsics
├── mem           — ptr, rawAlloc, mem
├── math          — Math (prelude)
├── string        — String (prelude)
├── random        — Random (prelude)
├── range         — Range (prelude), StepRange
├── iter          — iter() combinator chain
├── collections   — Map, Set, Stack, Queue, Deque, List (all prelude)
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

`wasm32-ld` is identical to `wasm32-wasip1` for all system modules — both emit `wasi_snapshot_preview1` imports.

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
import { ptr, rawAlloc, mem } from "std/mem";
```

**Address arithmetic:**

```js
mem.ptrSize                              // usize — 4 on wasm32, 8 on wasm64
mem.alignOf(Type)                        // usize — alignment requirement of T
mem.sizeOf(Type)                         // usize — byte size of T (no header)
mem.offsetOf(Type, field = "")           // usize — byte offset of named field
```

`mem.sizeOf(T)` is the raw field data size — no header. `T.$byteSize` includes the 12-byte object header. Use `mem.sizeOf` for manual layout arithmetic; use `T.$byteSize` for allocation sizing.

`mem.offsetOf(Type, field)` returns the byte offset of a named field from the object start (including the 12-byte header). The compiler owns the layout — using `mem.offsetOf` keeps unsafe code correct across layout changes and targets.

**Typed pointer operations:**

```js
ptr.fromAddr(addr = usize(0), Type)      // T — unowned, untracked
ptr.toAddr(p)                            // usize — raw address
ptr.diff(a, b)                           // isize — signed byte difference
ptr.add(p, offset = usize(0))           // T — pointer arithmetic
ptr.isNull(p)                            // bool
```

`ptr.fromAddr` is unowned. Use-after-free is RT-08 in debug, UB in release. All address parameters and results use `usize` — pointer arithmetic is correct at native width on all targets.

**Raw byte allocation:**

```js
rawAlloc.bytes(n = usize(0))                                   // u8? — zeroed buffer
rawAlloc.bytes(n = usize(0), fill = u8(0))                    // u8? — filled buffer
rawAlloc.realloc(buf = usize(0), newSize = usize(0))          // u8? — resize, old ptr invalid
rawAlloc.free(buf = usize(0))                                  // undefined
rawAlloc.copy(dst = usize(0), src = usize(0), n = usize(0))  // undefined
rawAlloc.fill(dst = usize(0), val = u8(0), n = usize(0))     // undefined
```

These return raw byte addresses with no header. Use `ptr.fromAddr` to access typed data.

---

## `std/math` — Math

```js
import Math from "std/math";  // or use from prelude
```

All functions are pure Compise — no host imports.

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

`String` is in the implicit prelude. See the Language Spec for full `String` and `str` API.

```js
str.fromCodePoint(cp = u32(0))   // str — single codepoint from data segment
String.fromCodePoint(cp = u32(0)) // String — heap
```

---

## `std/random` — Random

```js
import Random from "std/random";  // or use from prelude

const rng = new Random(seed = u64(0));
rng.next()                  // u64
rng.nextFloat()             // f64 — [0, 1)
rng.nextInt(min = isize(0), max = isize(0))  // isize — [min, max)
```

---

## `std/range` — Range, StepRange

`Range` is in the implicit prelude.

```js
import Range from "std/range";
import { StepRange } from "std/range";

const r = new Range(isize(0), isize(10));    // [0, 10)
for (const i of r) { ... }

const sr = new StepRange(isize(0), isize(100), isize(5));  // [0, 100) step 5
for (const i of sr) { ... }
```

Both `Range` and `StepRange` implement `next()` returning `Option(isize)` — fully iterable via `for...of`.

---

## `std/iter` — Iterator Combinators

```js
import { iter } from "std/iter";

iter(arr)
  .map(x => x * isize(2))
  .filter(x => x > isize(5))
  .take(isize(10))
  .collect()          // Array<T>

iter(arr).reduce(isize(0), (acc, x) => acc + x)   // isize
iter(arr).forEach(x => console.log(x))
iter(arr).find(x => x > isize(5))     // T?
iter(arr).count()                      // usize
iter(arr).any(x => x > isize(0))      // bool
iter(arr).all(x => x > isize(0))      // bool
iter(arr).zip(other)                   // iter of [T, U] pairs
iter(arr).enumerate()                  // iter of [usize, T] pairs
iter(arr).flat()                       // flattens one level
```

`iter()` works on any iterable — arrays, collections, generators, ranges, strings.

---

## `std/collections` — Map, Set, Stack, Queue, Deque, List

All prelude except `List` (also prelude). All implement `next()` returning `T?` — fully iterable via `for...of`.

### `Map<K, V>`

```js
const m = new Map(str, i32);
m.set("key", i32(42));
m.get("key");          // i32?
m.has("key");          // bool
m.delete("key");       // bool
m.size;                // usize
m.clear();             // undefined

for (const [k, v] of m) { ... }
```

K must implement `Symbol.hash` and `Symbol.equals`.

### `Set<T>`

```js
const s = new Set(str);
s.add("hello");
s.has("hello");    // bool
s.delete("hello"); // bool
s.size;            // usize

for (const x of s) { ... }
```

### `Stack<T>`

```js
const s = new Stack(i32);
s.push(i32(1));
s.pop();    // i32?
s.peek();   // i32?
s.length;   // usize

for (const x of s) { ... }   // top to bottom
```

### `Queue<T>`

```js
const q = new Queue(i32);
q.enqueue(i32(1));
q.dequeue();   // i32?
q.peek();      // i32?
q.length;      // usize

for (const x of q) { ... }   // front to back
```

### `Deque<T>`

```js
const d = new Deque(i32);
d.pushFront(i32(1));
d.pushBack(i32(2));
d.popFront();   // i32?
d.popBack();    // i32?
d.length;       // usize

for (const x of d) { ... }   // front to back
```

### `List<T>` (prelude)

Fixed-size contiguous buffer. Element type must be a primitive (numeric, `bool`, or `enum`). `Option(T)` not allowed.

```js
const buf = new List(f32, usize(256));
buf[usize(0)] = f32(1.0);
buf[usize(0)];   // f32
buf.length;      // usize — fixed

for (const x of buf) { ... }
```

---

## `std/result` — Result\<T\>

```js
import { Result } from "std/result";

/**
 * @returns {Result<String>}
 */
function parse(input = "") {
  if (input.length == usize(0)) {
    new ValueError("empty input").raise();
  }
  return new String(input);
}

const r = parse("hello");
switch (r) {
  case Ok:  console.log(r.value);
  case Err: console.log(r.error.message);
}
```

`.raise()` propagates the error up — only valid inside a `@returns {Result<T>}` function — CE-T10 otherwise.

---

## `std/error` — AppError Hierarchy

Prelude. All error classes extend `AppError`.

```js
AppError        // base — message: str
├── ValueError
├── RangeError
├── IOError
├── ParseError
├── NotFoundError
└── BoundsError
```

```js
throw new ValueError("bad input");
try { ... } catch (e = AppError) {
  console.log(e.message);
}
```

---

## `std/io` — I/O

`console` is in the implicit prelude.

```js
console.log("hello");           // undefined
console.error("oh no");         // undefined
console.warn("careful");        // undefined

import { stdout, stderr, stdin } from "std/io";

stdout.write("raw bytes\n");
const line = stdin.readLine();   // String?
```

---

## `std/fs` — File System

```js
import { FS } from "std/fs";

const data = FS.read("file.txt");      // String? — null if not found
FS.write("file.txt", "hello");         // bool — true on success
FS.exists("file.txt");                 // bool
FS.delete("file.txt");                 // bool
FS.readBytes("file.bin");              // List<u8>?
FS.writeBytes("file.bin", buf);        // bool
```

On `wasm32-js-*` targets: Node.js only. Returns null/false in browser.

---

## `std/clock` — Clock

```js
import { Clock } from "std/clock";

Clock.now()          // i64 — nanoseconds since epoch
Clock.monotonic()    // i64 — monotonic nanoseconds
```

---

## `std/process` — Process

```js
import { Process } from "std/process";

Process.exit(code = i32(0))     // undefined — terminates
Process.args()                   // Array<String>
Process.env(key = "")           // String?
```

---

## `std/encoding` — Base64, UTF8

```js
import { Base64, UTF8 } from "std/encoding";

Base64.encode(buf = List, T = u8)   // String
Base64.decode(s = "")               // List<u8>?

UTF8.encode(s = "")                  // List<u8>
UTF8.decode(buf = List, T = u8)     // String?
UTF8.validate(buf = List, T = u8)   // bool
```

---

## `std/js` — JS Types

Explicit import required. Available on all targets — null/no-op on non-`wasm32-js-*`.

```js
import { JSObject, JSValue, JSFn, JSSymbol,
         jsGlobal, jsGlobalThis, jsSymbol, jsSymbolFor,
         JS_SYMBOL_ITERATOR, JS_SYMBOL_DISPOSE,
         JSUndefined, JSNull, JSBool, JSInt, JSNumber,
         JSBigInt, JSString, JSObj, JSArr } from "std/js";
```

Full API reference in Language Spec — *JavaScript Target*.

---

## `std/js/dom` — DOM

```js
import { document, HTMLElement, MouseEvent, KeyboardEvent } from "std/js/dom";

const el = document.getElementById("app");    // JSObject?
const el2 = document.createElement("div");    // JSObject
document.body.appendChild(el2);

el.addEventListener("click", JSFn(MouseEvent => undefined), handler);
```

---

## `std/js/canvas` — Canvas 2D and WebGL2

```js
import { Canvas2D, Canvas2DContext, WebGL2 } from "std/js/canvas";

const canvas = new Canvas2D("canvas-id");
const ctx = canvas.getContext2D();

ctx.fillStyle = "red";
ctx.fillRect(f64(0), f64(0), f64(100), f64(100));
ctx.clearRect(f64(0), f64(0), f64(800), f64(600));
ctx.drawImage(img = JSObject, x = f64(0), y = f64(0));

// WebGL2
const gl = canvas.getContextGL();
gl.clearColor(f64(0), f64(0), f64(0), f64(1));
gl.clear(WebGL2.COLOR_BUFFER_BIT);

// buffer ops — zero-copy List<T> path
gl.bufferData(target = i32, buf = List, T = f32, usage = i32)
gl.uniformMatrix4fv(loc = i32, transpose = false, buf = List, T = f32)

// WebGL constants
WebGL2.ARRAY_BUFFER
WebGL2.FLOAT
WebGL2.TRIANGLES
WebGL2.VERTEX_SHADER
WebGL2.FRAGMENT_SHADER
WebGL2.COLOR_BUFFER_BIT
// ... full WebGL2 constant set
```

---

## `std/js/audio` — Web Audio API

```js
import { AudioContext, AudioNode } from "std/js/audio";

const ctx = new AudioContext();
const osc  = ctx.createOscillator();
const gain = ctx.createGain();

AudioNode.connect(osc, gain);
AudioNode.connect(gain, ctx.destination);
AudioNode.setParam(osc, "frequency", f64(440));
AudioNode.setParam(gain, "gain", f64(0.5));
AudioNode.start(osc);
AudioNode.stop(osc, ctx.currentTime + f64(1));

ctx.currentTime   // f64
ctx.close()       // undefined
```

---

## `std/js/worker` — Web Workers

```js
import { Worker } from "std/js/worker";

const w = Worker.spawn(workerUrl = "")
Worker.post(w, msg = JSObject)
Worker.onMessage(w, handler = JSFn(JSObject => undefined))
Worker.terminate(w)

// from worker thread
Worker.postToMain(msg = JSObject)
Worker.onMainMessage(handler = JSFn(JSObject => undefined))
```

---

## `std/js/storage` — Web Storage

```js
import { localStorage, sessionStorage } from "std/js/storage";

localStorage.set(key = "", val = "")
localStorage.get(key = "")             // String?
localStorage.remove(key = "")
localStorage.clear()
localStorage.length                     // usize
localStorage.key(i = usize(0))         // String?
```

---

## `std/js/net` — fetch

```js
import { fetch } from "std/js/net";

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

## `Generator<T>` and `Generator<Tout, Tin>`

Compiler-internal types produced by `function*` declarations. Not directly importable.

```js
// Generator<T> — yield only
function* count() {
  let i = isize(0);
  while (true) { yield i; i += 1; }
}

const g = count();
g.next();        // Option(isize) — null when done

// Generator<Tout, Tin> — bidirectional
function* echo() {
  while (true) {
    const v = yield isize(0);
    yield v ?? isize(-1);
  }
}

const e = echo();
e.next(null);         // start — first call always null
e.next(isize(42));    // send 42 in
```

Both generator types implement `next()` returning `T?` and are fully iterable via `for...of`.

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
import { ptr, rawAlloc, mem } from "std/mem";
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

*End of Compise Standard Library Reference*
