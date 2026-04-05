use std::time::Instant;
fn dot_product(n: usize) -> f32 {
    let mut a = Vec::with_capacity(n);
    let mut b = Vec::with_capacity(n);
    for i in 0..n {
        let v = ((i % 100 + 1) as f32) / 100.0f32;
        a.push(v);
        b.push(1.0f32 - v);
    }
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}
fn main() {
    let n = 1_000_000usize;
    let t = Instant::now();
    let result = dot_product(n);
    println!("f32 dot product (N={}): {} ({}ms)", n, result, t.elapsed().as_millis());
}
