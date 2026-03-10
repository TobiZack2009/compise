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

---

## In Progress

Nothing — Phase 1 is complete and committed (95fb828).

---

## Plan

### Phase 2 — Loops, Logical Ops, Compound Assignments, User Function Calls

**`src/types.js`**
- Add `TYPES.unknown` (bottom type, `kind: 'unknown'`) for fixpoint inference of recursive functions
- Update `promoteTypes`: `if (a.kind === 'unknown') return b; if (b.kind === 'unknown') return a;`

**`src/typecheck.js`**
- Add `WhileStatement`, `ForStatement`, `DoWhileStatement` to `collectReturnTypes` (recurse into body)
- Add `WhileStatement`, `ForStatement`, `DoWhileStatement` to `inferStatement`
- Add `LogicalExpression` (`&&`, `||`) to `inferExpr` → returns `bool`
- Add `UpdateExpression` (`x++`, `x--`, `++x`, `--x`) to `inferExpr` → returns operand type
- Add `AssignmentExpression` (`=`, `+=`, `-=`, `*=`, `/=`, `%=`) to `inferExpr` → returns rhs type
- Update `CallExpression` to look up user function signatures and return their declared return type
- Add fixpoint iteration in `inferTypes`: register all function names with `TYPES.unknown` return type first, then re-infer until signatures stabilise (for recursive functions)

**`src/codegen.js`**
- Add `GenContext` class: label counter, loop stack (`[{ breakLabel, continueLabel }]`), push/pop loop
- Update all statement generators to accept a `GenContext` parameter
- Add `WhileStatement` codegen:
  ```wat
  block $brk_N
    loop $lp_N
      [condition] i32.eqz br_if $brk_N
      [body]
      br $lp_N
    end
  end
  ```
- Add `ForStatement` codegen (init + inner block for continue-to-update):
  ```wat
  [init]
  block $brk_N
    loop $lp_N
      [condition] i32.eqz br_if $brk_N
      block $inner_N
        [body]
      end
      [update]
      br $lp_N
    end
  end
  ```
- Add `DoWhileStatement` codegen:
  ```wat
  block $brk_N
    loop $lp_N
      [body]
      [condition] br_if $lp_N
    end
  end
  ```
- Add `BreakStatement` → `br $brk_N`
- Add `ContinueStatement` → `br $inner_N` (for-loop) or `br $lp_N` (while/do-while)
- Add `AssignmentExpression` (`=`) → `[rhs] local.tee $name`
- Add `AssignmentExpression` (`+=`, `-=`, etc.) → `local.get $name [rhs] op local.tee $name`
- Add `UpdateExpression` (`x++`) → `local.get $x local.get $x i32.const 1 i32.add local.set $x` (pre: tee instead of get+set)
- Add `LogicalExpression` (`&&`) → short-circuit via WAT `if (result i32)`: `[a] if (result i32) [b] else i32.const 0 end`
- Add `LogicalExpression` (`||`) → `[a] if (result i32) i32.const 1 else [b] end`
- Add user function calls in `CallExpression` → `[args...] call $fnname`
- Fix `ExpressionStatement` to emit `drop` when the expression has a non-void/non-missing type (assignment expressions, calls with return value, etc.)

**New files**
- `examples/loops.js` — demonstrates while, for, do-while, break, continue
- `examples/fibonacci.js` — recursive function (tests fixpoint inference)
- `test/phase2.test.js` — loop execution, logical ops, compound assignments, user calls, recursion

### Phase 3 — Classes, `this`, Method Calls, `for-of`
- Class layout (field ordering, struct-like memory layout)
- `new Foo(...)` allocation
- `this` in method context
- Method calls (`obj.method(args)`)
- `for-of` over ranges/arrays

### Phase 4 — Imports, Standard Library Stubs
- `import { ... } from 'std/math'`, `'std/io'`, `'std/string'`, etc.
- External function declarations (`import` → WASM import section)
- Enable section-21 examples (currently all pending/skipped)
