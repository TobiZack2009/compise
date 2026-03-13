// Basic integer math utilities — Phase 1 compatible
// Demonstrates: multiple functions, if/else, local variables

//@export
function add(a = 0, b = 0) { return a + b; }
//@export
function sub(a = 0, b = 0) { return a - b; }
//@export
function mul(a = 0, b = 0) { return a * b; }
//@export
function div(a = 0, b = 0) { return a / b; }
//@export
function mod(a = 0, b = 0) { return a % b; }

//@export
function max(a = 0, b = 0) {
  if (a > b) { return a; } else { return b; }
}

//@export
function min(a = 0, b = 0) {
  if (a < b) { return a; } else { return b; }
}

//@export
function abs(x = 0) {
  if (x < 0) { return -x; } else { return x; }
}
//@export("clamp")
function clamp(val = 0, lo = 0, hi = 0) {
  if (val < lo) { return lo; }
  else if (val > hi) { return hi; }
  else { return val; }
}
