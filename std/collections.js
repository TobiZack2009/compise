//@external("__jswat_runtime", "__jswat_map_new")
function __map_new() { return usize(0); }
//@external("__jswat_runtime", "__jswat_map_set")
function __map_set(map = usize(0), key = "", value = 0) { }
//@external("__jswat_runtime", "__jswat_map_get")
function __map_get(map = usize(0), key = "") { return 0; }
//@external("__jswat_runtime", "__jswat_map_has")
function __map_has(map = usize(0), key = "") { return false; }
//@external("__jswat_runtime", "__jswat_map_delete")
function __map_delete(map = usize(0), key = "") { return false; }
//@external("__jswat_runtime", "__jswat_map_clear")
function __map_clear(map = usize(0)) { }
//@external("__jswat_runtime", "__jswat_map_size")
function __map_size(map = usize(0)) { return usize(0); }

//@external("__jswat_runtime", "__jswat_set_new")
function __set_new() { return usize(0); }
//@external("__jswat_runtime", "__jswat_set_add")
function __set_add(set = usize(0), value = 0) { }
//@external("__jswat_runtime", "__jswat_set_has")
function __set_has(set = usize(0), value = 0) { return false; }
//@external("__jswat_runtime", "__jswat_set_delete")
function __set_delete(set = usize(0), value = 0) { return false; }
//@external("__jswat_runtime", "__jswat_set_clear")
function __set_clear(set = usize(0)) { }
//@external("__jswat_runtime", "__jswat_set_size")
function __set_size(set = usize(0)) { return usize(0); }

//@external("__jswat_runtime", "__jswat_stack_new")
function __stack_new() { return usize(0); }
//@external("__jswat_runtime", "__jswat_stack_push")
function __stack_push(stack = usize(0), value = 0) { }
//@external("__jswat_runtime", "__jswat_stack_pop")
function __stack_pop(stack = usize(0)) { return 0; }
//@external("__jswat_runtime", "__jswat_stack_peek")
function __stack_peek(stack = usize(0)) { return 0; }
//@external("__jswat_runtime", "__jswat_stack_empty")
function __stack_empty(stack = usize(0)) { return false; }
//@external("__jswat_runtime", "__jswat_stack_size")
function __stack_size(stack = usize(0)) { return usize(0); }

//@external("__jswat_runtime", "__jswat_queue_new")
function __queue_new() { return usize(0); }
//@external("__jswat_runtime", "__jswat_queue_push")
function __queue_push(queue = usize(0), value = 0) { }
//@external("__jswat_runtime", "__jswat_queue_pop")
function __queue_pop(queue = usize(0)) { return 0; }
//@external("__jswat_runtime", "__jswat_queue_peek")
function __queue_peek(queue = usize(0)) { return 0; }
//@external("__jswat_runtime", "__jswat_queue_empty")
function __queue_empty(queue = usize(0)) { return false; }
//@external("__jswat_runtime", "__jswat_queue_size")
function __queue_size(queue = usize(0)) { return usize(0); }

//@external("__jswat_runtime", "__jswat_deque_new")
function __deque_new() { return usize(0); }
//@external("__jswat_runtime", "__jswat_deque_push_front")
function __deque_push_front(deque = usize(0), value = 0) { }
//@external("__jswat_runtime", "__jswat_deque_push_back")
function __deque_push_back(deque = usize(0), value = 0) { }
//@external("__jswat_runtime", "__jswat_deque_pop_front")
function __deque_pop_front(deque = usize(0)) { return 0; }
//@external("__jswat_runtime", "__jswat_deque_pop_back")
function __deque_pop_back(deque = usize(0)) { return 0; }
//@external("__jswat_runtime", "__jswat_deque_peek_front")
function __deque_peek_front(deque = usize(0)) { return 0; }
//@external("__jswat_runtime", "__jswat_deque_peek_back")
function __deque_peek_back(deque = usize(0)) { return 0; }
//@external("__jswat_runtime", "__jswat_deque_empty")
function __deque_empty(deque = usize(0)) { return false; }
//@external("__jswat_runtime", "__jswat_deque_size")
function __deque_size(deque = usize(0)) { return usize(0); }

export class Map {
  handle;
  constructor() { this.handle = __map_new(); }
  set(key = "", value = 0) { __map_set(this.handle, key, value); }
  get(key = "") { return __map_get(this.handle, key); }
  has(key = "") { return __map_has(this.handle, key); }
  delete(key = "") { return __map_delete(this.handle, key); }
  clear() { __map_clear(this.handle); }
  size() { return __map_size(this.handle); }
}

export class Set {
  handle;
  constructor() { this.handle = __set_new(); }
  add(value = 0) { __set_add(this.handle, value); }
  has(value = 0) { return __set_has(this.handle, value); }
  delete(value = 0) { return __set_delete(this.handle, value); }
  clear() { __set_clear(this.handle); }
  size() { return __set_size(this.handle); }
}

export class Stack {
  handle;
  constructor() { this.handle = __stack_new(); }
  push(value = 0) { __stack_push(this.handle, value); }
  pop() { return __stack_pop(this.handle); }
  peek() { return __stack_peek(this.handle); }
  empty() { return __stack_empty(this.handle); }
  size() { return __stack_size(this.handle); }
}

export class Queue {
  handle;
  constructor() { this.handle = __queue_new(); }
  push(value = 0) { __queue_push(this.handle, value); }
  pop() { return __queue_pop(this.handle); }
  peek() { return __queue_peek(this.handle); }
  empty() { return __queue_empty(this.handle); }
  size() { return __queue_size(this.handle); }
}

export class Deque {
  handle;
  constructor() { this.handle = __deque_new(); }
  pushFront(value = 0) { __deque_push_front(this.handle, value); }
  pushBack(value = 0) { __deque_push_back(this.handle, value); }
  popFront() { return __deque_pop_front(this.handle); }
  popBack() { return __deque_pop_back(this.handle); }
  peekFront() { return __deque_peek_front(this.handle); }
  peekBack() { return __deque_peek_back(this.handle); }
  empty() { return __deque_empty(this.handle); }
  size() { return __deque_size(this.handle); }
}
