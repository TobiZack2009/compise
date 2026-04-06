// §21.5 Result Pattern — requires Phase 2 (classes, inheritance, switch narrowing, std/io)
import { console } from "std/io";
import String from "std/string";

class Result { }
class Ok extends Result {
  value;
  constructor(value = 0) { super(); this.value = value; }
}
class Err extends Result {
  message;
  constructor(message = "") { super(); this.message = message; }
}

function divide(a = 0, b = 0) {
  if (b === 0) return new Err("division by zero");
  return new Ok(a / b);
}

function printResult(r = Result) {
  switch (r) {
    case Ok:  console.log(`Result: ${String.from(r.value)}`); break;
    case Err: console.log(`Error: ${r.message}`); break;
  }
}

printResult(divide(10, 2));   // Result: 5
printResult(divide(10, 0));   // Error: division by zero
