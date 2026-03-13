// Float math utilities — Phase 1 compatible
// Demonstrates: f64 params, mixed arithmetic, local variables

//@export
function fadd(a = 0.0, b = 0.0) { return a + b; }
//@export
function fsub(a = 0.0, b = 0.0) { return a - b; }
//@export
function fmul(a = 0.0, b = 0.0) { return a * b; }
//@export
function fdiv(a = 0.0, b = 0.0) { return a / b; }

//@export
function fmax(a = 0.0, b = 0.0) {
  if (a > b) { return a; } else { return b; }
}

//@export
function fmin(a = 0.0, b = 0.0) {
  if (a < b) { return a; } else { return b; }
}

//@export
function lerp(a = 0.0, b = 0.0, t = 0.0) { return a + (b - a) * t; }

// saturate: clamp a float to [0.0, 1.0]
//@export
function saturate(x = 0.0) {
  if (x < 0.0) { return 0.0; }
  else if (x > 1.0) { return 1.0; }
  else { return x; }
}
