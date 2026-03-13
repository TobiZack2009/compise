/**
 * @fileoverview std/range examples — Range-based for-of iteration.
 */
import { Range } from 'std/range';

// Sum 1..n using Range.
//@export
function sumTo(n = 0) {
  let s = 0;
  for (const i of new Range(1, n + 1)) {
    s = s + i;
  }
  return s;
}

// Count multiples of k in [0, limit).
//@export
function countMultiples(k = 1, limit = 0) {
  let count = 0;
  for (const i of new Range(0, limit, k)) {
    count = count + 1;
  }
  return count;
}

// Return the n-th triangular number: 1 + 2 + ... + n.
//@export
function triangular(n = 0) {
  let s = 0;
  for (const i of new Range(1, n + 1)) {
    s = s + i;
  }
  return s;
}

// Find first i in [0, limit) where i*i > target.
//@export
function sqrtFloor(target = 0) {
  let result = 0;
  for (const i of new Range(0, target + 1)) {
    if (i * i <= target) {
      result = i;
    }
  }
  return result;
}
