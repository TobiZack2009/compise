use std::time::Instant;
fn matmul(n: usize) -> i64 {
    let sz = n * n;
    let mut a = vec![0i32; sz];
    let mut b = vec![0i32; sz];
    let mut c = vec![0i32; sz];
    for i in 0..n { for j in 0..n { a[i*n+j] = (i+j) as i32; b[i*n+j] = ((i*j)%n) as i32; } }
    for i in 0..n { for j in 0..n { let mut s = 0i64; for k in 0..n { s += a[i*n+k] as i64 * b[k*n+j] as i64; } c[i*n+j] = s as i32; } }
    c[..n].iter().map(|&x| x as i64).sum()
}
fn main() {
    let n = 128usize;
    let t = Instant::now();
    let r = matmul(n);
    println!("Matrix multiply {}x{}: checksum={} ({}ms)", n, n, r, t.elapsed().as_millis());
}
