import { memory_copy, memory_fill } from "std/wasm";
import { Pool } from "std/alloc/pool";
import { Arena } from "std/alloc/arena";

//@external("__jswat_runtime", "__jswat_alloc")
function __alloc(size = usize(0)) { return usize(0); }

//@external("__jswat_runtime", "__jswat_free")
function __free(ptr = usize(0), size = usize(0)) { }

//@external("__jswat_runtime", "__jswat_alloc_bytes")
function __allocBytes(n = usize(0), fill = i32(0)) { return usize(0); }

//@external("__jswat_runtime", "__jswat_realloc")
function __realloc(ptr = usize(0), oldSize = usize(0), newSize = usize(0)) { return usize(0); }

export class alloc {
  static bytes(n = usize(0), fill = u8(0)) {
    return __allocBytes(n, i32(fill));
  }

  static realloc(buf = u8(0), newSize = usize(0)) {
    const newBuf = __allocBytes(newSize, i32(0));
    return newBuf;
  }

  static copy(dst = u8(0), src = u8(0), n = usize(0)) {
    memory_copy(usize(dst), usize(src), n);
  }

  static fill(dst = u8(0), value = u8(0), n = usize(0)) {
    memory_fill(usize(dst), i32(value), n);
  }

  static pool(stride = usize(0), cap = usize(0)) {
    return new Pool(stride, cap);
  }

  static arena(size = usize(0)) {
    return new Arena(size);
  }
}

export class ptr {
  static fromAddr(addr = usize(0), type = 0) {
    return type;
  }

  static diff(a = ptr(0), b = ptr(0)) {
    return isize(a.addr) - isize(b.addr);
  }
}
