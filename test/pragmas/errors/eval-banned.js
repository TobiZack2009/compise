//# compiler::test
// eval() is banned (CE-A02).
//# compiler::error.expect {eval}
function f(x = 0) { return eval('x'); }
