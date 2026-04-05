import { console } from "std/io";
import { Clock } from "std/clock";

const WIDTH  = 400;
const HEIGHT = 300;
const MAX_ITER = 256;

function mandelbrot(width = 0, height = 0, maxIter = 0) {
  let total = 0;
  let py = 0;
  while (py < height) {
    let px = 0;
    while (px < width) {
      const cx = -2.5 + f64(px) / f64(width) * 3.5;
      const cy = -1.2 + f64(py) / f64(height) * 2.4;
      let zx = 0.0;
      let zy = 0.0;
      let iter = 0;
      while (iter < maxIter) {
        const zx2 = zx * zx;
        const zy2 = zy * zy;
        if (zx2 + zy2 > 4.0) { break; }
        const tmp = zx2 - zy2 + cx;
        zy = 2.0 * zx * zy + cy;
        zx = tmp;
        iter = iter + 1;
      }
      total = total + iter;
      px = px + 1;
    }
    py = py + 1;
  }
  return total;
}

const t0 = Clock.now();
const total = mandelbrot(WIDTH, HEIGHT, MAX_ITER);
const elapsed = Clock.now() - t0;
console.log(`Mandelbrot ${WIDTH}x${HEIGHT} maxIter=${MAX_ITER}: total=${total} (${elapsed}ms)`);
