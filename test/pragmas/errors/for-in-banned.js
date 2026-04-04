//# compiler::test
// for...in is banned (CE-CF01) — caught at parse time.
//# compiler::error.expect {for...in}
for (let k in obj) { }
