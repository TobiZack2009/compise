//@external("__jswat_runtime", "__jswat_base64_encode")
function __base64_encode(s = "") { return ""; }
//@external("__jswat_runtime", "__jswat_base64_decode")
function __base64_decode(s = "") { return ""; }
//@external("__jswat_runtime", "__jswat_utf8_validate")
function __utf8_validate(s = "") { return false; }
//@external("__jswat_runtime", "__jswat_utf8_char_count")
function __utf8_char_count(s = "") { return usize(0); }

export class Base64 {
  static encode(s = "") { return __base64_encode(s); }
  static decode(s = "") { return __base64_decode(s); }
}

export class UTF8 {
  static validate(s = "") { return __utf8_validate(s); }
  static charCount(s = "") { return __utf8_char_count(s); }
}
