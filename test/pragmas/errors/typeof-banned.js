//# compiler::test
// typeof in a branch condition is banned.
//# compiler::error.expect {typeof}
function f(x = 0) { if (typeof x === 'number') { } }
