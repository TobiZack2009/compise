# Status

## Done
- Read spec in description.md and created initial implementation plan.
- Added project scaffold with CLI entrypoint and pipeline skeleton.
- Wired existing JS parser (acorn) and placeholder typecheck.
- Added WAT->WASM flow via wabt and optional optimize via binaryen.
- Implemented semantic validation for banned constructs and param defaults.
- Added minimal IR + type inference for literals and binary arithmetic.
- Implemented minimal WAT codegen for simple functions and arithmetic.
- Set up tests with mocha + chai for validator, typecheck, and wasm output.

## In Progress
- Expand AST support beyond single-return functions.

## Plan
- Implement lexer/parser constraints (banned constructs, syntax restrictions) on top of acorn AST.
- Build type inference + monomorphization + nullability analysis per spec.
- Implement class layout, field ordering, and memory model in codegen.
- Generate WASM with correct calling conventions, refcount hooks, and sret handling.
- Add stdlib stubs and CLI commands (compile/build/check/inspect) with fixtures.
- Add tests from spec examples and edge cases (casts, promotions, unions, banned features).
