//@external("__jswat_runtime", "__jswat_console_log")
function __console_log(s = "") { }
//@external("__jswat_runtime", "__jswat_console_error")
function __console_error(s = "") { }
//@external("__jswat_runtime", "__jswat_console_warn")
function __console_warn(s = "") { }
//@external("__jswat_runtime", "__jswat_stdout_write")
function __stdout_write(s = "") { }
//@external("__jswat_runtime", "__jswat_stdout_writeln")
function __stdout_writeln(s = "") { }
//@external("__jswat_runtime", "__jswat_stderr_write")
function __stderr_write(s = "") { }
//@external("__jswat_runtime", "__jswat_stdin_read")
function __stdin_read(n = usize(0)) { return ""; }
//@external("__jswat_runtime", "__jswat_stdin_read_line")
function __stdin_read_line() { return ""; }
//@external("__jswat_runtime", "__jswat_stdin_read_all")
function __stdin_read_all() { return ""; }

export class console {
  static log(s = "") { __console_log(s); }
  static error(s = "") { __console_error(s); }
  static warn(s = "") { __console_warn(s); }
}

export class stdout {
  static write(s = "") { __stdout_write(s); }
  static writeln(s = "") { __stdout_writeln(s); }
  static writeString(s = "") { __stdout_write(s); }
}

export class stderr {
  static write(s = "") { __stderr_write(s); }
}

export class stdin {
  static read(n = usize(0)) { return __stdin_read(n); }
  static readLine() { return __stdin_read_line(); }
  static readAll() { return __stdin_read_all(); }
}
