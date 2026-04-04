# js.wat Compiler Reference
### Version 1.6

> Implementation reference for the js.wat compiler.
> Covers WASM type mappings, object header layout, memory model,
> calling convention, runtime internals, tree-shaking, and CLI.

**v1.6 changes:** `str` is now a fat pointer `(i32, i32)` · `str` null sentinel is `ptr == 0` · `void` replaced by `undefined` in `Fn()` return position · `?` propagation replaced by `.raise()` · `@ordered` anchored to field declaration order · `alloc` builtin always in scope · `rawAlloc` replaces raw `alloc` from `std/mem` · `compiler::test` pragma system added

*See also: [jswat-spec.md](jswat-spec.md) — Language Spec | [jswat-std.md](jswat-std.md) — Standard Library*

---

## Targets

| Target | `_start` | WASI imports | `__jswat_init` | Output format |
|---|---|---|---|---|
| `wasm32-wasip1` | exported | `wasi_snapshot_preview1.*` | not exported | core module |
| `wasm32-unknown` | not exported | none | always exported | core module |
| `wasm32-ld` | via `__wasm_call_ctors` | `wasi_snapshot_preview1.*` (unresolved) | not exported | relocatable object |
| `wasm32-component` | component model | WIT interfaces | not exported | WASM component |

**Compile-time target globals** (folded by Level 5 DCE):

```
__target_wasip1    = 1 on wasm32-wasip1,    0 elsewhere
__target_unknown   = 1 on wasm32-unknown,   0 elsewhere
__target_ld        = 1 on wasm32-ld,        0 elsewhere
__target_component = 1 on wasm32-component, 0 elsewhere
__wasi_available   = 1 on wasip1 and ld,    0 elsewhere
__component        = 1 on wasm32-component, 0 elsewhere
```

All stdlib branches guarded by these globals are eliminated by DCE after folding — the binary contains exactly one implementation path per target.

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

`str` uses the same two-word layout as `ListView<T>` and primitive optionals. The null sentinel for `str` is `data_ptr = 0`, consistent with all other pointer-backed nullable types. An empty non-null `str` has `data_ptr != 0` and `len = 0`. Data segment strings are raw UTF-8 bytes with no header prefix.

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
| any heap pointer | 4 bytes (WASM32) | `i32.load` | `i32.store` |
| `str` in struct | 8 bytes (two usize) | two loads | two stores |
| `isize?` in struct | 8 bytes (4+4) | two loads | two stores |
| `f64?` in struct | 16 bytes (8+8) | two loads | two stores |
| `ListView<T>` in struct | 8 bytes (two usize) | two loads | two stores |

---

## Calling Convention

**Simple scalars — passed directly:**

```js
function add(a = 0, b = 0) { return a + b; }
// WASM: (func (param i32 i32) (result i32))
```

**Heap pointers — passed as i32:**

```js
function area(s = Shape) { ... }
// WASM: (func (param i32) (result f64))
```

**Two-word values — passed as two WASM params:**

```js
function sumOpts(a = isize(0)?, b = isize(0)?) { ... }
// WASM: (func (param i32 i32 i32 i32) ...)
//              ^a_val ^a_null ^b_val ^b_null

function processView(v = ListView<f32>) { ... }
// WASM: (func (param i32 i32) ...)
//              ^data_ptr ^length

function apply(fn = Fn(isize => isize), x = 0) { ... }
// WASM: (func (param i32 i32 i32) ...)
//              ^fn_index ^env_ptr ^x

function takeStr(s = "") { ... }
// WASM: (func (param i32 i32) ...)
//              ^data_ptr ^len
```

`str` parameters expand to two `i32` WASM params, identical to `ListView<T>`. The calling convention is always `(i32, i32)` regardless of whether the underlying `str` is backed by a `StrRef` at runtime — `StrRef` is compiler-internal and never surfaces in signatures.

**Multiple return values — sret pointer:**

When a function returns a class instance, the caller allocates space and passes a hidden sret pointer as the first parameter. Two-word values (primitive optionals, `ListView<T>`, `str`, function values) are returned as multiple WASM return values natively — no sret needed.

**RC across call boundary:**

Passing a GC heap value to a function increments its RC at the call site and decrements after return. Manual objects (sentinel `0xFFFFFFFF`) — the RC check reads the sentinel and skips. Non-capturing function values (`env_ptr = 0`) — no RC. Capturing closures (`env_ptr ≠ 0`) — `env_ptr` is RC-managed, incremented/decremented normally.

---

## Object Header and Memory Layout

**Every heap object has a 12-byte prefix:**

```
Offset 0   rc_class   [ bit 31 = manual sentinel (1 = skip RC entirely)
                        bit 30 = reserved
                        bits 29–24 = size-class index (0–63)
                        bits 23–0  = refcount (max 16M) ]
           0xFFFFFFFF = manual sentinel
Offset 4   vtable_ptr [ pointer to vtable, 0 if no symbol methods ]
Offset 8   class_id   [ unique u32, compiler-assigned ]
Offset 12  fields...
```

**Compact field layout (default):**

```
Sort order: f64/i64/u64 (8) → f32/i32/u32/isize/usize/ptr (4) → i16/u16 (2) → i8/u8/bool (1)
```

**`@ordered` layout:** fields in **field declaration order** — the order fields appear in the class body, top to bottom. Constructor assignment order is irrelevant. Header still at offset 0.

**Inheritance layout:** parent fields always form a prefix of child layout:

```
Shape:   [ header:12 | color:4 ]
Circle:  [ header:12 | color:4 | radius:8 ]
```

**Static fields:** separate region of linear memory — one allocation per class, no header.

**`List<T>` layout:**

```
Offset 0   rc_class    4    — header (0xFFFFFFFF if manual)
Offset 4   vtable_ptr  4    — header
Offset 8   class_id    4    — header
Offset 12  length      4    — element count, fixed
Offset 16  elem_0      N    — inline data (N = T.$byteSize)
...
```

Total: `16 + length × T.$byteSize` padded to alignment of `T`. No separate data pointer — data is inline.

**`ListView<T>` — value type, not a heap object:**

Two words: `(data_ptr: usize, length: usize)`. In registers: two `i32` WASM locals. In struct fields: 8 bytes. In function params/returns: two `i32` values. No header, no RC, no allocation.

**`str` — value type, not a heap object:**

Two words: `(data_ptr: usize, len: usize)`. Identical layout to `ListView<u8>`. In registers: two `i32` WASM locals. In struct fields: 8 bytes. Null sentinel: `data_ptr = 0`. No header at the pointed-to address — raw UTF-8 bytes only.

When a `str` escapes its lexical scope (field assignment, closure capture, return, collection storage), the compiler emits a `StrRef` — a heap-allocated RC object that holds `(data_ptr, len)` and a strong RC reference to the owning `String`. `StrRef` is not user-visible; `str` parameters are always `(i32, i32)` at call sites regardless.

**Closure layout:**

```
Offset 0   rc_class    4    — GC managed
Offset 4   vtable_ptr  4    — dispose decrements captured heap RCs
Offset 8   class_id    4    — unique per closure signature + capture layout
Offset 12  fn_index    4    — WASM function table index
Offset 16  capture_0   N    — first captured variable
...
```

Non-capturing function: no heap object. Represented as `(fn_index, env_ptr=0)`.

**`Box<T>` layout:**

```
Offset 0   rc_class    4
Offset 4   vtable_ptr  4
Offset 8   class_id    4
Offset 12  value       N    — N = T.$byteSize
```

**Compiler-generated `$`-prefixed properties (all compile-time constants):**

| Property | Value |
|---|---|
| `T.$byteSize` | Total allocation size including header |
| `T.$stride` | Element step for array traversal (byteSize padded to alignment) |
| `T.$headerSize` | Always `usize(12)` |
| `T.$classId` | Compiler-assigned `u32`, stable within a build |
| `T.$offset(n)` | Byte offset of nth declared field from object start |
| `T.$dataOffset(n)` | Byte offset of nth declared field from data start |
| `e.$addr` | Base address of any heap object — read-only at runtime |
| `b.$val` | Read/write accessor for `Box<T>` contained value |
| `list.$ptr` | Address of first element (`list.$addr + 16`) |
| `list.$byteSize` | Total data bytes (`length × T.$byteSize`) |
| `view.$ptr` | Address of first element in `ListView<T>` |
| `view.length` | Element count |

`T.$offset(n)` uses **declaration order** as the index — the nth field as it appears in the class body. The compiler maps declaration index → field name → compact layout byte offset.

---

## Struct and Array Exports

**Pattern 1 — scalar field accessors:**

```js
/** @export entity_x */
function entityX(e = Entity) { return e.x; }
```

**Pattern 2 — `List<T>` passed directly to host:**

```js
const buf = new List(f32, usize(256));

/** @export get_vertices_ptr */
function getVerticesPtr() { return buf.$ptr; }

/** @export get_vertices_len */
function getVerticesLen() { return buf.length; }
```

**Pattern 3 — layout descriptor:**

```bash
jswat compile src/main.js --emit-layout dist/layout.json -o dist/main.wasm
```

```json
{
  "Entity": {
    "$byteSize": 44,
    "$headerSize": 12,
    "fields": {
      "x":      { "declIndex": 0, "offset": 12, "type": "f64" },
      "y":      { "declIndex": 1, "offset": 20, "type": "f64" },
      "id":     { "declIndex": 2, "offset": 28, "type": "isize" },
      "health": { "declIndex": 3, "offset": 32, "type": "i32" }
    }
  }
}
```

---

## Linking Pipelines

### js.wat + js.wat (internal — `wasm-merge`)

Both modules compiled by js.wat. Both use `runtime.wat`. `wasm-merge` produces a single binary with one allocator.

```bash
jswat compile src/main.js --link mathlib=dist/mathlib.wasm -o dist/app.wasm
```

### Mixed-language with wasm-ld (`wasm32-ld`)

Produces a wasm-ld-compatible relocatable object. Memory (`__linear_memory`) and function table (`__indirect_function_table`) imported from environment. `malloc`/`free` unresolved — provided by linked libc.

```bash
jswat compile src/main.js --target wasm32-ld -o dist/main.o
clang --target=wasm32-unknown-unknown -c src/helper.c -o dist/helper.o
wasm-ld dist/main.o dist/helper.o \
  --no-entry --export-all --allow-undefined \
  -o dist/app.wasm
```

`runtime.wat` in `wasm32-ld` mode forwards `__jswat_alloc`/`__jswat_free` to the linker-provided `malloc`/`free`. One allocator — no conflict.

### Component Model (`wasm32-component`)

Produces a WASM component wrapping a core module with Canonical ABI lift/lower adapters. Fully isolated memory per component.

```bash
jswat compile src/handler.js \
  --target wasm32-component \
  --world wasi:http/proxy \
  -o dist/handler.wasm
```

Alternatively, wrap an existing `wasm32-wasip1` build via the standard adapter pipeline:

```bash
jswat compile src/main.js --target wasm32-wasip1 -o dist/main.core.wasm
wasm-tools component new dist/main.core.wasm \
  --adapt wasi_snapshot_preview1=wasi_snapshot_preview1.reactor.wasm \
  -o dist/main.wasm
```

### Library builds

```bash
jswat compile src/mathlib.js --lib -o dist/mathlib.wasm
jswat inspect dist/lib.wasm --emit-extern  # generate extern declarations
jswat inspect dist/main.wasm --emit-wit    # generate WIT from @export annotations
jswat bindgen src/other.wit -o src/other-bindings.js  # generate bindings from WIT
```

---

## Runtime Architecture

### Three-Layer Model

```
Layer 0  WASM primitives     memory.grow, memory.copy, memory.fill
Layer 1  Allocator (WAT)     size-classed free list, bump allocator, Arena, Pool
Layer 2  GC (WAT)            sentinel-aware rc_inc/rc_dec, dispose dispatch
─────────────────────────────────────────────────────────────────────────────
Layer 3  std (js.wat)        stdlib written on top of Layers 1–2
```

Layers 0–2 compiled from `runtime.wat`. Merged with user code via `wasm-merge`. binaryen inlines hot paths after merge.

**In `wasm32-ld` mode:** Layer 1 allocator forwards to `malloc`/`free` from the environment. Layers 2–3 unchanged.

### Allocator Design

**Size classes:** 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096 bytes, plus large (> 4096).

**Free list:** 11 heads in a flat table at `heap_base`. Each free block reuses its `rc_class` slot as next-pointer.

**Large allocations:** doubly-linked list with a 12-byte header `[next:4 | prev:4 | size:4]`.

**Bump allocator:** new blocks allocated from `$bump`, growing via `memory.grow`. OOM traps immediately.

### Reference Counting

The allocator is sentinel-aware. Every allocation sets `rc_class` to 1 (GC) or `0xFFFFFFFF` (manual). `alloc.create` sets the manual sentinel — RC operations are skipped entirely for these objects.

`__jswat_rc_inc` and `__jswat_rc_dec` both check bit 31 of `rc_class` first:

```wat
(func $__jswat_rc_inc (param $ptr i32)
  local.get $ptr
  i32.load          ;; read rc_class
  i32.const -1      ;; 0xFFFFFFFF
  i32.eq
  if return end     ;; manual sentinel — skip
  ;; increment refcount in bits 23–0
)
```

When refcount hits 0: call `Symbol.dispose` via vtable if present, return memory to free list.

### Arena and Pool

**Arena:** bump allocator over a private buffer. All objects have manual sentinel. `arena.reset()` resets the bump pointer — fills with `0xABABABAB` in debug. Growable arenas double on overflow; fixed arenas trap RT-03.

**Pool:** free-list over a fixed-stride buffer. Free slots chain through vtable slot (offset +4). All objects have manual sentinel.

### Debug Poison

In debug builds, freed memory is poisoned before returning to the free list:

| Pattern | Meaning |
|---|---|
| `0xDEADDEAD` | Freed manual object — triggers RT-09 on next `alloc.free` |
| `0x00FACADE` | Freed GC object |
| `0xABABABAB` | Arena-reset region |
| `0xFEEDFEED` | Freed pool slot |

In release builds, `memory.fill` poison is omitted. All RT-08/RT-09 cases collapse to UB.

### Stdlib Target Compilation

All host-dependent stdlib modules (`std/io`, `std/fs`, `std/clock`, `std/random`, `std/process`) are compiled once with all target paths inlined. Level 5 DCE folds the `__target_*` globals and eliminates all but the active path.

**`wasm32-wasip1` and `wasm32-ld`:** use `wasi_snapshot_preview1.*` imports directly.

**`wasm32-component`:** use compiler-generated WIT adapter functions (`__wit_*` prefixed) that translate between js.wat's internal calling convention and the Canonical ABI at the component boundary. These adapters are not user-visible.

**`wasm32-unknown`:** stdlib uses no-op implementations by default, plus named hook points (`__jswat_io_write`, `__jswat_clock_now`, etc.) that resolve to the `@external` declarations if provided by the programmer, or to no-ops otherwise.

### Initialisation Sequences

**`wasm32-wasip1`:**

```wat
(func $_start (export "_start")
  call $__jswat_init          ;; heap setup, free-list table
  call $__random_init         ;; seed from wasi_random_get
  call $__static_init         ;; static class fields
  ;; user top-level code
)
```

**`wasm32-unknown`:**

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

;; Every @export wraps with once-guard
(func $user_fn (export "user_fn") ...
  call $__jswat_init
  ...
)
```

**`wasm32-ld`:** emits `__wasm_call_ctors` in the linking section per wasm-ld convention.

**`wasm32-component`:** component model lifecycle. No explicit `_start`.

### Vtable Dispatch

Every class implementing any `@symbol` method gets a compiler-generated vtable. Vtable pointer at `ptr+4`. Zero if no symbol methods.

Vtable layout (slot 0 = no implementation):
```
[ dispose_fn_idx: i32 | compare_fn_idx: i32 | hash_fn_idx: i32 | tostr_fn_idx: i32 | ... ]
```

`__jswat_dispose` reads `ptr+4` for vtable, reads slot 0 for dispose function index, calls via `call_indirect`.

---

## Compiler Intrinsics

Internal `__`-prefixed intrinsics. Not user-visible.

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
| `__stack_store_u32` | `(base: usize, off: usize, v: u32) → undefined` | Write u32 to stack frame |
| `__stack_load_u32` | `(base: usize, off: usize) → u32` | Read u32 from stack frame |
| `__stack_load_i64` | `(base: usize, off: usize) → i64` | Read i64 from stack frame |
| `__cstr_to_str` | `(ptr: usize) → str` | Null-terminated C string to str |
| `__u32_load` | `(addr: usize) → u32` | Bare u32 load |
| `__strref_alloc` | `(ptr: usize, len: usize, owner: i32) → i32` | Allocate a StrRef with RC reference to owner. owner = 0 for literal-sourced str |
| `unreachable` | statement | Emits WASM `unreachable` |

---

## Tree-Shaking

Five levels, automatic. No annotations required.

**Level 1** — User module DCE: functions, classes, static fields not reachable from `@export` + `_start`.

**Level 2** — Stdlib DCE: same reachability analysis applied to stdlib source.

**Level 3** — Runtime internals DCE: after `wasm-merge`, `wasm-opt --dce` eliminates unreachable runtime functions.

| Function | Included when |
|---|---|
| `__jswat_alloc` | Any heap allocation (`new`, `String`, array, `List`, closure) |
| `__jswat_free` | `__jswat_alloc` included |
| `__jswat_rc_inc` | Any heap value crosses a scope boundary |
| `__jswat_rc_dec` | Any heap value goes out of scope |
| `__jswat_dispose` | Any class implements `Symbol.dispose` |
| `__jswat_arena_*` | `alloc.arena()` used |
| `__jswat_pool_*` | `alloc.pool()` used |
| `__strref_alloc` | Any `str` escapes its lexical scope |

**Level 4** — Refcount elimination: binaryen `-O3` escape analysis eliminates RC pairs where the object provably doesn't escape.

**Level 5** — Target-based branch folding: `__target_*` and `__wasi_available` folded at compile time. All non-active target paths eliminated.

### Full Pipeline

```
1. Parse + type-check full module graph
2. --target folds __target_* globals
3. Build call graph rooted at @export + _start
4. Mark reachable: functions, classes, static fields, vtable entries
5. Emit only reachable symbols → user.wasm
6. wasm-merge user.wasm runtime.wasm → merged.wasm     (skipped for wasm32-ld)
7. wasm-opt --dce merged.wasm
8. wasm-opt -O3 merged.wasm
9. → final.wasm (or .o for wasm32-ld, or component for wasm32-component)
```

---

## CLI and Build Configuration

### Command Reference

```bash
# Compile
jswat compile src/main.js -o dist/main.wasm
jswat compile src/main.js --target wasm32-wasip1  -o dist/main.wasm  # default
jswat compile src/main.js --target wasm32-unknown -o dist/main.wasm
jswat compile src/main.js --target wasm32-ld      -o dist/main.o
jswat compile src/main.js --target wasm32-component --world wasi:http/proxy -o dist/main.wasm

# Linking flags
jswat compile src/main.js --link mathlib=dist/mathlib.wasm -o dist/app.wasm
jswat compile src/main.js --import-memory -o dist/main.wasm
jswat compile src/main.js --multi-memory --link-foreign physics=dist/physics.wasm -o dist/app.wasm

# Output flags
jswat compile src/main.js --emit-layout dist/layout.json -o dist/main.wasm
jswat compile src/mathlib.js --lib -o dist/mathlib.wasm

# Test flags
jswat compile src/types.test.js --test-pragmas --check   # run compiler tests, no emit
jswat compile src/types.test.js --test-pragmas -o dist/types.test.wasm  # emit + test

# Other commands
jswat build  src/main.js -o dist/main     # wasm2c + clang → native binary
jswat check  src/main.js                  # type-check only, no emit
jswat inspect dist/main.wasm              # WAT disassembly
jswat inspect dist/lib.wasm --emit-extern # generate .extern.js declarations
jswat inspect dist/main.wasm --emit-wit   # generate .wit from @export annotations
jswat bindgen src/other.wit -o src/bindings.js  # generate bindings from WIT
jswat compile src/ -o dist/              # compile directory
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
  "importMemory": false,
  "multiMemory":  false,
  "emitLayout":   "",
  "optimize":     true,
  "testPragmas":  false
}
```

`target`: `"wasm32-wasip1"` (default) | `"wasm32-unknown"` | `"wasm32-ld"` | `"wasm32-component"`

`link`: js.wat modules — memory merged, one allocator.
`linkForeign`: foreign WASM modules — separate memories, no allocator conflict.
`testPragmas`: enable `compiler::test` pragma processing. Equivalent to `--test-pragmas` on the CLI.

---

## Compiler Internal Tests (`compiler::test`)

The `compiler::test` pragma system provides in-source assertions that verify compiler behaviour — type inference, code generation, optimization decisions, memory layout, and more. These assertions are completely stripped from normal builds and never affect semantics or output.

### Activation

A file containing any `//# compiler::` directive must declare itself a test file with the following as its first non-empty line:

```js
//# compiler::test
```

Without this header, any `//# compiler::` directive is CIT-001. The compiler rejects `--release` builds of test files — CIT-002. Without `--test-pragmas`, test files are excluded from the module graph entirely and produce no output.

Test files are valid JS — all `//# compiler::` directives are standard `//` line comments invisible to the JS runtime. A test file with a `Result` polyfill can be run as JS directly.

### Directive syntax

```
//# compiler::<namespace>.<assertion> [target] [operator] [value]
```

- **namespace** — compiler phase: `parse`, `type`, `error`, `emit`, `opt`, `rc`, `alloc`, `layout`, `str`, `link`
- **assertion** — specific check within the namespace
- **target** — identifier, expression string, or type name the assertion applies to (omitted when the assertion applies to the following declaration)
- **operator** — `eq`, `lt`, `lte`, `gt`, `gte` for numeric assertions; omitted for boolean assertions
- **value** — literal string, number, or type expression

A directive placed immediately before a declaration applies to that declaration. A directive placed inline after a statement applies to that statement. Multiple directives may stack on the same declaration.

---

### `compiler::parse`

Assertions evaluated at parse time, before type checking.

```js
//# compiler::parse.ok
function edgeCase(fn = Fn(Fn(isize => bool) => isize)) { }

//# compiler::parse.ok
function zeroParam(fn = Fn(() => undefined)) { }
```

**`parse.ok`** — asserts the following declaration parses without error. Useful for verifying edge cases in the parameter default parser where `Fn(T => T)` and nested forms could regress.

```js
// @test.parseError  ← old style, now:
//# compiler::parse.error
const x = fn(a =>);
```

**`parse.error`** — asserts the following line is rejected at the parse phase before type checking runs. Single-line form only.

---

### `compiler::type`

Assertions about type inference results.

```js
//# compiler::type.infer {u8}
const x = u8(4);

//# compiler::type.infer {isize?}
const y = map.get(key);

//# compiler::type.infer {Fn(isize => bool)}
const pred = n => n > 0;
```

**`type.infer {T}`** — asserts the inferred type of the following binding is exactly `T`. Catches type inference regressions without running the output.

```js
//# compiler::type.expr {a + b} {u8}
const result = u8(a + b);
```

**`type.expr {expr} {T}`** — asserts the type of a named sub-expression within the following statement.

```js
if (shape instanceof Circle) {
  //# compiler::type.narrow {shape} {Circle}
  const r = shape.radius;
}

//# compiler::type.noNarrow {p}
const fallback = p?.x ?? 0.0;
```

**`type.narrow {expr} {T}`** — asserts the expression has been narrowed to `T` within the enclosing block.
**`type.noNarrow {expr}`** — asserts the expression was not narrowed. Verifies narrowing does not bleed out of its scope.

```js
//# compiler::type.param {T} {u8}
const result = map([u8(0)], n => u8(n + u8(1)));

//# compiler::type.param {T} {isize}
const doubled = map([0], n => n * 2);
```

**`type.param {T} {concrete}`** — asserts a type variable resolved to a specific concrete type at the following call site.

```js
//# compiler::type.monomorphs eq 2
function identity(x = T, T = any) { return x; }
```

**`type.monomorphs {op} {n}`** — asserts the following generic function was monomorphized the given number of times across the compilation unit.

---

### `compiler::error`

Assertions about compile-time diagnostics. Build fails if the expected diagnostic does not occur — the absence of an expected error is itself an error (CIT-003).

```js
//# compiler::error.expect {CE-T02}
const bad = 1 + 1.0;

//# compiler::error.expect {CE-F11}
let count = 0;
const inc = () => { count++; };

//# compiler::error.expect {CE-MM01}
function leaks() {
  const e = alloc.create(Entity);
}  // exits scope without free
```

**`error.expect {CE-XXX}`** — asserts the following statement produces the specified compile error. The compiler treats the error as expected and continues rather than aborting.

```js
//# compiler::error.expectWarn {CW-F01}
function ambiguousReturn() {
  return 42;
}
```

**`error.expectWarn {CW-XXX}`** — same for warnings.

---

### `compiler::emit`

Assertions about the WAT output after compilation, before optimization.

```js
//# compiler::emit.wat {i32.select}
function branchless(a = isize(0)?, fallback = isize(0)) {
  return a ?? fallback;
}
```

**`emit.wat {pattern}`** — asserts the WAT output for the following function contains the given substring. Pattern is matched against the text output of `wasm2wat` on the compiled function body.

```js
//# compiler::emit.watCount {i32.select} eq 1
function exactlyOne(a = isize(0)?, fallback = isize(0)) {
  return a ?? fallback;
}
```

**`emit.watCount {instruction} {op} {n}`** — asserts occurrence count of an instruction in the compiled function body.

```js
//# compiler::emit.noCall {$__jswat_alloc}
function pureCompute(a = 0, b = 0) {
  return a + b;
}
```

**`emit.noCall {fn}`** — asserts no call to the named internal function appears in the compiled output.

```js
//# compiler::emit.sig {(param i32 i32) (result i32)}
function add(a = 0, b = 0) { return a + b; }

//# compiler::emit.sig {(param i32 i32 i32 i32)}
function sumOpts(a = isize(0)?, b = isize(0)?) { return (a ?? 0) + (b ?? 0); }

//# compiler::emit.sig {(param i32 i32) (result i32)}
function takeStr(s = "") { return s.length; }
```

**`emit.sig {wasmSig}`** — asserts the WASM type signature of the following function matches the given WAT-style type string. Directly verifies calling convention rules.

```js
//# compiler::emit.sret
function makeVec(x = 0.0, y = 0.0) { return new Vec2(x, y); }

//# compiler::emit.noSret
function maybeInt(flag = false) { return flag ? isize(1)? : null; }
```

**`emit.sret`** — asserts the function uses a hidden sret pointer for its return value.
**`emit.noSret`** — asserts the function returns inline via multiple WASM return values.

---

### `compiler::opt`

Assertions about the output after the full binaryen `-O3` optimization pass.

```js
//# compiler::opt.inlined
function use() {
  const y = double(21);
}

//# compiler::opt.notInlined
function use2() {
  const y = bigFn(x);
}
```

**`opt.inlined`** — asserts the following call site was inlined — no `call` instruction remains in the output.
**`opt.notInlined`** — asserts the call was not inlined — a `call` instruction is present. Verifies large functions are not unexpectedly inlined.

```js
//# compiler::opt.constFolded {0}
const wrap = u8(255) + u8(1);

//# compiler::opt.constFolded {6.283185307179586}
const tau = Math.PI * 2.0;

//# compiler::opt.constFolded {true}
const always = 1 < 2;
```

**`opt.constFolded {value}`** — asserts the expression was evaluated at compile time and the result matches the given value.

```js
//# compiler::opt.isConst
const x = Math.PI * 2.0;
```

**`opt.isConst`** — asserts compile-time evaluation without asserting the specific value.

```js
//# compiler::opt.branchElim {else}
if (__target_wasip1) {
  doWasiThing();
} else {
  doFallback();
}
```

**`opt.branchElim {then|else}`** — asserts the named branch was eliminated by constant folding or DCE. Primarily verifies `__target_*` global folding.

```js
//# compiler::opt.isDead
function neverCalled(x = 0) { return x; }
```

**`opt.isDead`** — asserts the following function was eliminated by DCE and is absent from the final binary.

---

### `compiler::rc`

Assertions about reference counting operations emitted for the following function.

```js
//# compiler::rc.inc eq 1
//# compiler::rc.dec eq 1
function balanced(s = String) {
  const copy = s;
  return copy.length;
}

//# compiler::rc.inc eq 0
//# compiler::rc.dec eq 0
function noRc(a = 0, b = 0) {
  return a + b;
}
```

**`rc.inc {op} {n}`** — asserts the function emits exactly / at most / at least `n` RC increment calls.
**`rc.dec {op} {n}`** — same for decrements.

```js
//# compiler::rc.elided
function localOnly() {
  const s = new String("hello");
  return s.length;
}
```

**`rc.elided`** — asserts that all RC operations for locally-allocated values in the following function were eliminated by binaryen escape analysis. The allocation may still occur; the RC inc/dec pair must not.

```js
//# compiler::rc.balanced
function complexFlow(flag = false, s = String) {
  if (flag) {
    const copy = s;
    return copy.length;
  }
  return s.length;
}
```

**`rc.balanced`** — asserts RC increment count equals decrement count in the following function, without requiring exact values. Catches leaks and double-decrements without specifying exact counts.

---

### `compiler::alloc`

Assertions about heap allocation calls.

```js
//# compiler::alloc.count eq 1
function oneAlloc(x = 0.0, y = 0.0) { return new Vec2(x, y); }

//# compiler::alloc.count eq 0
function noAlloc(a = 0, b = 0) { return a + b; }

//# compiler::alloc.count lte 3
function boundedAlloc(items = [0]) {
  const sb = new StringBuilder();
  for (const i of items) { sb.append(`${i}`); }
  return sb.build();
}
```

**`alloc.count {op} {n}`** — asserts the `__jswat_alloc` call count in the following function satisfies the given comparison.

```js
//# compiler::alloc.stack
function localStruct() {
  const v = new Vec2(1.0, 2.0);
  return v.x + v.y;
}
```

**`alloc.stack`** — asserts the following allocation was routed to the stack frame via `__stack_alloc` rather than the heap. Verifies escape analysis correctly identifies non-escaping objects.

---

### `compiler::layout`

Assertions about class memory layout. Applied to class declarations.

```js
//# compiler::layout.field {x} eq 12
//# compiler::layout.field {y} eq 20
class Vec2 {
  x;
  y;
  constructor(x = 0.0, y = 0.0) { this.x = x; this.y = y; }
}
```

**`layout.field {name} {op} {n}`** — asserts the byte offset of the named field from the start of the object (including header). Matches `T.$offset(n)` semantics.

```js
//# compiler::layout.size eq 36
class Entity {
  x;       // f64 — 8 bytes at offset 12
  y;       // f64 — 8 bytes at offset 20
  id;      // isize — 4 bytes at offset 28
  flags;   // u8 — 1 byte at offset 32 (padded to 33, total 36?)
}
```

**`layout.size {op} {n}`** — asserts the total `$byteSize` of the class in bytes.

```js
//# compiler::layout.variants eq 2
class Shape { static $variants = []; }
class Circle extends Shape { radius; constructor(r = 0.0) { super(); this.radius = r; } }
class Rect   extends Shape { w; h;   constructor(w = 0.0, h = 0.0) { super(); this.w = w; this.h = h; } }
```

**`layout.variants {op} {n}`** — asserts the sealed union has exactly / at most / at least `n` compiler-collected variants.

```js
//# compiler::layout.classId eq 1
class Root { }
```

**`layout.classId {op} {n}`** — asserts the compiler assigned the given class ID. Verifies stability across incremental builds within a session.

---

### `compiler::str`

Assertions about `str` lifetime decisions. Verifies the escape analysis and GC promotion logic introduced in v1.6.

```js
//# compiler::str.raw
function greet(name = "") {
  const view = name;           // used locally — must not promote
  console.log(`Hello, ${view}`);
}
```

**`str.raw`** — asserts the following `str` binding was not promoted to a `StrRef` and remains a raw fat pointer.

```js
//# compiler::str.ref
class Post {
  title;
  constructor(t = "") {
    this.title = t;            // escapes into field — must promote
  }
}
```

**`str.ref`** — asserts the following `str` binding was promoted to a `StrRef`.

```js
//# compiler::str.literal
const greeting = "hello";

//# compiler::str.literal
const ch = str.fromCodePoint(u32(65));
```

**`str.literal`** — asserts the following `str` originates from the WASM data segment, not from a `String.$asView()`.

```js
function firstWord(s = "") {
  //# compiler::str.slice
  const word = s.slice(usize(0), s.indexOf(" ") ?? s.length);
}
```

**`str.slice`** — asserts the following `str` is a sub-slice — its `data_ptr` is offset into an existing buffer rather than pointing to a data segment base address.

---

### `compiler::link`

Assertions about the final linked binary. Evaluated after the full pipeline.

```js
//# compiler::link.exported {on_tick}
/** @export on_tick */
function tick(dt = 0.0) { }
```

**`link.exported {name}`** — asserts the following function appears in the WASM export table under the given name.

```js
//# compiler::link.treeShaken
function neverCalled(x = 0) { return x; }
```

**`link.treeShaken`** — asserts the following function is absent from the final binary — eliminated by DCE.

```js
//# compiler::link.moduleSize lt 4096
function main() { console.log("hello"); }
```

**`link.moduleSize {op} {n}`** — asserts the total byte size of the compiled binary satisfies the comparison. Catches binary size regressions. Applied to the module entry point or a representative export.

---

### CIT error codes

All compiler internal test diagnostics use the `CIT-` prefix, distinct from user-facing `CE-`, `CW-`, and `RT-` codes. `CIT-` codes are only emitted when `--test-pragmas` is active.

| Code | Condition |
|---|---|
| CIT-001 | `//# compiler::` directive used without `//# compiler::test` file header |
| CIT-002 | Test file compiled with `--release` |
| CIT-003 | `error.expect` — expected compile error did not occur |
| CIT-004 | `error.expectWarn` — expected warning did not occur |
| CIT-005 | `parse.error` — expected parse failure did not occur |
| CIT-006 | `parse.ok` — unexpected parse error |
| CIT-007 | `type.infer` / `type.expr` / `type.param` — type mismatch |
| CIT-008 | `type.narrow` / `type.noNarrow` — narrowing state mismatch |
| CIT-009 | `type.monomorphs` — monomorphization count mismatch |
| CIT-010 | `emit.wat` — pattern absent from WAT output |
| CIT-011 | `emit.watCount` / `emit.noCall` — instruction count mismatch |
| CIT-012 | `emit.sig` — WASM signature mismatch |
| CIT-013 | `emit.sret` / `emit.noSret` — return convention mismatch |
| CIT-014 | `opt.inlined` / `opt.notInlined` — inlining state mismatch |
| CIT-015 | `opt.constFolded` / `opt.isConst` — not folded, or folded to wrong value |
| CIT-016 | `opt.branchElim` — branch present when expected eliminated |
| CIT-017 | `opt.isDead` — function present in binary when expected absent |
| CIT-018 | `rc.inc` / `rc.dec` — count mismatch |
| CIT-019 | `rc.elided` — RC operations not eliminated |
| CIT-020 | `rc.balanced` — increment and decrement counts differ |
| CIT-021 | `alloc.count` — allocation count mismatch |
| CIT-022 | `alloc.stack` — allocation not routed to stack frame |
| CIT-023 | `layout.field` — field byte offset mismatch |
| CIT-024 | `layout.size` — class byte size mismatch |
| CIT-025 | `layout.variants` — sealed union variant count mismatch |
| CIT-026 | `layout.classId` — class ID mismatch |
| CIT-027 | `str.raw` / `str.ref` — str representation mismatch |
| CIT-028 | `str.literal` / `str.slice` — str provenance mismatch |
| CIT-029 | `link.exported` — function absent from WASM export table |
| CIT-030 | `link.treeShaken` — function present in binary when expected absent |
| CIT-031 | `link.moduleSize` — binary size constraint not satisfied |
| CIT-032 | Unknown `//# compiler::` namespace or directive name |

---

*End of js.wat Compiler Reference v1.6*