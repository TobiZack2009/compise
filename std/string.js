//@external("__jswat_runtime", "__jswat_string_from_i32")
function __str_from_i32(n = 0) { return ""; }

export class String {
  static from(n = 0) { return __str_from_i32(n); }
}
