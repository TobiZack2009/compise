# js.wat Standard Library
### Implementation Reference v1.0

> Full source for every std module, plus annotated stubs for the GC and allocator.
> Modules written in js.wat unless marked [WAT STUB].

---

## Runtime Stubs [WAT STUB]

The runtime is a fixed WAT file compiled separately and merged into every output binary via `wasm-merge`. It exports the functions that the js.wat compiler emits calls to. User code never calls these directly — they are internal symbols prefixed `__jswat_`.

### Memory layout

```
Linear memory (WASM32):

Offset 0:
  [ data segment ]          — str literals, compile-time const strings
  [ static field region ]   — one slot per static field across all classes
  [ runtime metadata ]      — free list heads, bump pointer, heap stats

Heap start (computed at compile time, page-aligned):
  [ heap objects ]          — grows upward
  ...
  [ stack ]                 — grows downward from top of allocated pages
```

### Size class table

The allocator uses 11 size classes. Every allocation is rounded up to the nearest class. Free lists are singly linked — freed blocks store the next pointer at byte offset 0, clobbering the sentinel (correct — freed blocks are dead):

```
Class  Size   Free list head (static address)
  0      8    &__jswat_fl_0
  1     16    &__jswat_fl_1
  2     32    &__jswat_fl_2
  3     64    &__jswat_fl_3
  4    128    &__jswat_fl_4
  5    256    &__jswat_fl_5
  6    512    &__jswat_fl_6
  7   1024    &__jswat_fl_7
  8   2048    &__jswat_fl_8
  9   4096    &__jswat_fl_9
 10   large   doubly-linked list, coalescing
```

### `__jswat_alloc` [WAT STUB]

```wat
;; (func $__jswat_alloc (param $size i32) (result i32))
;;
;; 1. Compute size class from $size
;; 2. Load free list head for that class
;; 3. If head != 0:
;;      next = i32.load(head)         ;; read embedded next pointer
;;      store next as new head
;;      write sentinel 0xFFFFFFFF to head+0
;;      return head
;; 4. Else (free list empty):
;;      ptr = __jswat_bump
;;      __jswat_bump += class_size
;;      if __jswat_bump > memory.size * 65536:
;;        pages_needed = ceil((bump - limit) / 65536)
;;        result = memory.grow(pages_needed)
;;        if result == -1: unreachable  ;; OOM
;;      write sentinel 0xFFFFFFFF to ptr+0
;;      return ptr
;;
;; Large allocations (size > 4096):
;;      Allocate from large block list.
;;      Each large block: [ sentinel:4 | size:4 | prev:4 | next:4 | data... ]
;;      Coalesce adjacent free large blocks on free.
```

### `__jswat_alloc_bytes` [WAT STUB]

```wat
;; (func $__jswat_alloc_bytes (param $n i32) (param $fill i32) (result i32))
;;
;; Same as __jswat_alloc but:
;; 1. size = $n + 4  (4-byte sentinel header)
;; 2. After allocation, call memory.fill(ptr+4, $fill, $n)  ;; zero or fill value
;; 3. Write sentinel to ptr+0
;; 4. Return ptr+4  ;; caller gets pointer to data, not to header
;;
;; Note: returned pointer points past the header.
;; alloc.free on a byte buffer adjusts by -4 to reach the sentinel.
```

### `__jswat_realloc` [WAT STUB]

```wat
;; (func $__jswat_realloc (param $ptr i32) (param $old_size i32) (param $new_size i32) (result i32))
;;
;; 1. new_class = size_class(new_size + 4)
;; 2. old_class = size_class(old_size + 4)
;; 3. If new_class == old_class: return $ptr  ;; fits in same block, no-op
;; 4. Else:
;;      new_ptr = __jswat_alloc_bytes(new_size, 0)
;;      copy_len = min(old_size, new_size)
;;      memory.copy(new_ptr, ptr, copy_len)
;;      __jswat_free_bytes(ptr)
;;      return new_ptr
```

### `__jswat_free` [WAT STUB]

```wat
;; (func $__jswat_free (param $ptr i32) (param $size i32))
;;
;; 1. Write old free list head into i32.store($ptr, head)
;; 2. Set new free list head = $ptr
;; Called only after rc hits 0 and Symbol.dispose has run.
;; Never called on sentinel objects (caller checks rc first).
```

### `__jswat_rc_inc` [WAT STUB — emitted inline]

```wat
;; Emitted inline at every reference assignment, push, return etc.
;; ~6 instructions. Not a function call — inlined by compiler.
;;
;; local.get $ptr
;; i32.load offset=0        ;; load rc
;; local.tee $rc
;; i32.const -1
;; i32.ne                   ;; sentinel check — skip if manual
;; if
;;   local.get $ptr
;;   local.get $rc
;;   i32.const 1
;;   i32.add
;;   i32.store offset=0     ;; rc++
;; end
```

### `__jswat_rc_dec` [WAT STUB — emitted inline]

```wat
;; Emitted inline at every reference release (scope exit, overwrite, pop etc.)
;; ~20 instructions including free path. Inlined by compiler.
;;
;; local.get $ptr
;; i32.load offset=0
;; local.tee $rc
;; i32.const -1
;; i32.ne                      ;; sentinel check
;; if
;;   local.get $ptr
;;   local.get $rc
;;   i32.const 1
;;   i32.sub
;;   local.tee $rc
;;   i32.store offset=0        ;; rc--
;;   local.get $rc
;;   i32.eqz
;;   if
;;     local.get $ptr
;;     call $__jswat_dispose_TypeName  ;; per-type, compiler-generated
;;   end
;; end
```

### Per-type `__jswat_dispose_TypeName` [WAT STUB — compiler-generated per class]

```wat
;; Generated by compiler for each class. Example for class Node { value; next; }
;;
;; (func $__jswat_dispose_Node (param $ptr i32))
;;   ;; Call Symbol.dispose if defined
;;   local.get $ptr
;;   call $Node_dispose          ;; only emitted if //@symbol(Symbol.dispose) exists
;;
;;   ;; Decrement refcounts of all reference-typed fields
;;   ;; value: isize — skip, not a reference
;;   ;; next: Node? — reference, decrement
;;   local.get $ptr
;;   i32.load offset=8           ;; load next field (offset from compact layout)
;;   local.tee $next_val
;;   i32.eqz
;;   if (nop)                    ;; null check — skip if null
;;   else
;;     local.get $next_val
;;     call $__jswat_rc_dec_Node ;; recursive dec
;;   end
;;
;;   ;; Free the block
;;   local.get $ptr
;;   i32.const 12                ;; Node.byteSize
;;   call $__jswat_free
```

### Cycle collector [WAT STUB — v1: mark-and-sweep fallback]

```wat
;; v1 uses a simple mark-and-sweep triggered when heap usage crosses a threshold.
;; Trial deletion (Bacon-Rajan) added in v2.
;;
;; __jswat_cycle_collect:
;; 1. Walk all live GC roots (stack roots tracked by compiler-emitted root table)
;; 2. Mark all reachable objects — set high bit of rc field temporarily
;; 3. Sweep: walk heap, free any unmarked objects (rc high bit not set)
;; 4. Unmark remaining objects (clear high bit)
;;
;; Triggered by: __jswat_alloc when heap_used > heap_threshold
;; Threshold: starts at 1MB, doubles after each collection that frees < 25%
;;
;; Root table: compiler emits a root registration call at function entry
;; for any local variable of reference type:
;;   call $__jswat_root_push (param $ptr i32)
;; And at exit:
;;   call $__jswat_root_pop
```

---

## std/wasm

Single WASM instruction intrinsics. Every function here compiles to exactly one WASM instruction. No runtime cost beyond the instruction itself.

```js
// std/wasm — all functions below are compiler intrinsics
// Each maps to the named WASM instruction.
// Tier 1 — freely importable by any code.
// Tier 2 — raw memory ops, importable by any code but semantically unsafe.

// ── Integer bit ops ──────────────────────────────────────────────────────────

export function i32_clz(x = i32(0))                  { return i32(0); }  // i32.clz
export function i32_ctz(x = i32(0))                  { return i32(0); }  // i32.ctz
export function i32_popcnt(x = i32(0))               { return i32(0); }  // i32.popcnt
export function i32_rotl(x = i32(0), n = i32(0))     { return i32(0); }  // i32.rotl
export function i32_rotr(x = i32(0), n = i32(0))     { return i32(0); }  // i32.rotr

export function i64_clz(x = i64(0))                  { return i64(0); }  // i64.clz
export function i64_ctz(x = i64(0))                  { return i64(0); }  // i64.ctz
export function i64_popcnt(x = i64(0))               { return i64(0); }  // i64.popcnt
export function i64_rotl(x = i64(0), n = i64(0))     { return i64(0); }  // i64.rotl
export function i64_rotr(x = i64(0), n = i64(0))     { return i64(0); }  // i64.rotr

// ── Float ops (WASM native) ───────────────────────────────────────────────────

export function f32_sqrt(x = f32(0.0))               { return f32(0.0); } // f32.sqrt
export function f32_floor(x = f32(0.0))              { return f32(0.0); } // f32.floor
export function f32_ceil(x = f32(0.0))               { return f32(0.0); } // f32.ceil
export function f32_trunc(x = f32(0.0))              { return f32(0.0); } // f32.trunc
export function f32_nearest(x = f32(0.0))            { return f32(0.0); } // f32.nearest
export function f32_abs(x = f32(0.0))                { return f32(0.0); } // f32.abs
export function f32_min(a = f32(0.0), b = f32(0.0)) { return f32(0.0); } // f32.min
export function f32_max(a = f32(0.0), b = f32(0.0)) { return f32(0.0); } // f32.max
export function f32_copysign(x = f32(0.0), y = f32(0.0)) { return f32(0.0); } // f32.copysign

export function f64_sqrt(x = 0.0)                   { return 0.0; }      // f64.sqrt
export function f64_floor(x = 0.0)                  { return 0.0; }      // f64.floor
export function f64_ceil(x = 0.0)                   { return 0.0; }      // f64.ceil
export function f64_trunc(x = 0.0)                  { return 0.0; }      // f64.trunc
export function f64_nearest(x = 0.0)                { return 0.0; }      // f64.nearest
export function f64_abs(x = 0.0)                    { return 0.0; }      // f64.abs
export function f64_min(a = 0.0, b = 0.0)           { return 0.0; }      // f64.min
export function f64_max(a = 0.0, b = 0.0)           { return 0.0; }      // f64.max
export function f64_copysign(x = 0.0, y = 0.0)      { return 0.0; }      // f64.copysign

// ── Reinterpret ───────────────────────────────────────────────────────────────

export function i32_reinterpret_f32(x = f32(0.0))   { return i32(0); }   // i32.reinterpret_f32
export function f32_reinterpret_i32(x = i32(0))     { return f32(0.0); } // f32.reinterpret_i32
export function i64_reinterpret_f64(x = 0.0)        { return i64(0); }   // i64.reinterpret_f64
export function f64_reinterpret_i64(x = i64(0))     { return 0.0; }      // f64.reinterpret_i64

// ── Raw memory — Tier 2 ───────────────────────────────────────────────────────
// These bypass the type system entirely. Use only in std/mem internals.

export function i32_load(addr = usize(0), offset = usize(0))              { return i32(0); }
export function i32_store(addr = usize(0), offset = usize(0), v = i32(0)) { }
export function i32_load8_s(addr = usize(0), offset = usize(0))           { return i32(0); }
export function i32_load8_u(addr = usize(0), offset = usize(0))           { return i32(0); }
export function i32_store8(addr = usize(0), offset = usize(0), v = i32(0)){ }
export function i32_load16_s(addr = usize(0), offset = usize(0))          { return i32(0); }
export function i32_load16_u(addr = usize(0), offset = usize(0))          { return i32(0); }
export function i32_store16(addr = usize(0), offset = usize(0), v = i32(0)){ }
export function i64_load(addr = usize(0), offset = usize(0))              { return i64(0); }
export function i64_store(addr = usize(0), offset = usize(0), v = i64(0)) { }
export function f32_load(addr = usize(0), offset = usize(0))              { return f32(0.0); }
export function f32_store(addr = usize(0), offset = usize(0), v = f32(0.0)){ }
export function f64_load(addr = usize(0), offset = usize(0))              { return 0.0; }
export function f64_store(addr = usize(0), offset = usize(0), v = 0.0)    { }
export function memory_size()                                              { return usize(0); }
export function memory_grow(n = usize(0))                                  { return usize(0); }
export function memory_copy(dst = usize(0), src = usize(0), n = usize(0)) { }
export function memory_fill(dst = usize(0), val = i32(0), n = usize(0))   { }
```

---

## std/mem

Manual memory management. `ptr`, `alloc`, `Arena`, `Pool`. All allocator functions call into the runtime stubs via `//@external`.

```js
import {
  i32_load, i32_store, i32_load8_u, i32_store8,
  memory_copy, memory_fill
} from "std/wasm";

// ── Runtime stubs ─────────────────────────────────────────────────────────────

//@external("__jswat_runtime", "__jswat_alloc")
function __alloc(size = usize(0)) { return usize(0); }

//@external("__jswat_runtime", "__jswat_free")
function __free(ptr = usize(0), size = usize(0)) { }

//@external("__jswat_runtime", "__jswat_alloc_bytes")
function __allocBytes(n = usize(0), fill = i32(0)) { return usize(0); }

//@external("__jswat_runtime", "__jswat_realloc")
function __realloc(ptr = usize(0), oldSize = usize(0), newSize = usize(0)) { return usize(0); }

// ── Arena ─────────────────────────────────────────────────────────────────────

export class Arena {
  #base;     // usize — start of arena region
  #bump;     // usize — current allocation pointer
  #cap;      // usize — total capacity in bytes
  #growable; // bool

  constructor(base = usize(0), cap = usize(0), growable = false) {
    this.#base = base;
    this.#bump = base;
    this.#cap = cap;
    this.#growable = growable;
  }

  // Raw byte allocation from arena
  bytes(n = usize(0)) {
    const aligned = (n + usize(7)) & ~usize(7);  // 8-byte align
    if (this.#bump + aligned > this.#base + this.#cap) {
      if (!this.#growable) return null;
      // Grow: request more pages via runtime
      const needed = aligned;
      const newBase = __allocBytes(needed, i32(0));
      // Chain arenas — for simplicity in v1, just realloc the region
      const newCap = this.#cap + needed * usize(2);
      const newRegion = __realloc(this.#base, this.#cap, newCap);
      this.#base = newRegion;
      this.#cap = newCap;
    }
    const ptr = this.#bump;
    this.#bump += aligned;
    return ptr;
  }

  reset() { this.#bump = this.#base; }

  free() {
    __free(this.#base, this.#cap);
    this.#bump = this.#base;
  }

  used()     { return this.#bump - this.#base; }
  capacity() { return this.#cap; }
}

// ── Pool ──────────────────────────────────────────────────────────────────────
// Typed free-list pool. Element type anchored by constructor default.
// Pool stores a sentinel-marked slab. Free list embedded in freed slots.

export class Pool {
  #slab;      // usize — raw slab address
  #head;      // usize — free list head (0 = full)
  #cap;       // usize — total slots
  #available; // usize — free slot count
  #stride;    // usize — bytes per slot (includes sentinel header)

  constructor(stride = usize(0), capacity = usize(0)) {
    this.#stride = stride;
    this.#cap = capacity;
    this.#available = capacity;
    // Allocate raw slab — no sentinel header on the slab itself
    this.#slab = __allocBytes(stride * capacity, i32(0));
    // Build free list — each slot's first 4 bytes = next free slot address
    // Last slot's next = 0 (end of list)
    this.#head = this.#slab;
    let cursor = this.#slab;
    let i = usize(0);
    while (i < capacity - usize(1)) {
      const next = cursor + stride;
      i32_store(cursor, usize(0), i32(usize(next)));  // embed next pointer
      cursor = next;
      i++;
    }
    i32_store(cursor, usize(0), i32(0));  // last slot — next = null
  }

  // Called by pool.alloc() — returns raw address, compiler writes sentinel + fields
  #rawAlloc() {
    if (this.#head === usize(0)) return usize(0);  // full
    const slot = this.#head;
    const next = usize(i32_load(slot, usize(0)));   // read embedded next
    this.#head = next;
    this.#available--;
    // Write sentinel — slot is now live
    i32_store(slot, usize(0), i32(-1));
    return slot;
  }

  // Called by pool.free(obj) — obj is the T? pointer
  #rawFree(ptr = usize(0)) {
    // Embed next pointer, push to free list head
    i32_store(ptr, usize(0), i32(usize(this.#head)));
    this.#head = ptr;
    this.#available++;
  }

  available() { return this.#available; }
  capacity()  { return this.#cap; }
}

// ── ptr namespace ─────────────────────────────────────────────────────────────
// ptr() itself is a compiler builtin (boxes a scalar, returns Ptr<T>).
// The namespace functions below are callable from js.wat.

export class ptr {
  // ptr.fromAddr — reinterpret raw address as Ptr<T>
  // type parameter anchors T via second argument default
  static fromAddr(addr = usize(0), type = 0) {
    // Compiler replaces this with a direct pointer cast — no actual call emitted.
    // The 'type' argument is a type anchor only — value unused at runtime.
    return type;
  }

  // ptr.diff — signed byte distance between two pointers
  static diff(a = ptr(0), b = ptr(0)) {
    return isize(a.addr) - isize(b.addr);
  }
}

// ── alloc namespace ───────────────────────────────────────────────────────────
// alloc.create, alloc.free, alloc.bytes, alloc.realloc, alloc.copy, alloc.fill
// alloc.arena, alloc.pool
// Most of these are compiler-handled — the compiler emits the appropriate
// runtime calls and field initialization. The stubs here document the API.

export class alloc {
  // alloc.create(Type, ...args) — compiler desugars to:
  //   1. ptr = __alloc(Type.byteSize)
  //   2. call constructor logic for args
  //   3. return ptr as Type?
  // Not callable as a regular function — compiler special-cases this.

  // alloc.free(obj) — compiler desugars to:
  //   1. call Symbol.dispose if defined
  //   2. rc_dec all reference fields
  //   3. __free(obj.addr, Type.byteSize)
  // Sentinel check skipped — alloc.free always frees regardless.

  // alloc.bytes(n, fill=0) — raw byte buffer
  static bytes(n = usize(0), fill = u8(0)) {
    return __allocBytes(n, i32(fill));
  }

  // alloc.realloc(buf, newSize) — grow or shrink buffer, old ptr invalid after
  static realloc(buf = u8(0), newSize = usize(0)) {
    // old size not tracked — caller must provide context or we read from header
    // v1: always alloc + copy + free
    const newBuf = __allocBytes(newSize, i32(0));
    // Copy min(old, new) bytes — old size unknown here, caller responsibility
    return newBuf;
  }

  // alloc.copy(dst, src, n)
  static copy(dst = u8(0), src = u8(0), n = usize(0)) {
    memory_copy(usize(dst), usize(src), n);
  }

  // alloc.fill(dst, value, n)
  static fill(dst = u8(0), value = u8(0), n = usize(0)) {
    memory_fill(usize(dst), i32(value), n);
  }

  // alloc.arena(size) — create arena allocator
  // size=0 means growable
  static arena(size = usize(0)) {
    const growable = size === usize(0);
    const cap = growable ? usize(65536) : size;  // default 64KB if growable
    const base = __allocBytes(cap, i32(0));
    return new Arena(base, cap, growable);
  }

  // alloc.pool(Type, capacity) — compiler special-cases Type argument
  // Emits: new Pool(Type.stride, capacity)
  static pool(stride = usize(0), capacity = usize(0)) {
    return new Pool(stride, capacity);
  }
}
```

---

## std/math

Full math library. All transcendentals implemented via minimax polynomial approximations. No host imports required.

```js
import { f64_sqrt, f64_floor, f64_ceil, f64_trunc, f64_nearest,
         f64_abs, f64_min, f64_max, f64_copysign,
         f32_sqrt, f32_floor, f32_ceil, f32_trunc, f32_nearest,
         f32_abs, f32_min, f32_max,
         i32_clz, i32_ctz, i32_popcnt, i32_rotl, i32_rotr,
         i64_clz, i64_ctz, i64_popcnt,
         i64_reinterpret_f64, f64_reinterpret_i64,
         i32_reinterpret_f32, f32_reinterpret_i32 } from "std/wasm";

export class Math {

  // ── Constants ───────────────────────────────────────────────────────────────

  static PI      = 3.141592653589793e+00;
  static E       = 2.718281828459045e+00;
  static LN2     = 6.931471805599453e-01;
  static LN10    = 2.302585092994046e+00;
  static LOG2E   = 1.4426950408889634e+00;
  static LOG10E  = 4.342944819032518e-01;
  static SQRT2   = 1.4142135623730951e+00;
  static SQRT1_2 = 7.0710678118654752e-01;

  // ── WASM-native wrappers ─────────────────────────────────────────────────────

  static sqrt(x = 0.0)                { return f64_sqrt(x); }
  static floor(x = 0.0)               { return f64_floor(x); }
  static ceil(x = 0.0)                { return f64_ceil(x); }
  static trunc(x = 0.0)               { return f64_trunc(x); }
  static round(x = 0.0)               { return f64_nearest(x); }
  static abs(x = Number)              { return x < 0 ? -x : x; }
  static min(a = Number, b = Number)  { return a < b ? a : b; }
  static max(a = Number, b = Number)  { return a > b ? a : b; }
  static sign(x = Number)             { return x > 0 ? 1 : x < 0 ? -1 : 0; }
  static clz32(x = i32(0))            { return i32_clz(x); }
  static ctz32(x = i32(0))            { return i32_ctz(x); }
  static popcnt32(x = i32(0))         { return i32_popcnt(x); }
  static imul(a = i32(0), b = i32(0)) { return a * b; }
  static fround(x = 0.0)              { return f64(f32(x)); }
  static clz64(x = i64(0))            { return i64_clz(x); }
  static popcnt64(x = i64(0))         { return i64_popcnt(x); }

  // ── Reinterpret ──────────────────────────────────────────────────────────────

  static reinterpretAsI64(x = 0.0)      { return i64_reinterpret_f64(x); }
  static reinterpretAsF64(x = i64(0))   { return f64_reinterpret_i64(x); }
  static reinterpretAsI32(x = f32(0.0)) { return i32_reinterpret_f32(x); }
  static reinterpretAsF32(x = i32(0))   { return f32_reinterpret_i32(x); }

  // ── exp ──────────────────────────────────────────────────────────────────────

  static exp(x = 0.0) {
    if (x > 709.782711) return 1.7976931348623157e+308;
    if (x < -745.1332) return 0.0;

    const LN2_HI  = 6.93147180369123816490e-01;
    const LN2_LO  = 1.90821492927058770002e-10;
    const INV_LN2 = 1.44269504088896338700e+00;

    const k  = Math.round(x * INV_LN2);
    const r  = x - k * LN2_HI - k * LN2_LO;
    const r2 = r * r;

    const p = r * (1.0 +
      r2 * (1.6666666666666666e-01 +
      r2 * (4.1666666666666664e-03 +
      r2 * (8.3333333333333332e-05 +
      r2 * (1.3888888888888889e-06 +
      r2 *  1.9841269841269841e-08)))));

    const ki   = i64(k);
    const bits = Math.reinterpretAsI64(1.0 + p) + (ki << i64(52));
    return Math.reinterpretAsF64(bits);
  }

  static expm1(x = 0.0) {
    if (Math.abs(x) < 1e-5) return x + x * x * 0.5;
    return Math.exp(x) - 1.0;
  }

  // ── log ──────────────────────────────────────────────────────────────────────

  static log(x = 0.0) {
    if (x < 0.0) return 0.0 / 0.0;   // NaN
    if (x === 0.0) return -1.0 / 0.0; // -Infinity

    const LN2_HI = 6.93147180369123816490e-01;
    const LN2_LO = 1.90821492927058770002e-10;

    let bits = Math.reinterpretAsI64(x);
    let exp  = i32((bits >> i64(52)) & i64(0x7FF)) - 1023;
    bits     = (bits & i64(0x000FFFFFFFFFFFFF)) | i64(0x3FE0000000000000);
    let f    = Math.reinterpretAsF64(bits);  // f in [0.5, 1.0)

    if (f < Math.SQRT1_2) { f *= 2.0; exp--; }

    const s  = (f - 1.0) / (f + 1.0);
    const s2 = s * s;
    const s4 = s2 * s2;

    const t1 = s2 * (6.666666666666735130e-01 +
               s4 * (2.857142857189281973e-01 +
               s4 * (1.818357216161805012e-01 +
               s4 *  1.479819860511658591e-01)));
    const t2 = s4 * (3.999999999940941908e-01 +
               s4 * (2.222219843214978396e-01 +
               s4 *  1.531383769920937332e-01));

    const R    = t1 + t2;
    const fexp = f64(exp);
    return fexp * LN2_HI - ((s * (s2 - R) - fexp * LN2_LO) - f + 1.0) + f - 1.0;
  }

  static log2(x = 0.0)  { return Math.log(x) * Math.LOG2E; }
  static log10(x = 0.0) { return Math.log(x) * Math.LOG10E; }
  static log1p(x = 0.0) {
    if (Math.abs(x) < 1e-4) return x - x * x * 0.5 + x * x * x / 3.0;
    return Math.log(1.0 + x);
  }

  // ── pow ──────────────────────────────────────────────────────────────────────

  static pow(x = 0.0, y = 0.0) {
    if (y === 0.0) return 1.0;
    if (x === 1.0) return 1.0;
    if (x === 0.0) return y > 0.0 ? 0.0 : 1.0 / 0.0;
    if (x < 0.0) {
      const yi = i64(y);
      if (f64(yi) !== y) return 0.0 / 0.0;  // NaN — non-integer exponent
      const r = Math.exp(y * Math.log(-x));
      return yi % i64(2) === i64(0) ? r : -r;
    }
    return Math.exp(y * Math.log(x));
  }

  // ── Trig kernel functions ────────────────────────────────────────────────────

  static #sinKernel(x = 0.0) {
    const x2 = x * x;
    return x * (1.0 +
      x2 * (-1.6666666666666632e-01 +
      x2 * ( 8.3333333332248946e-03 +
      x2 * (-1.9841269841201840e-04 +
      x2 * ( 2.7557316103728590e-06 +
      x2 * (-2.5051132068021698e-08 +
      x2 *   1.5918144304485914e-10))))));
  }

  static #cosKernel(x = 0.0) {
    const x2 = x * x;
    return 1.0 +
      x2 * (-5.0000000000000000e-01 +
      x2 * ( 4.1666666666666602e-02 +
      x2 * (-1.3888888888888872e-03 +
      x2 * ( 2.4801587282933560e-05 +
      x2 * (-2.7557747551051506e-07 +
      x2 * ( 2.0875723212981748e-09 +
      x2 *  -1.1359490739382842e-11))))));
  }

  // ── sin / cos / tan ──────────────────────────────────────────────────────────

  static sin(x = 0.0) {
    const PI2 = Math.PI * 2.0;
    const sign = x < 0.0 ? -1.0 : 1.0;
    x = Math.abs(x) % PI2;
    const PI_OVER_2 = Math.PI / 2.0;
    const n = i32(Math.floor(x / PI_OVER_2));
    const r = x - f64(n) * PI_OVER_2;
    switch (n % 4) {
      case 0: return  sign * Math.#sinKernel(r);
      case 1: return  sign * Math.#cosKernel(r);
      case 2: return -sign * Math.#sinKernel(r);
      case 3: return -sign * Math.#cosKernel(r);
    }
  }

  static cos(x = 0.0) {
    x = Math.abs(x) % (Math.PI * 2.0);
    const PI_OVER_2 = Math.PI / 2.0;
    const n = i32(Math.floor(x / PI_OVER_2));
    const r = x - f64(n) * PI_OVER_2;
    switch (n % 4) {
      case 0: return  Math.#cosKernel(r);
      case 1: return -Math.#sinKernel(r);
      case 2: return -Math.#cosKernel(r);
      case 3: return  Math.#sinKernel(r);
    }
  }

  static tan(x = 0.0) {
    const c = Math.cos(x);
    if (c === 0.0) return 1.0 / 0.0;
    return Math.sin(x) / c;
  }

  // ── atan / atan2 / asin / acos ───────────────────────────────────────────────

  static #atanKernel(x = 0.0) {
    const x2 = x * x;
    return x * (1.0 +
      x2 * (-3.3333333333333331e-01 +
      x2 * ( 2.0000000000000000e-01 +
      x2 * (-1.4285714285714285e-01 +
      x2 * ( 1.1111111111111111e-01 +
      x2 * (-9.0909090909090912e-02 +
      x2 *   7.6923076923076927e-02))))));
  }

  static atan(x = 0.0) {
    const sign = x < 0.0 ? -1.0 : 1.0;
    x = Math.abs(x);
    const SQRT3     = 1.7320508075688772e+00;
    const PI_OVER_2 = Math.PI / 2.0;
    const PI_OVER_6 = Math.PI / 6.0;

    let offset = 0.0;
    if (x > SQRT3) {
      x = -1.0 / x;
      offset = PI_OVER_2;
    } else if (x > SQRT3 - 1.0) {
      x = (x * SQRT3 - 1.0) / (SQRT3 + x);
      offset = PI_OVER_6;
    }
    return sign * (Math.#atanKernel(x) + offset);
  }

  static atan2(y = 0.0, x = 0.0) {
    if (x === 0.0) {
      if (y === 0.0) return 0.0;
      return y > 0.0 ? Math.PI / 2.0 : -Math.PI / 2.0;
    }
    const r = Math.atan(y / x);
    if (x > 0.0) return r;
    return y >= 0.0 ? r + Math.PI : r - Math.PI;
  }

  static asin(x = 0.0) {
    if (x > 1.0 || x < -1.0) return 0.0 / 0.0;
    if (Math.abs(x) > 0.5) {
      const sign = x < 0.0 ? -1.0 : 1.0;
      return sign * (Math.PI / 2.0 - 2.0 * Math.asin(Math.sqrt((1.0 - Math.abs(x)) / 2.0)));
    }
    return Math.atan2(x, Math.sqrt(1.0 - x * x));
  }

  static acos(x = 0.0) {
    if (x > 1.0 || x < -1.0) return 0.0 / 0.0;
    return Math.PI / 2.0 - Math.asin(x);
  }

  // ── Hyperbolic ───────────────────────────────────────────────────────────────

  static sinh(x = 0.0) {
    if (Math.abs(x) < 1e-4) return x + x * x * x / 6.0;
    const e = Math.exp(x);
    return (e - 1.0 / e) / 2.0;
  }

  static cosh(x = 0.0) {
    const e = Math.exp(x);
    return (e + 1.0 / e) / 2.0;
  }

  static tanh(x = 0.0) {
    if (x >  20.0) return  1.0;
    if (x < -20.0) return -1.0;
    const e2 = Math.exp(2.0 * x);
    return (e2 - 1.0) / (e2 + 1.0);
  }

  static asinh(x = 0.0) { return Math.log(x + Math.sqrt(x * x + 1.0)); }

  static acosh(x = 0.0) {
    if (x < 1.0) return 0.0 / 0.0;
    return Math.log(x + Math.sqrt(x * x - 1.0));
  }

  static atanh(x = 0.0) {
    if (Math.abs(x) >= 1.0) return x > 0.0 ? 1.0 / 0.0 : -1.0 / 0.0;
    return 0.5 * Math.log((1.0 + x) / (1.0 - x));
  }

  // ── cbrt ─────────────────────────────────────────────────────────────────────

  static cbrt(x = 0.0) {
    if (x === 0.0) return 0.0;
    const sign = x < 0.0 ? -1.0 : 1.0;
    x = Math.abs(x);
    // Initial guess via exponent division
    const bits   = Math.reinterpretAsI64(x);
    const exp    = ((bits >> i64(52)) & i64(0x7FF)) - i64(1023);
    const expDiv = exp / i64(3);
    let g = Math.reinterpretAsF64((i64(1023) + expDiv) << i64(52));
    // Three Newton-Raphson iterations
    g = (2.0 * g + x / (g * g)) / 3.0;
    g = (2.0 * g + x / (g * g)) / 3.0;
    g = (2.0 * g + x / (g * g)) / 3.0;
    return sign * g;
  }

  // ── hypot ────────────────────────────────────────────────────────────────────

  static hypot(a = 0.0, b = 0.0) {
    a = Math.abs(a);
    b = Math.abs(b);
    if (a < b) { const t = a; a = b; b = t; }
    if (a === 0.0) return 0.0;
    const r = b / a;
    return a * Math.sqrt(1.0 + r * r);
  }

  // ── Extras ───────────────────────────────────────────────────────────────────

  static clamp(val = Number, min = Number, max = Number) {
    return Math.max(min, Math.min(max, val));
  }

  static lerp(a = Float, b = Float, t = Float) {
    return a + (b - a) * t;
  }

  static smoothstep(e0 = Float, e1 = Float, x = Float) {
    const t = Math.clamp((x - e0) / (e1 - e0), f64(0.0), f64(1.0));
    return t * t * (f64(3.0) - f64(2.0) * t);
  }

  static map(val = Float, inMin = Float, inMax = Float, outMin = Float, outMax = Float) {
    return outMin + (val - inMin) / (inMax - inMin) * (outMax - outMin);
  }

  static degToRad(deg = Float) { return deg * (Math.PI / f64(180.0)); }
  static radToDeg(rad = Float) { return rad * (f64(180.0) / Math.PI); }

  // Math.random() — alias to global Random instance (std/random)
  // Declared here, implemented in std/random to avoid circular dep.
  // Compiler wires this call to Random.float() after both modules are loaded.
  static random() { return 0.0; }  // implemented in std/random
}
```

---

## std/string

```js
import { alloc } from "std/mem";
import { memory_copy } from "std/wasm";

export default class String {
  #buf;   // u8? — raw byte buffer (via alloc.bytes)
  #len;   // usize
  #cap;   // usize

  constructor(s = "") {
    this.#len = usize(s.length);
    this.#cap = usize(s.length * 2 + 8);
    this.#buf = alloc.bytes(this.#cap);
    alloc.copy(this.#buf, s, this.#len);
  }

  get length() { return this.#len; }

  // Returns str — zero-copy view into buffer
  // Compiler knows this is a temporary view — str is valid as long as String lives
  asStr() {
    // Compiler emits a str header pointing to this.#buf with this.#len
    // Not expressible in pure js.wat — compiler intrinsic
    return "";  // placeholder — compiler replaces
  }

  // Address of raw byte data — for host interop
  dataPtr() { return usize(this.#buf); }

  #grow(needed = usize(0)) {
    const newCap = (this.#cap + needed) * usize(2);
    this.#buf = alloc.realloc(this.#buf, newCap);
    this.#cap = newCap;
  }

  append(other = "") {
    const otherLen = usize(other.length);
    if (this.#len + otherLen > this.#cap) this.#grow(otherLen);
    alloc.copy(
      alloc.bytes(otherLen),  // temp — compiler will optimise offset arithmetic
      other,
      otherLen
    );
    // Correct form: copy other into this.#buf at offset this.#len
    // Requires raw pointer arithmetic — compiler handles via buf + offset
    this.#len += otherLen;
  }

  set(index = usize(0), char = "") {
    if (index >= this.#len) return;
    // Write first byte of char into buf[index]
    // Compiler emits: i32_store8(this.#buf.addr + index, char.bytes[0])
  }

  slice(start = usize(0), end = usize(0)) {
    if (end > this.#len) end = this.#len;
    if (start >= end) return new String("");
    const len = end - start;
    const s = new String("");
    s.#cap = len + usize(1);
    s.#buf = alloc.bytes(s.#cap);
    alloc.copy(s.#buf, this.#buf, len);  // offset handled by compiler
    s.#len = len;
    return s;
  }

  indexOf(needle = "") {
    const nLen = usize(needle.length);
    if (nLen === usize(0)) return 0;
    if (nLen > this.#len) return -1;
    let i = usize(0);
    while (i <= this.#len - nLen) {
      if (this.slice(i, i + nLen).asStr() === needle) return isize(i);
      i++;
    }
    return -1;
  }

  includes(needle = "")       { return this.indexOf(needle) !== -1; }
  startsWith(prefix = "")     { return this.slice(usize(0), usize(prefix.length)).asStr() === prefix; }
  endsWith(suffix = "")       {
    const sLen = usize(suffix.length);
    if (sLen > this.#len) return false;
    return this.slice(this.#len - sLen, this.#len).asStr() === suffix;
  }

  toUpperCase() {
    const result = new String(this.asStr());
    let i = usize(0);
    while (i < result.#len) {
      // Compiler emits byte-level op: if byte in [97,122] subtract 32
      i++;
    }
    return result;
  }

  toLowerCase() {
    const result = new String(this.asStr());
    let i = usize(0);
    while (i < result.#len) {
      // Compiler emits byte-level op: if byte in [65,90] add 32
      i++;
    }
    return result;
  }

  trim()      { return this.trimStart().trimEnd(); }
  trimStart() {
    let start = usize(0);
    // advance start while byte is space/tab/newline
    while (start < this.#len) {
      // Compiler emits byte read: if not whitespace, break
      start++;
    }
    return this.slice(start, this.#len);
  }
  trimEnd() {
    let end = this.#len;
    while (end > usize(0)) {
      // Compiler emits byte read: if not whitespace, break
      end--;
    }
    return this.slice(usize(0), end);
  }

  split(sep = "") {
    const result = [new String("")];
    if (sep.length === 0) {
      // Split into individual chars
      let i = usize(0);
      while (i < this.#len) {
        result.push(this.slice(i, i + usize(1)));
        i++;
      }
      return result;
    }
    let start = usize(0);
    let idx = this.indexOf(sep);
    while (idx !== -1) {
      result.push(this.slice(start, usize(isize(start) + idx)));
      start = usize(isize(start) + idx) + usize(sep.length);
      idx = this.slice(start, this.#len).indexOf(sep);
    }
    result.push(this.slice(start, this.#len));
    return result;
  }

  replace(from = "", to = "") {
    const idx = this.indexOf(from);
    if (idx === -1) return new String(this.asStr());
    const result = new String("");
    result.append(this.slice(usize(0), usize(idx)).asStr());
    result.append(to);
    result.append(this.slice(usize(idx) + usize(from.length), this.#len).asStr());
    return result;
  }

  padStart(n = usize(0), pad = " ") {
    if (this.#len >= n) return new String(this.asStr());
    const result = new String("");
    let remaining = n - this.#len;
    while (remaining > usize(0)) {
      result.append(pad);
      remaining -= usize(pad.length);
    }
    result.append(this.asStr());
    return result;
  }

  padEnd(n = usize(0), pad = " ") {
    if (this.#len >= n) return new String(this.asStr());
    const result = new String(this.asStr());
    let remaining = n - this.#len;
    while (remaining > usize(0)) {
      result.append(pad);
      remaining -= usize(pad.length);
    }
    return result;
  }

  repeat(n = usize(0)) {
    const result = new String("");
    let i = usize(0);
    while (i < n) { result.append(this.asStr()); i++; }
    return result;
  }

  at(index = isize(0)) {
    const i = index < 0 ? usize(isize(this.#len) + index) : usize(index);
    if (i >= this.#len) return "";
    return this.slice(i, i + usize(1)).asStr();
  }

  //@symbol(Symbol.toStr)
  toStr() { return this.asStr(); }

  //@symbol(Symbol.equals)
  equals(other = String) {
    if (this.#len !== other.#len) return false;
    let i = usize(0);
    while (i < this.#len) {
      // byte comparison via compiler-emitted load
      i++;
    }
    return true;
  }

  //@symbol(Symbol.hash)
  hash() {
    // FNV-1a 64-bit
    let h = i64(0xCBF29CE484222325);
    let i = usize(0);
    while (i < this.#len) {
      // h ^= byte; h *= FNV_PRIME
      // Compiler emits byte load + i64 xor + multiply
      i++;
    }
    return isize(h);
  }

  //@symbol(Symbol.dispose)
  dispose() {
    alloc.free(this.#buf);
  }

  // Static factory — monomorphizes for all numeric and bool types
  static from(n = Number) {
    // Compiler generates specialised int/float→str formatters per type
    // These are compiler intrinsics, not expressible in pure js.wat
    return new String("");
  }
}
```

---

## std/random

```js
// Internal LCG constants (64-bit)
const LCG_A = i64(6364136223846793005);
const LCG_C = i64(1442695040888963407);

class RandomState {
  seed;
  constructor(seed = i64(0)) { this.seed = seed; }
}

// Global instance
const #globalState = new RandomState(i64(0));
let #globalSeeded = false;

// WASI random_get — used for seeding only
//@external("wasi_snapshot_preview1", "random_get")
function __wasi_random_get(buf = usize(0), len = usize(0)) { return i32(0); }

export default class Random {
  #state;

  constructor(seed = 0) {
    this.#state = new RandomState(i64(seed));
  }

  // LCG step — returns next u64
  #next() {
    this.#state.seed = this.#state.seed * LCG_A + LCG_C;
    return this.#state.seed;
  }

  float() {
    // Generate f64 in [0.0, 1.0) via mantissa bit trick
    const bits = (this.#next() >> i64(12)) | i64(0x3FF0000000000000);
    return Math.reinterpretAsF64(bits) - 1.0;
  }

  int() { return isize(this.#next()); }

  range(min = 0, max = 0) {
    const span = isize(max) - isize(min) + 1;
    return min + isize(this.#next() % i64(span));
  }

  bool() { return (this.#next() & i64(1)) === i64(1); }

  seed(s = 0) { this.#state.seed = i64(s); }

  // ── Static global instance ────────────────────────────────────────────────

  static #tryWasiSeed() {
    if (#globalSeeded) return;
    // Attempt WASI seed — if not available, wasiAvailable probe returns 0
    if (wasiAvailable !== 0) {
      const buf = alloc.bytes(usize(8));
      __wasi_random_get(usize(buf), usize(8));
      // Read 8 bytes as i64
      #globalState.seed = i64(0);  // compiler reads buf as i64
      alloc.free(buf);
    }
    #globalSeeded = true;
  }

  static float() {
    Random.#tryWasiSeed();
    #globalState.seed = #globalState.seed * LCG_A + LCG_C;
    const bits = (#globalState.seed >> i64(12)) | i64(0x3FF0000000000000);
    return Math.reinterpretAsF64(bits) - 1.0;
  }

  static int() {
    Random.#tryWasiSeed();
    #globalState.seed = #globalState.seed * LCG_A + LCG_C;
    return isize(#globalState.seed);
  }

  static seed(s = 0) {
    #globalState.seed = i64(s);
    #globalSeeded = true;
  }
}

// Wire Math.random() to Random.float()
// Compiler replaces Math.random() calls with Random.float() after linking
```

---

## std/range

```js
class RangeIterator {
  #current; #end; #step;

  constructor(current = 0, end = 0, step = 1) {
    this.#current = current;
    this.#end     = end;
    this.#step    = step;
  }

  //@symbol(Symbol.iterator)
  iter() { return this; }

  //@symbol(Symbol.next)
  next() {
    if (this.#step > 0 ? this.#current < this.#end
                       : this.#current > this.#end) {
      const val = this.#current;
      this.#current += this.#step;
      return new IteratorResult(val, false);
    }
    return new IteratorResult(0, true);
  }
}

export class Range {
  #start; #end; #step;

  constructor(start = 0, end = 0, step = 1) {
    this.#start = start;
    this.#end   = end;
    this.#step  = step;
  }

  //@symbol(Symbol.iterator)
  iter() { return new RangeIterator(this.#start, this.#end, this.#step); }

  includes(n = 0) {
    if (this.#step > 0) return n >= this.#start && n < this.#end && (n - this.#start) % this.#step === 0;
    return n <= this.#start && n > this.#end && (this.#start - n) % (-this.#step) === 0;
  }

  count() {
    if (this.#step > 0) return usize(Math.max(0, (this.#end - this.#start + this.#step - 1) / this.#step));
    return usize(Math.max(0, (this.#start - this.#end - this.#step - 1) / (-this.#step)));
  }

  toArray() {
    const out = [0];
    for (const x of this) out.push(x);
    return out;
  }
}
```

---

## std/error

```js
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

export class TypeError extends AppError {
  constructor(message = "") { super(message); }
}
```

---

## std/collections

### Stack

```js
export class Stack {
  #items;
  #size;

  constructor(items = [0]) {
    this.#items = items;
    this.#size  = usize(0);
  }

  push(item = 0) {
    this.#items.push(item);
    this.#size++;
  }

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

  //@symbol(Symbol.iterator)
  iter() { return new StackIterator(this.#items, this.#size); }
}

class StackIterator {
  #items; #i;
  constructor(items = [0], size = usize(0)) {
    this.#items = items;
    this.#i     = size;
  }

  //@symbol(Symbol.iterator)
  iter() { return this; }

  //@symbol(Symbol.next)
  next() {
    if (this.#i === usize(0)) return new IteratorResult(0, true);
    this.#i--;
    return new IteratorResult(this.#items[this.#i], false);
  }
}
```

### Queue

```js
export class Queue {
  #items;
  #head;  // usize — index of front element
  #size;

  constructor(items = [0]) {
    this.#items = items;
    this.#head  = usize(0);
    this.#size  = usize(0);
  }

  enqueue(item = 0) {
    this.#items.push(item);
    this.#size++;
  }

  dequeue() {
    if (this.#size === usize(0)) return null;
    const item = this.#items[this.#head];
    this.#head++;
    this.#size--;
    // Compact when head has advanced past half the buffer
    if (this.#head > usize(this.#items.length) / usize(2)) {
      // Shift items down — O(n) but infrequent
      let i = usize(0);
      while (i < this.#size) {
        this.#items[i] = this.#items[this.#head + i];
        i++;
      }
      this.#head = usize(0);
    }
    return item;
  }

  peek() {
    if (this.#size === usize(0)) return null;
    return this.#items[this.#head];
  }

  get size()  { return this.#size; }
  get empty() { return this.#size === usize(0); }
}
```

### Deque

```js
export class Deque {
  #items;
  #head;
  #size;

  constructor(items = [0]) {
    this.#items = items;
    this.#head  = usize(0);
    this.#size  = usize(0);
  }

  pushFront(item = 0) {
    if (this.#head === usize(0)) {
      // No room at front — shift everything right
      this.#items.push(item);  // grow array
      let i = this.#size;
      while (i > usize(0)) {
        this.#items[i] = this.#items[i - usize(1)];
        i--;
      }
      this.#items[usize(0)] = item;
    } else {
      this.#head--;
      this.#items[this.#head] = item;
    }
    this.#size++;
  }

  pushBack(item = 0) {
    this.#items.push(item);
    this.#size++;
  }

  popFront() {
    if (this.#size === usize(0)) return null;
    const item = this.#items[this.#head];
    this.#head++;
    this.#size--;
    return item;
  }

  popBack() {
    if (this.#size === usize(0)) return null;
    this.#size--;
    return this.#items[this.#head + this.#size];
  }

  peekFront() {
    if (this.#size === usize(0)) return null;
    return this.#items[this.#head];
  }

  peekBack() {
    if (this.#size === usize(0)) return null;
    return this.#items[this.#head + this.#size - usize(1)];
  }

  get size()  { return this.#size; }
  get empty() { return this.#size === usize(0); }
}
```

### Map

Map uses open addressing with linear probing. Load factor threshold 0.75. Key type anchored by first constructor argument default. Value type anchored by second.

```js
class MapEntry {
  key; value; hash; #occupied;
  constructor(key = "", value = 0, hash = 0, occupied = false) {
    this.key = key; this.value = value;
    this.hash = hash; this.#occupied = occupied;
  }
  get occupied() { return this.#occupied; }
  set occupied(v = false) { this.#occupied = v; }
}

export class Map {
  #buckets;   // Array<MapEntry?>
  #size;
  #cap;

  constructor(key = "", value = 0) {
    this.#cap     = usize(16);
    this.#size    = usize(0);
    this.#buckets = [];
    let i = usize(0);
    while (i < this.#cap) {
      this.#buckets.push(null);
      i++;
    }
  }

  #keyHash(key = "") {
    // Dispatch to Symbol.hash — compiler resolves at monomorphization
    // For str: FNV-1a on bytes (compiler intrinsic)
    // For class: call key.hash()
    return 0;  // compiler replaces
  }

  #keyEquals(a = "", b = "") {
    // Dispatch to Symbol.equals — compiler resolves at monomorphization
    return a === b;  // compiler replaces for non-primitive types
  }

  #probe(key = "", hash = 0) {
    let idx = usize(hash) % this.#cap;
    while (true) {
      const entry = this.#buckets[idx];
      if (entry === null) return isize(idx);          // empty slot
      if (!entry.occupied) return isize(idx);          // deleted slot
      if (entry.hash === hash && this.#keyEquals(entry.key, key)) return isize(idx);
      idx = (idx + usize(1)) % this.#cap;
    }
  }

  #rehash() {
    const old = this.#buckets;
    const oldCap = this.#cap;
    this.#cap = this.#cap * usize(2);
    this.#size = usize(0);
    this.#buckets = [];
    let i = usize(0);
    while (i < this.#cap) { this.#buckets.push(null); i++; }
    i = usize(0);
    while (i < oldCap) {
      const entry = old[i];
      if (entry !== null && entry.occupied) this.set(entry.key, entry.value);
      i++;
    }
  }

  set(key = "", value = 0) {
    if (this.#size * usize(4) >= this.#cap * usize(3)) this.#rehash();
    const hash    = this.#keyHash(key);
    const idx     = usize(this.#probe(key, hash));
    const existing = this.#buckets[idx];
    if (existing === null || !existing.occupied) {
      this.#buckets[idx] = new MapEntry(key, value, hash, true);
      this.#size++;
    } else {
      existing.value = value;
    }
  }

  get(key = "") {
    const hash  = this.#keyHash(key);
    const idx   = usize(this.#probe(key, hash));
    const entry = this.#buckets[idx];
    if (entry === null || !entry.occupied) return null;
    return entry.value;
  }

  has(key = "") {
    const hash  = this.#keyHash(key);
    const idx   = usize(this.#probe(key, hash));
    const entry = this.#buckets[idx];
    return entry !== null && entry.occupied;
  }

  delete(key = "") {
    const hash  = this.#keyHash(key);
    const idx   = usize(this.#probe(key, hash));
    const entry = this.#buckets[idx];
    if (entry === null || !entry.occupied) return false;
    entry.occupied = false;
    this.#size--;
    return true;
  }

  clear() {
    let i = usize(0);
    while (i < this.#cap) { this.#buckets[i] = null; i++; }
    this.#size = usize(0);
  }

  get size() { return this.#size; }

  //@symbol(Symbol.iterator)
  iter() { return new MapIterator(this.#buckets, this.#cap); }

  forEach(fn = MapEntry) {
    for (const [k, v] of this) fn(v, k);
  }

  keys()    { return new MapKeyIterator(this.#buckets, this.#cap); }
  values()  { return new MapValueIterator(this.#buckets, this.#cap); }
  entries() { return this.iter(); }
}

class MapIterator {
  #buckets; #cap; #i;
  constructor(buckets = [MapEntry], cap = usize(0)) {
    this.#buckets = buckets; this.#cap = cap; this.#i = usize(0);
  }
  //@symbol(Symbol.iterator) iter() { return this; }
  //@symbol(Symbol.next)
  next() {
    while (this.#i < this.#cap) {
      const entry = this.#buckets[this.#i++];
      if (entry !== null && entry.occupied)
        return new IteratorResult([entry.key, entry.value], false);
    }
    return new IteratorResult(["", 0], true);
  }
}

class MapKeyIterator {
  #buckets; #cap; #i;
  constructor(buckets = [MapEntry], cap = usize(0)) {
    this.#buckets = buckets; this.#cap = cap; this.#i = usize(0);
  }
  //@symbol(Symbol.iterator) iter() { return this; }
  //@symbol(Symbol.next)
  next() {
    while (this.#i < this.#cap) {
      const entry = this.#buckets[this.#i++];
      if (entry !== null && entry.occupied)
        return new IteratorResult(entry.key, false);
    }
    return new IteratorResult("", true);
  }
}

class MapValueIterator {
  #buckets; #cap; #i;
  constructor(buckets = [MapEntry], cap = usize(0)) {
    this.#buckets = buckets; this.#cap = cap; this.#i = usize(0);
  }
  //@symbol(Symbol.iterator) iter() { return this; }
  //@symbol(Symbol.next)
  next() {
    while (this.#i < this.#cap) {
      const entry = this.#buckets[this.#i++];
      if (entry !== null && entry.occupied)
        return new IteratorResult(entry.value, false);
    }
    return new IteratorResult(0, true);
  }
}
```

### Set

```js
export class Set {
  #map;

  constructor(elem = 0) {
    // Reuse Map with unit value — monomorphizes on elem type
    this.#map = new Map(elem, true);
  }

  add(elem = 0)    { this.#map.set(elem, true); }
  has(elem = 0)    { return this.#map.has(elem); }
  delete(elem = 0) { return this.#map.delete(elem); }
  clear()          { this.#map.clear(); }

  get size() { return this.#map.size; }

  //@symbol(Symbol.iterator)
  iter() { return this.#map.keys(); }

  keys()    { return this.#map.keys(); }
  values()  { return this.#map.keys(); }
  entries() { return this.#map.keys(); }  // Set entries = [v, v] pairs — simplified to keys

  forEach(fn = 0) {
    for (const v of this) fn(v);
  }
}
```

---

## std/iter

```js
// Lazy iterator combinator chain.
// iter(iterable) wraps any Symbol.iterator implementor.
// All combinators return a new lazy iterator — nothing evaluated until collect/forEach/etc.

class MapIter {
  #source; #fn;
  constructor(source = IteratorResult, fn = 0) { this.#source = source; this.#fn = fn; }
  //@symbol(Symbol.iterator) iter() { return this; }
  //@symbol(Symbol.next)
  next() {
    const r = this.#source.next();
    if (r.done) return r;
    return new IteratorResult(this.#fn(r.value), false);
  }
}

class FilterIter {
  #source; #fn;
  constructor(source = IteratorResult, fn = false) { this.#source = source; this.#fn = fn; }
  //@symbol(Symbol.iterator) iter() { return this; }
  //@symbol(Symbol.next)
  next() {
    while (true) {
      const r = this.#source.next();
      if (r.done) return r;
      if (this.#fn(r.value)) return r;
    }
  }
}

class TakeIter {
  #source; #remaining;
  constructor(source = IteratorResult, n = 0) { this.#source = source; this.#remaining = n; }
  //@symbol(Symbol.iterator) iter() { return this; }
  //@symbol(Symbol.next)
  next() {
    if (this.#remaining <= 0) return new IteratorResult(0, true);
    this.#remaining--;
    return this.#source.next();
  }
}

class SkipIter {
  #source; #toSkip;
  constructor(source = IteratorResult, n = 0) { this.#source = source; this.#toSkip = n; }
  //@symbol(Symbol.iterator) iter() { return this; }
  //@symbol(Symbol.next)
  next() {
    while (this.#toSkip > 0) { this.#source.next(); this.#toSkip--; }
    return this.#source.next();
  }
}

class TakeWhileIter {
  #source; #fn; #done;
  constructor(source = IteratorResult, fn = false) {
    this.#source = source; this.#fn = fn; this.#done = false;
  }
  //@symbol(Symbol.iterator) iter() { return this; }
  //@symbol(Symbol.next)
  next() {
    if (this.#done) return new IteratorResult(0, true);
    const r = this.#source.next();
    if (r.done || !this.#fn(r.value)) { this.#done = true; return new IteratorResult(0, true); }
    return r;
  }
}

class SkipWhileIter {
  #source; #fn; #skipping;
  constructor(source = IteratorResult, fn = false) {
    this.#source = source; this.#fn = fn; this.#skipping = true;
  }
  //@symbol(Symbol.iterator) iter() { return this; }
  //@symbol(Symbol.next)
  next() {
    while (this.#skipping) {
      const r = this.#source.next();
      if (r.done) return r;
      if (!this.#fn(r.value)) { this.#skipping = false; return r; }
    }
    return this.#source.next();
  }
}

class EnumerateIter {
  #source; #i;
  constructor(source = IteratorResult) { this.#source = source; this.#i = 0; }
  //@symbol(Symbol.iterator) iter() { return this; }
  //@symbol(Symbol.next)
  next() {
    const r = this.#source.next();
    if (r.done) return new IteratorResult([0, 0], true);
    return new IteratorResult([this.#i++, r.value], false);
  }
}

class ZipIter {
  #a; #b;
  constructor(a = IteratorResult, b = IteratorResult) { this.#a = a; this.#b = b; }
  //@symbol(Symbol.iterator) iter() { return this; }
  //@symbol(Symbol.next)
  next() {
    const ra = this.#a.next();
    const rb = this.#b.next();
    if (ra.done || rb.done) return new IteratorResult([0, 0], true);
    return new IteratorResult([ra.value, rb.value], false);
  }
}

class FlatIter {
  #source; #inner;
  constructor(source = IteratorResult) { this.#source = source; this.#inner = null; }
  //@symbol(Symbol.iterator) iter() { return this; }
  //@symbol(Symbol.next)
  next() {
    while (true) {
      if (this.#inner !== null) {
        const r = this.#inner.next();
        if (!r.done) return r;
        this.#inner = null;
      }
      const r = this.#source.next();
      if (r.done) return r;
      this.#inner = r.value.iter();
    }
  }
}

// Chain — wraps an iterator and provides all combinator methods
class Chain {
  #iter;
  constructor(it = IteratorResult) { this.#iter = it; }

  //@symbol(Symbol.iterator) iter() { return this.#iter; }

  map(fn = 0)       { return new Chain(new MapIter(this.#iter, fn)); }
  filter(fn = false){ return new Chain(new FilterIter(this.#iter, fn)); }
  take(n = 0)       { return new Chain(new TakeIter(this.#iter, n)); }
  skip(n = 0)       { return new Chain(new SkipIter(this.#iter, n)); }
  takeWhile(fn=false){ return new Chain(new TakeWhileIter(this.#iter, fn)); }
  skipWhile(fn=false){ return new Chain(new SkipWhileIter(this.#iter, fn)); }
  enumerate()       { return new Chain(new EnumerateIter(this.#iter)); }
  zip(other = Chain){ return new Chain(new ZipIter(this.#iter, other.iter())); }
  flat()            { return new Chain(new FlatIter(this.#iter)); }
  flatMap(fn = 0)   { return this.map(fn).flat(); }

  collect() {
    const out = [0];
    let r = this.#iter.next();
    while (!r.done) { out.push(r.value); r = this.#iter.next(); }
    return out;
  }

  forEach(fn = 0) {
    let r = this.#iter.next();
    while (!r.done) { fn(r.value); r = this.#iter.next(); }
  }

  find(fn = false) {
    let r = this.#iter.next();
    while (!r.done) { if (fn(r.value)) return r.value; r = this.#iter.next(); }
    return null;
  }

  some(fn = false) {
    let r = this.#iter.next();
    while (!r.done) { if (fn(r.value)) return true; r = this.#iter.next(); }
    return false;
  }

  every(fn = false) {
    let r = this.#iter.next();
    while (!r.done) { if (!fn(r.value)) return false; r = this.#iter.next(); }
    return true;
  }

  count() {
    let n = 0;
    let r = this.#iter.next();
    while (!r.done) { n++; r = this.#iter.next(); }
    return n;
  }

  first() {
    const r = this.#iter.next();
    return r.done ? null : r.value;
  }

  last() {
    let last = null;
    let r = this.#iter.next();
    while (!r.done) { last = r.value; r = this.#iter.next(); }
    return last;
  }

  reduce(fn = 0, initial = 0) {
    let acc = initial;
    let r = this.#iter.next();
    while (!r.done) { acc = fn(acc, r.value); r = this.#iter.next(); }
    return acc;
  }
}

export function iter(iterable = IteratorResult) {
  return new Chain(iterable.iter());
}
```

---

## std/encoding

```js
import { alloc } from "std/mem";

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export class Base64 {
  static encode(s = "") {
    const bytes = UTF8.encode(s);
    const len   = usize(bytes.length);
    const outLen = ((len + usize(2)) / usize(3)) * usize(4);
    const out   = alloc.bytes(outLen);
    let i = usize(0);
    let o = usize(0);
    while (i < len) {
      const b0 = i     < len ? bytes[i]     : u8(0);
      const b1 = i + usize(1) < len ? bytes[i + usize(1)] : u8(0);
      const b2 = i + usize(2) < len ? bytes[i + usize(2)] : u8(0);
      const triple = (u32(b0) << u32(16)) | (u32(b1) << u32(8)) | u32(b2);
      // Write 4 base64 chars — compiler emits byte stores into out
      i += usize(3);
      o += usize(4);
    }
    // Compiler handles padding '=' chars for non-multiple-of-3 input
    // Return as str — compiler reads from out buffer
    return "";  // compiler replaces with str view of out
  }

  static decode(s = "") {
    // Build reverse lookup — 128-entry table, compile-time const
    // Decode groups of 4 chars into 3 bytes
    // Return str? — null if invalid base64
    return "";
  }
}

export class UTF8 {
  static encode(s = "") {
    // str is already UTF-8 in the data segment
    // Copy bytes into Array<u8>
    const len = usize(s.length);
    const out = [u8(0)];
    let i = usize(0);
    while (i < len) {
      // Compiler emits: out.push(byte_at(s, i))
      i++;
    }
    return out;
  }

  static decode(bytes = [u8(0)]) {
    // Validate UTF-8 sequence, build str
    // Return str? — null if invalid
    const len = usize(bytes.length);
    const buf = alloc.bytes(len);
    let i = usize(0);
    while (i < len) {
      // Compiler emits byte store: buf[i] = bytes[i]
      i++;
    }
    // Return str view of buf
    return "";
  }
}
```

---

## std/io

All WASI extern declarations. No js.wat logic.

```js
// WASI file descriptors
const STDOUT = u32(1);
const STDERR = u32(2);
const STDIN  = u32(0);

//@external("wasi_snapshot_preview1", "fd_write")
function __fd_write(fd = u32(0), iovs = usize(0), iovs_len = u32(0), nwritten = usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "fd_read")
function __fd_read(fd = u32(0), iovs = usize(0), iovs_len = u32(0), nread = usize(0)) { return i32(0); }

// iovec: [ buf_ptr:4 | buf_len:4 ]
// Compiler allocates iovec on stack, writes buf ptr + len, passes to fd_write

export class console {
  static log(s = "") {
    if (!wasiAvailable) return;
    // Compiler emits: build iovec for s + "\n", call __fd_write(STDOUT, ...)
  }
  static error(s = "") {
    if (!wasiAvailable) return;
    // Compiler emits: build iovec for s + "\n", call __fd_write(STDERR, ...)
  }
}

export class stdout {
  static write(s = "") {
    if (!wasiAvailable) return;
    // Compiler emits: build iovec for s, call __fd_write(STDOUT, ...)
  }
}

export class stderr {
  static write(s = "") {
    if (!wasiAvailable) return;
    // Compiler emits: build iovec for s, call __fd_write(STDERR, ...)
  }
}

export class stdin {
  static read() {
    if (!wasiAvailable) return null;
    // Compiler emits: alloc buffer, call __fd_read(STDIN, ...), return str?
    return null;
  }
  static readAll() {
    if (!wasiAvailable) return null;
    // Read until EOF
    return null;
  }
}
```

---

## std/fs

```js
//@external("wasi_snapshot_preview1", "path_open")
function __path_open(dirfd=u32(0), dirflags=u32(0), path=usize(0), path_len=u32(0),
                     oflags=u32(0), fs_rights_base=i64(0), fs_rights_inheriting=i64(0),
                     fdflags=u32(0), fd=usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "fd_read")
function __fs_fd_read(fd=u32(0), iovs=usize(0), iovs_len=u32(0), nread=usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "fd_write")
function __fs_fd_write(fd=u32(0), iovs=usize(0), iovs_len=u32(0), nwritten=usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "fd_close")
function __fd_close(fd = u32(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "path_unlink_file")
function __path_unlink(dirfd=u32(0), path=usize(0), path_len=u32(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "path_create_directory")
function __path_mkdir(dirfd=u32(0), path=usize(0), path_len=u32(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "fd_readdir")
function __fd_readdir(fd=u32(0), buf=usize(0), buf_len=u32(0), cookie=i64(0), bufused=usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "path_filestat_get")
function __path_stat(dirfd=u32(0), flags=u32(0), path=usize(0), path_len=u32(0), stat=usize(0)) { return i32(0); }

// WASI pre-opened directory fd — always 3 in wasi-libc convention
const PREOPENED_DIR = u32(3);

export class FS {
  static read(path = "") {
    if (!wasiAvailable) return null;
    // 1. path_open(PREOPENED_DIR, 0, path, path.length, 0, rights, 0, 0, &fd)
    // 2. Allocate buffer, fd_read in a loop until EOF
    // 3. fd_close(fd)
    // 4. Return str? from buffer
    return null;
  }

  static write(path = "", content = "") {
    if (!wasiAvailable) return false;
    // path_open with O_CREAT | O_TRUNC, fd_write, fd_close
    return false;
  }

  static append(path = "", content = "") {
    if (!wasiAvailable) return false;
    // path_open with O_CREAT | O_APPEND, fd_write, fd_close
    return false;
  }

  static exists(path = "") {
    if (!wasiAvailable) return false;
    // path_filestat_get — success = exists
    return false;
  }

  static delete(path = "") {
    if (!wasiAvailable) return false;
    // path_unlink_file
    return false;
  }

  static mkdir(path = "") {
    if (!wasiAvailable) return false;
    // path_create_directory
    return false;
  }

  static readdir(path = "") {
    if (!wasiAvailable) return null;
    // path_open with directory flag, fd_readdir loop, parse dirent structs
    return null;
  }
}
```

---

## std/clock

```js
// WASI clock IDs
const CLOCK_REALTIME  = u32(0);
const CLOCK_MONOTONIC = u32(1);

//@external("wasi_snapshot_preview1", "clock_time_get")
function __clock_time_get(clock_id = u32(0), precision = i64(0), time = usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "sched_yield")
function __sched_yield() { return i32(0); }

export class Clock {
  static now() {
    if (!wasiAvailable) return 0;
    // __clock_time_get(CLOCK_REALTIME, 1000000, &buf)
    // Returns nanoseconds — divide by 1_000_000 for milliseconds
    return 0;
  }

  static monotonic() {
    if (!wasiAvailable) return 0;
    // __clock_time_get(CLOCK_MONOTONIC, 1, &buf)
    // Returns nanoseconds directly
    return 0;
  }

  static sleep(ms = 0) {
    if (!wasiAvailable) return;
    // WASI has no sleep — spin loop on monotonic clock
    const end = Clock.monotonic() + isize(ms) * 1000000;
    while (Clock.monotonic() < end) __sched_yield();
  }
}
```

---

## std/process

```js
//@external("wasi_snapshot_preview1", "proc_exit")
function __proc_exit(code = i32(0)) { }

//@external("wasi_snapshot_preview1", "args_sizes_get")
function __args_sizes_get(argc = usize(0), argv_buf_size = usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "args_get")
function __args_get(argv = usize(0), argv_buf = usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "environ_sizes_get")
function __environ_sizes_get(count = usize(0), buf_size = usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "environ_get")
function __environ_get(environ = usize(0), environ_buf = usize(0)) { return i32(0); }

export class Process {
  static exit(code = 0) {
    __proc_exit(i32(code));
    // unreachable — proc_exit never returns
  }

  static args() {
    if (!wasiAvailable) return [];
    // 1. args_sizes_get(&argc, &buf_size)
    // 2. Allocate argv pointer array and buffer
    // 3. args_get(argv, buf)
    // 4. Parse argc str pointers into Array<str>
    return [];
  }

  static env(key = "") {
    if (!wasiAvailable) return null;
    // 1. environ_sizes_get(&count, &buf_size)
    // 2. environ_get(environ, buf)
    // 3. Scan for "key=value\0", return value slice if found
    return null;
  }
}
```

---

## std/prelude

Convenience re-export bundle. Import this for access to the most commonly used modules without individual imports.

```js
export { default as Math }    from "std/math";
export { default as String }  from "std/string";
export { default as Random }  from "std/random";
export { Clock }              from "std/clock";
export { console, stdout, stderr, stdin } from "std/io";
export { AppError, ValueError, RangeError, IOError, TypeError } from "std/error";
export { Process }            from "std/process";
export { Range }              from "std/range";
export { Map, Set, Stack, Queue, Deque } from "std/collections";
export { iter }               from "std/iter";
export { alloc, ptr, Arena, Pool } from "std/mem";
```

Usage:
```js
import "std/prelude";
// All of the above now in scope
```

---

## Implementation notes

### What requires compiler support beyond pure js.wat

Several stdlib functions are documented as stubs because they require compiler-level support to implement correctly. These are listed here for the compiler implementor:

| Function | Why compiler support needed |
|---|---|
| `String.asStr()` | Must create a str header pointing into String's buffer — str layout not expressible in user code |
| `String.from(n)` | Numeric/bool → str formatting, one specialisation per type |
| `String.toUpperCase/toLowerCase` | Byte-level ops on buffer require raw indexed byte access |
| `String.equals / hash` | Inner loop needs indexed byte reads |
| `Map.#keyHash / #keyEquals` | Symbol dispatch on monomorphized generic type K |
| `Pool.#rawAlloc` | Slot address returned as T? — type reinterpretation |
| `ptr.fromAddr` | Raw address → typed pointer — single compiler instruction |
| `alloc.create` | Type argument is a compile-time type, not a runtime value |
| `alloc.pool(Type, n)` | Type.stride extracted at compile time |
| `Base64.encode / UTF8.encode` | Indexed byte access into str data segment |
| `std/io` iovec building | Stack allocation + raw memory write for WASI iovec struct |
| `wasiAvailable` global | Set by compiler-emitted startup probe, not user-accessible to write |
| `Math.random()` wiring | Cross-module alias resolved by compiler after linking |

### Sentinel value

Every object allocated via `alloc.*` or `pool.*` / `arena.*` has `0xFFFFFFFF` written to offset 0 before the pointer is returned. The compiler-emitted rc_inc/rc_dec check this value before touching the refcount. Objects allocated with `new` start with refcount `1`.

### v1 cycle collector

v1 ships with a mark-and-sweep fallback. The compiler emits root table push/pop at function entry/exit for all reference-typed locals. The collector triggers when heap usage exceeds the threshold. Trial deletion (Bacon-Rajan) is planned for v2.