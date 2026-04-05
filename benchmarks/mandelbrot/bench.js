// Node.js — Mandelbrot
const [W, H, M] = [400, 300, 256];
function mandelbrot(w, h, maxIter) {
  let total = 0;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const cx = -2.5 + px / w * 3.5;
      const cy = -1.2 + py / h * 2.4;
      let zx = 0, zy = 0, iter = 0;
      while (iter < maxIter) {
        const zx2 = zx*zx, zy2 = zy*zy;
        if (zx2 + zy2 > 4) break;
        const tmp = zx2 - zy2 + cx;
        zy = 2*zx*zy + cy; zx = tmp; iter++;
      }
      total += iter;
    }
  }
  return total;
}
const t = performance.now();
const total = mandelbrot(W, H, M);
console.log(`Mandelbrot ${W}x${H} maxIter=${M}: total_iters=${total} (${(performance.now()-t).toFixed(1)}ms)`);
