// Arena allocator: bump-pointer, O(1) alloc, O(1) reset.
// Memory layout: [base:i32 4B][ptr:i32 4B][cap:i32 4B][data: cap bytes]

//@external("__jswat_runtime", "__jswat_arena_new")
function __arena_new(size = usize(0)) { return usize(0); }

//@external("__jswat_runtime", "__jswat_arena_alloc")
function __arena_alloc(arena = usize(0), n = usize(0)) { return usize(0); }

//@external("__jswat_runtime", "__jswat_arena_reset")
function __arena_reset(arena = usize(0)) { }

export class Arena {
  #handle;

  constructor(size = usize(0)) {
    this.#handle = __arena_new(size);
  }

  alloc(n = usize(0)) {
    return __arena_alloc(this.#handle, n);
  }

  reset() {
    __arena_reset(this.#handle);
  }
}
