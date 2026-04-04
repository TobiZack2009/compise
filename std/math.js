//@external("__jswat_runtime", "__jswat_math_sqrt")
function __math_sqrt(x = 0.0) { return 0.0; }
//@external("__jswat_runtime", "__jswat_math_floor")
function __math_floor(x = 0.0) { return 0.0; }
//@external("__jswat_runtime", "__jswat_math_ceil")
function __math_ceil(x = 0.0) { return 0.0; }
//@external("__jswat_runtime", "__jswat_math_abs")
function __math_abs(x = 0.0) { return 0.0; }
//@external("__jswat_runtime", "__jswat_math_trunc")
function __math_trunc(x = 0.0) { return 0.0; }
//@external("__jswat_runtime", "__jswat_math_min")
function __math_min(a = 0.0, b = 0.0) { return 0.0; }
//@external("__jswat_runtime", "__jswat_math_max")
function __math_max(a = 0.0, b = 0.0) { return 0.0; }
//@external("__jswat_runtime", "__jswat_math_pow")
function __math_pow(a = 0.0, b = 0.0) { return 0.0; }
//@external("__jswat_runtime", "__jswat_math_sin")
function __math_sin(x = 0.0) { return 0.0; }
//@external("__jswat_runtime", "__jswat_math_cos")
function __math_cos(x = 0.0) { return 0.0; }
//@external("__jswat_runtime", "__jswat_math_log")
function __math_log(x = 0.0) { return 0.0; }
//@external("__jswat_runtime", "__jswat_math_exp")
function __math_exp(x = 0.0) { return 0.0; }

export class Math {
  static sqrt(x = 0.0)        { return __math_sqrt(x); }
  static floor(x = 0.0)       { return __math_floor(x); }
  static ceil(x = 0.0)        { return __math_ceil(x); }
  static abs(x = 0.0)         { return __math_abs(x); }
  static trunc(x = 0.0)       { return __math_trunc(x); }
  static min(a = 0.0, b = 0.0){ return __math_min(a, b); }
  static max(a = 0.0, b = 0.0){ return __math_max(a, b); }
  static pow(a = 0.0, b = 0.0){ return __math_pow(a, b); }
  static sin(x = 0.0)         { return __math_sin(x); }
  static cos(x = 0.0)         { return __math_cos(x); }
  static log(x = 0.0)         { return __math_log(x); }
  static exp(x = 0.0)         { return __math_exp(x); }
}
