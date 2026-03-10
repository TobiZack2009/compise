// §21.6 Pixel Buffer — requires Phase 2 (classes, manual memory, alloc.pool, ptr.fromAddr)
import { Range } from "std/range";

class Pixel {
  r; g; b; a;
  constructor(r = u8(0), g = u8(0), b = u8(0), a = u8(255)) {
    this.r = r; this.g = g; this.b = b; this.a = a;
  }
}

class Canvas {
  #pool;
  #width;
  #height;

  constructor(width = usize(0), height = usize(0)) {
    this.#width = width;
    this.#height = height;
    this.#pool = alloc.pool(Pixel, width * height);
  }

  set(x = usize(0), y = usize(0), r = u8(0), g = u8(0), b = u8(0)) {
    const px = ptr.fromAddr(
      this.#pool.alloc(u8(0), u8(0), u8(0), u8(255)).addr
      + (y * this.#width + x) * Pixel.stride,
      Pixel
    );
    px.val.r = r; px.val.g = g; px.val.b = b;
  }

  fill(r = u8(0), g = u8(0), b = u8(0)) {
    for (const _ of new Range(usize(0), this.#width * this.#height)) {
      this.#pool.alloc(r, g, b, u8(255));
    }
  }
}

const canvas = new Canvas(usize(800), usize(600));
canvas.fill(u8(0), u8(0), u8(0));
canvas.set(usize(100), usize(100), u8(255), u8(0), u8(0));
