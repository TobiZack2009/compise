export class Range {
  #start; #end; #step;

  constructor(start = 0, end = 0, step = 1) {
    this.#start = start;
    this.#end = end;
    this.#step = step;
  }

  //@symbol(Symbol.iterator)
  iter() { return new RangeIterator(this.#start, this.#end, this.#step); }
}

class RangeIterator {
  #cur; #end; #step; #done;
  constructor(start = 0, end = 0, step = 1) {
    this.#cur = start;
    this.#end = end;
    this.#step = step;
    this.#done = false;
  }

  //@symbol(Symbol.iterator)
  iter() { return this; }

  //@symbol(Symbol.next)
  next() {
    if (this.#done) return new IteratorResult(0, true);
    const value = this.#cur;
    if (this.#step > 0) {
      if (value >= this.#end) { this.#done = true; return new IteratorResult(0, true); }
    } else {
      if (value <= this.#end) { this.#done = true; return new IteratorResult(0, true); }
    }
    this.#cur += this.#step;
    return new IteratorResult(value, false);
  }
}
