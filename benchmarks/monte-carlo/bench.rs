use std::time::Instant;
fn xorshift(s: u32) -> u32 {
    let mut x = s;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    x
}
fn monte_carlo_pi(n: u32) -> f64 {
    let mut inside: u64 = 0;
    let mut state: u32 = 2463534242;
    for _ in 0..n {
        state = xorshift(state);
        let x = (state & 0x7fffffff) as f64 / 2147483647.0;
        state = xorshift(state);
        let y = (state & 0x7fffffff) as f64 / 2147483647.0;
        if x * x + y * y <= 1.0 { inside += 1; }
    }
    inside as f64 / n as f64 * 4.0
}
fn main() {
    let n = 10_000_000u32;
    let t = Instant::now();
    let pi = monte_carlo_pi(n);
    println!("Monte Carlo π ({} samples): {} ({}ms)", n, pi, t.elapsed().as_millis());
}
