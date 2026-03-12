//@external("__jswat_runtime", "__jswat_random_float")
function __random_float() { return 0.0; }
//@external("__jswat_runtime", "__jswat_random_seed")
function __random_seed(seed = 0) { }

export default class Random {
  static float() { return __random_float(); }
  static seed(seed = 0) { __random_seed(seed); }
}
