//@external("__jswat_runtime", "__jswat_process_exit")
function __process_exit(code = i32(0)) { }
//@external("__jswat_runtime", "__jswat_process_env")
function __process_env(name = "") { return ""; }
//@external("__jswat_runtime", "__jswat_process_args")
function __process_args() { return ""; }

export class Process {
  static exit(code = i32(0)) { __process_exit(code); }
  static env(name = "") { return __process_env(name); }
  static args() { return __process_args(); }
}
