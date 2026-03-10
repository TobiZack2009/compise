// §21.4 Generic Stack — requires Phase 2 (classes, private fields, generics, arrays)
class Stack {
  #items;
  #size;

  constructor(items = [0]) {
    this.#items = items;
    this.#size = usize(0);
  }

  push(item = 0) { this.#items.push(item); this.#size++; }

  pop() {
    if (this.#size === usize(0)) return null;
    this.#size--;
    return this.#items.pop();
  }

  peek() {
    if (this.#size === usize(0)) return null;
    return this.#items[this.#size - usize(1)];
  }

  get size()  { return this.#size; }
  get empty() { return this.#size === usize(0); }
}

const nums = new Stack([0]);
nums.push(1); nums.push(2); nums.push(3);
nums.pop();   // 3

const floats = new Stack([0.0]);
floats.push(3.14); floats.push(2.71);
