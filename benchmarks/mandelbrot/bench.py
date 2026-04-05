import time
W, H, M = 400, 300, 256
def mandelbrot(w, h, max_iter):
    total = 0
    for py in range(h):
        for px in range(w):
            cx = -2.5 + px / w * 3.5
            cy = -1.2 + py / h * 2.4
            zx = zy = 0.0; it = 0
            while it < max_iter:
                zx2, zy2 = zx*zx, zy*zy
                if zx2 + zy2 > 4.0: break
                zx, zy = zx2 - zy2 + cx, 2*zx*zy + cy; it += 1
            total += it
    return total
t = time.perf_counter()
total = mandelbrot(W, H, M)
print(f"Mandelbrot {W}x{H} maxIter={M}: total_iters={total} ({(time.perf_counter()-t)*1000:.1f}ms)")
