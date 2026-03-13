// Demonstrates: while/for/do-while, break/continue, logical ops, compound assignments.
//@export
function whileSum(n = 0) {
  let i = 0;
  let sum = 0;
  while (i < n) {
    sum += i;
    i++;
  }
  return sum;
}

//@export
function forSum(n = 0) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i === 3) continue;
    if (i === 7) break;
    sum += i;
  }
  return sum;
}

//@export
function doWhileSum(n = 0) {
  let i = 0;
  let sum = 0;
  do {
    sum += i;
    i++;
  } while (i < n);
  return sum;
}

//@export
function logicalAnd(a = 0, b = 0) {
  return (a > 0 && b > 0) ? 1 : 0;
}

//@export
function logicalOr(a = 0, b = 0) {
  return (a > 0 || b > 0) ? 1 : 0;
}

//@export
function compound(a = 0, b = 0) {
  let x = a;
  x += b;
  x *= 2;
  x -= 1;
  x /= 3;
  x %= 5;
  return x;
}

//@export
function update(a = 0) {
  let x = a;
  const y = x++;
  const z = ++x;
  return x + y + z;
}
