// Demonstrates: classes, fields, constructor, method calls, this.

class Point {
  x;
  y;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  sum() { return this.x + this.y; }

  move(dx = 0, dy = 0) {
    this.x = this.x + dx;
    this.y = this.y + dy;
    return this.sum();
  }
}

//@export
function main(a = 0, b = 0) {
  const p = new Point(a, b);
  return p.move(1, 2);
}
