# Status

## Done

### Phase 1 — Core Compiler Pipeline
- Implemented `src/types.js`: full type hierarchy (i8/u8/i16/u16/i32/u32/i64/u64/isize/usize/f32/f64/bool/str/void), promotion rules, cast type set, WASM type mapping
- Implemented `src/wat.js`: pure WAT string builders (buildModule, buildFunction, param, result, local, localGet/Set/Tee, i32/i64/f32/f64Const, binOp, ifBlock, memoryExport, indent)
- Implemented `src/parser.js`: acorn wrapper with syntactic banned-construct detection (generators, async/await, with, for-in, arguments, SequenceExpression, dynamic import)
- Implemented `src/validator.js`: semantic second pass — detects eval, new Function, delete, typeof in conditions, Proxy/Reflect/JSON.parse, Math.* without import, this outside class, params without defaults, computed member expressions; var → warning
- Implemented `src/typecheck.js`: bottom-up type inference with ScopeChain; literal type detection via node.raw (critical: 0.0 must be f64, not isize); cast calls; binary expression promotion; unary expressions; ConditionalExpression
- Implemented `src/codegen.js`: typed AST → WAT; operator→instruction mapping with signed/unsigned variants; narrow-type AND-masking for sub-32-bit integers; nested else-if via recursive alwaysReturns + genBranchValue; local variable collection
- Implemented `src/compiler.js`: full pipeline (parse → validate → typecheck → codegen → wabt); watToWasm/wasmToWat; compileSource API; always emits (memory (export "memory") 1)
- Implemented `src/cli.js`: compile/build/check/inspect commands; --emit-wat flag; -o output flag
- Created `.mocharc.json` for ESM + 10s timeout
- 74 unit tests passing (validator, typecheck, codegen)

### Phase 1 — Examples + --emit-wat
- Created `examples/add.js`, `examples/lerp.js`, `examples/math.js`, `examples/floats.js`, `examples/casts.js`
- Created all 8 section-21 reference examples (Phase 2+): 21-hello-world.js, 21-fizzbuzz.js, 21-fibonacci.js, 21-stack.js, 21-result.js, 21-pixel-buffer.js, 21-wasm-compute.js, 21-game-loop.js
- Created `test/examples.test.js` with 48 passing integration tests + 8 pending (Phase 2+)
- **Total: 122 passing, 8 pending**

### Key bugs fixed
- Float literal `0.0` was inferred as `isize` because `Number.isInteger(0.0) === true` — fixed by checking `node.raw` for `.`/`e`/`E`
- `delete x` fails ESM strict-mode parse — fixed test to use `delete obj.x`
- `wasmToWat` (inspect) crashed with "unable to read u32 leb128" — Node.js Buffer uses pooled ArrayBuffer; fixed by passing `new Uint8Array(wasmBuffer)` to force a fresh copy
- `readDebugNames: true` crashes on WASM without name section — fixed to `readDebugNames: false`
- Nested `else if` (clamp, saturate) generated invalid WAT — replaced `endsWithReturn` with recursive `alwaysReturns` + `genBranchValue`

### Phase 2 — Loops, Logical Ops, Compound Assignments, User Functions
- Added `TYPES.unknown` and fixpoint inference for recursive function signatures
- Implemented logical ops, update/assignment expressions, and user function calls
- Added loop codegen (while/for/do-while) with break/continue handling
- Added new examples and tests (`examples/loops.js`, `examples/fibonacci.js`, `test/phase2.test.js`)

### Phase 3 — Classes, Methods, `this`, `for-of`
- Implemented class layout, allocation, method calls, constructors, and `this`
- Added `for-of` lowering for `Range` plus iterator-protocol lowering via `iter()/next()` + `IteratorResult`
- Added allocator updates (size-class freelists + bytes/realloc helpers)

### Phase 4 — std Imports + WASI Backing
- std registry + import resolution for namespace/default/direct function imports
- std/io, std/fs, std/clock, std/random runtime implementations (WASI-backed)
- std/collections runtime (Map/Set/Queue/Stack/Deque) and memory intrinsics
- std/wasm intrinsics (i32/i64/f32/f64 ops + memory.*) mapped as compiler intrinsics
- Added WASI tests for io/fs/clock/random and memory ops

### std/jswat Sources
- Added jswat sources for std modules: `std/wasm.js`, `std/mem.js`, `std/collections.js`, `std/io.js`, `std/fs.js`, `std/random.js`, `std/encoding.js`, `std/string.js`, `std/range.js`, `std/clock.js`

### std/math (complete)
- Native ops: sqrt, floor, ceil, abs, min, max, trunc (binaryen f64 ops)
- Transcendental: exp, log, sin, cos (Taylor/atanh series), pow = exp(e·log(base))
- `**` operator lowered to `__jswat_math_pow` in genBinOp
- 23 unit tests passing (`test/std-math.test.js`)

### std/iter (complete)
- `iter(arr)` → lazy iterator from array
- `.count()`, `.take(n)`, `.map(fn)`, `.filter(fn)`, `.collect()`, `.forEach(fn)`
- Callbacks via `call_indirect` into function table
- 9 unit tests passing (`test/std-iter.test.js`)

### std/string (complete)
- `.length`, `.charAt(i)`, `.slice(start, end)`, `.concat(other)`, `.indexOf(needle)`
- `.startsWith(prefix)`, `.endsWith(suffix)`, `.includes(needle)`, `.equals(other)`
- `String.from(n)` — integer to decimal string
- String table starts at offset 8 (reserves address 0 as null pointer sentinel)
- 29 unit tests passing (`test/std-string.test.js`)
- Example: `examples/strings.js`

### @export annotation (complete)
- `//@export` or `//@export("name")` controls WASM host visibility
- Unannotated functions compile but are internal-only
- All example files and test sources updated

### std/range (complete)
- `for (const i of new Range(start, end))` and `new Range(start, end, step)`
- Positive and negative step; empty range (start === end) is zero iterations
- Nested ranges and `break`/`continue` work correctly
- Root bug fixed: `collectReturnTypes` in `typecheck.js` was missing a `ForOfStatement` case — identifiers inside for-of bodies had no `_type`, causing "No WAT type for operator '+'" at codegen time
- 11 unit tests passing (`test/std-range.test.js`)
- Example: `examples/range.js`

### Phase 5 — Static Class Members, Inheritance, Bug Fixes

#### Static class members (complete)
- Static fields stored as WASM mutable globals (`ClassName__sf_field`)
- Static methods generated as `ClassName__sm_method` (no `this` param)
- Static getters generated as `ClassName__sg_getter`
- `inferClass` extended to infer static fields/methods/getters and inheritance
- MemberExpression codegen checks static fields → globals, static getters → calls, instance getters → calls

#### Inheritance (complete)
- `extends` keyword: parent instance fields copied into child ClassInfo
- `super()` calls parent constructor with `this` and default-filled args
- `findCommonAncestor` allows polymorphic return types (Ok|Err → Result)

#### Bug fixes
- `**` operator: typecheck always returns f64; codegen converts integer operands via `binaryen.getExpressionType`
- `!` unary operator: now emits `i32.eqz` (was previously dropped entirely)
- f64 instance field assignments: use `__tmp_f64` local to avoid i32/f64 type mismatch
- std call args auto-coerced to expected param types (Math.max(0, x) now converts 0 to f64)
- Field type not updated when assigning across integer/float boundary (f64 result into i32 field)
- Instance getter vs field access: PrivateIdentifier → field load, Identifier → method call

#### 21-fizzbuzz.js enabled (test)
- fd_write-based output capture; checks for Fizz, Buzz, FizzBuzz

#### 21-game-loop.js enabled (test)
- Vec2 + Player classes with private fields, getters, std/math
- Game class with static fields/methods/getters
- Verifies damage/health/running cycle

**Total: 222 passing, 5 pending, 0 failing**

---

## In Progress

---

## Plan

### Step-by-step plan (compiler features → std sources → tests)
1. Add array support end-to-end:
   - Allow `ArrayExpression` literals, `arr[index]`, `arr[index]=`, `arr.length`, `arr.push`.
   - Implement runtime helpers (`__jswat_array_new/get/set/push/length`) and wire into codegen.
   - Add tests for array push/get/set/length and bracket access.
2. Add function references + indirect calls:
   - Track function identifiers as `funcref` in typecheck.
   - Emit wasm `table` + `elem` for eligible functions (i32 params/returns).
   - Emit `call_indirect` for function-typed values and iterator combinators.
   - Add tests for higher-order functions and indirect calls.
3. Implement `IteratorResult` in std/core (and ensure class layout fields `value`, `done`):
   - Add jswat source in std (or compiler-synthesized class) and tests for `next()` semantics.
4. Add string byte-level intrinsics:
   - Provide raw byte load/store helpers for str/alloc buffers.
   - Implement `String.asStr` as a compiler intrinsic (str header view).
   - Add tests for `length`, `asStr`, and byte-level operations.
5. Implement full `std/string` per `std.md`:
   - `constructor`, `append`, `slice`, `indexOf`, `includes`, `startsWith`, `endsWith`,
     `toUpperCase`, `toLowerCase`, `trim`, `split`, `replace`, `padStart`, `padEnd`, `repeat`, `at`,
     `equals`, `hash`, `dispose`, and static `from`.
   - Add tests to cover each method and edge cases.
6. Implement full `std/iter` per `std.md`:
   - Chain, map/filter/take/skip/etc., `collect`, `forEach`, `find`, `some`, `every`, `count`, etc.
   - Add tests to cover chaining and iterator correctness.
7. Update examples to use std/string and std/iter, run tests, and commit.
