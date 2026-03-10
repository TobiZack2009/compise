// §21.7 WASM Computation Module — requires Phase 2 (std/math, std/random, std/range, for-of, ptr)
import Math from "std/math";
import Random from "std/random";
import { Range } from "std/range";

//@export("seed")
function seed(s = 0) { Random.seed(s); }

//@export("dot_product")
function dotProduct(a = ptr(0.0), b = ptr(0.0), n = usize(0)) {
  let sum = 0.0;
  for (const i of new Range(usize(0), n)) {
    const av = ptr.fromAddr(a.addr + i * usize(8), 0.0);
    const bv = ptr.fromAddr(b.addr + i * usize(8), 0.0);
    sum += av.val * bv.val;
  }
  return sum;
}

//@export("matrix_fill_random")
function matrixFillRandom(mat = ptr(0.0), rows = usize(0), cols = usize(0)) {
  for (const i of new Range(usize(0), rows * cols)) {
    ptr.fromAddr(mat.addr + i * usize(8), 0.0).val = Random.float();
  }
}
