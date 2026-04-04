//# compiler::test
// Mixing integer + float without an explicit cast is a type error (CE-T02).
//# compiler::error.expect {type error}
const bad = 1 + 1.0;
