// String @export — tests str fat-pointer marshalling through the bridge.

//@export("greet")
function greet(name = "") {
  return `Hello, ${name}!`;
}

//@export("strLen")
function strLen(s = "") {
  return s.length;
}
