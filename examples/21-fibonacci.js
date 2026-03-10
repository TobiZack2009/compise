// §21.3 Fibonacci (iterator) — requires Phase 2 (classes, Symbol traits, for-of, std/io)
import { console } from "std/io";
import String from "std/string";

class FibIterator {
  a; b;
  constructor(a = 0, b = 1) { this.a = a; this.b = b; }

  //@symbol(Symbol.iterator)
  iter() { return this; }

  //@symbol(Symbol.next)
  next() {
    const val = this.a;
    const next = this.a + this.b;
    this.a = this.b;
    this.b = next;
    return new IteratorResult(val, false);
  }
}

let count = 0;
for (const n of new FibIterator) {
  console.log(String.from(n));
  if (++count >= 10) break;
}
// 0 1 1 2 3 5 8 13 21 34
