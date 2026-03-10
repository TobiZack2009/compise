// Basic integer math utilities — Phase 1 compatible
// Demonstrates: multiple functions, if/else, local variables

function add(a = 0, b = 0) { return a + b; }
function sub(a = 0, b = 0) { return a - b; }
function mul(a = 0, b = 0) { return a * b; }
function div(a = 0, b = 0) { return a / b; }
function mod(a = 0, b = 0) { return a % b; }

function max(a = 0, b = 0) {
  if (a > b) { return a; } else { return b; }
}

function min(a = 0, b = 0) {
  if (a < b) { return a; } else { return b; }
}

function abs(x = 0) {
  if (x < 0) { return -x; } else { return x; }
}
//@export("clamp")
function clamp(val = 0, lo = 0, hi = 0) {
  if (val < lo) { return lo; }
  else if (val > hi) { return hi; }
  else { return val; }
}
