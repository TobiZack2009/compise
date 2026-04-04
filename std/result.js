import { AppError } from 'std/error';

export class Result {
  _ok;
  _err;

  static ok(value = 0) {
    const r = new Result();
    r._ok = value;
    r._err = 0;
    return r;
  }

  static err(error = AppError) {
    const r = new Result();
    r._ok = 0;
    r._err = error;
    return r;
  }

  isOk()  { return this._err === 0; }
  isErr() { return this._err !== 0; }

  unwrap() {
    return this._ok;
  }

  unwrapOr(fallback = 0) {
    if (this._err !== 0) { return fallback; }
    return this._ok;
  }

  raise() {
    return this._ok;
  }
}
