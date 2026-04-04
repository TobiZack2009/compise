export class AppError {
  message = "";
  constructor(msg = "") {
    this.message = msg;
  }
}

export class ValueError extends AppError {
  constructor(msg = "") { super(msg); }
}

export class RangeError extends AppError {
  constructor(msg = "") { super(msg); }
}

export class IOError extends AppError {
  constructor(msg = "") { super(msg); }
}

export class ParseError extends AppError {
  constructor(msg = "") { super(msg); }
}

export class NotFoundError extends AppError {
  constructor(msg = "") { super(msg); }
}
