// §21.2 FizzBuzz — requires Phase 2 (std/io, std/string, std/range, for-of, classes)
import { console } from "std/io";
import String from "std/string";
import { Range } from "std/range";

for (const i of new Range(1, 101)) {
  const fizz = i % 3 === 0;
  const buzz = i % 5 === 0;
  if (fizz && buzz) console.log("FizzBuzz");
  else if (fizz)    console.log("Fizz");
  else if (buzz)    console.log("Buzz");
  else              console.log(String.from(i));
}
