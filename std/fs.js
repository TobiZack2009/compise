//@external("__jswat_runtime", "__jswat_fs_read")
function __fs_read(path = "") { return ""; }
//@external("__jswat_runtime", "__jswat_fs_write")
function __fs_write(path = "", data = "") { return false; }
//@external("__jswat_runtime", "__jswat_fs_append")
function __fs_append(path = "", data = "") { return false; }
//@external("__jswat_runtime", "__jswat_fs_exists")
function __fs_exists(path = "") { return false; }
//@external("__jswat_runtime", "__jswat_fs_delete")
function __fs_delete(path = "") { return false; }
//@external("__jswat_runtime", "__jswat_fs_mkdir")
function __fs_mkdir(path = "") { return false; }
//@external("__jswat_runtime", "__jswat_fs_readdir")
function __fs_readdir(path = "") { return ""; }

export class FS {
  static read(path = "") { return __fs_read(path); }
  static write(path = "", data = "") { return __fs_write(path, data); }
  static append(path = "", data = "") { return __fs_append(path, data); }
  static exists(path = "") { return __fs_exists(path); }
  static delete(path = "") { return __fs_delete(path); }
  static mkdir(path = "") { return __fs_mkdir(path); }
  static readdir(path = "") { return __fs_readdir(path); }
}
