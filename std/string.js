//@external("__jswat_runtime", "__jswat_string_from_i32")
function __string_from_i32(n = i32(0)) { return ""; }

export default class String {
  static from(n = 0) {
    return __string_from_i32(i32(n));
  }
}
