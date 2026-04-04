// std/iter — lazy iterator combinators.
// The iter() function and its method chain are handled natively by the compiler.
// This file exists so that `import { iter } from 'std/iter'` resolves via the
// CLI file-based resolver. All calls to iter(...).map/filter/etc. are inlined
// directly by the codegen (see expressions.js) with no dispatch through this file.

export function iter(arr = usize(0)) { return usize(0); }
