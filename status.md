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

---

## In Progress

std/iter + std/string are not feature-complete yet.

---

## Plan

### Phase 5 — Compiler Features for std/string + std/iter
- Implement computed member access for byte buffers/arrays (`obj[index]`) with type rules
- Add array literals, `length`, and `push` for simple array types (needed by iter/collections)
- Add `IteratorResult` as a std/core class with fields `value` and `done`
- Add string buffer view intrinsic (`String.asStr`) and raw byte ops (load/store helpers)
- Add function value support (function references + `call_indirect`) for iterator combinators
- Expand tests to cover iterator chains and string byte-level methods

### Phase 6 — std/string + std/iter Sources
- Implement full std/string per `std.md` using the new compiler intrinsics
- Implement std/iter Chain + combinators per `std.md`
- Add examples/tests to exercise the std sources
