// From spec §4 — Calling Convention, float parameters
// Demonstrates: f64 function, compound arithmetic expression

function lerp(a = 0.0, b = 0.0, t = 0.0) { return a + (b - a) * t; }
