// Demonstrates: recursion + fixpoint inference.

//@export
function fib(n = 0) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}
