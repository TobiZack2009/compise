use std::time::Instant;
fn mandelbrot(width: u32, height: u32, max_iter: u32) -> u64 {
    let mut total: u64 = 0;
    for py in 0..height {
        for px in 0..width {
            let cx = -2.5 + (px as f64) / (width as f64) * 3.5;
            let cy = -1.2 + (py as f64) / (height as f64) * 2.4;
            let (mut zx, mut zy) = (0.0f64, 0.0f64);
            let mut iter = 0u32;
            while iter < max_iter {
                let zx2 = zx * zx;
                let zy2 = zy * zy;
                if zx2 + zy2 > 4.0 { break; }
                let tmp = zx2 - zy2 + cx;
                zy = 2.0 * zx * zy + cy;
                zx = tmp;
                iter += 1;
            }
            total += iter as u64;
        }
    }
    total
}
fn main() {
    let (w, h, m) = (400u32, 300u32, 256u32);
    let t = Instant::now();
    let total = mandelbrot(w, h, m);
    println!("Mandelbrot {}x{} maxIter={}: total_iters={} ({}ms)", w, h, m, total, t.elapsed().as_millis());
}
