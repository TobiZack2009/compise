// Pool allocator: free-list, O(1) alloc/free, fixed stride.
// Memory layout: [stride:i32 4B][cap:i32 4B][next:i32 4B][freelist:i32 4B][data: stride*cap bytes]

//@external("__jswat_runtime", "__jswat_pool_new")
function __pool_new(stride = usize(0), cap = usize(0)) { return usize(0); }

//@external("__jswat_runtime", "__jswat_pool_alloc")
function __pool_alloc(pool = usize(0)) { return usize(0); }

//@external("__jswat_runtime", "__jswat_pool_free")
function __pool_free(pool = usize(0), ptr = usize(0)) { }

export class Pool {
  #handle;

  constructor(stride = usize(0), cap = usize(0)) {
    this.#handle = __pool_new(stride, cap);
  }

  alloc() {
    return __pool_alloc(this.#handle);
  }

  free(p = usize(0)) {
    __pool_free(this.#handle, p);
  }
}
