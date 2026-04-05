import { console } from "std/io";
import { Clock } from "std/clock";

function fibCount() {
  let a = i64(0);
  let b = i64(1);
  let count = 0;
  while (1) {
    const next = a + b;
    if (next < b) { break; }
    a = b;
    b = next;
    count = count + 1;
  }
  return count;
}

const t0 = Clock.now();
const n = fibCount();
const elapsed = Clock.now() - t0;
console.log(`Fibonacci numbers under u64: ${n} (${elapsed}ms)`);
