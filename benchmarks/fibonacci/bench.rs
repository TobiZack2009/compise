use std::time::Instant;
fn fib_count() -> u32 {
    let (mut a, mut b): (u64, u64) = (0, 1);
    let mut count = 0u32;
    loop {
        let next = a.wrapping_add(b);
        if next < b { break; }
        a = b; b = next; count += 1;
        if b == u64::MAX { break; }
    }
    count
}
fn main() {
    let t = Instant::now();
    let n = fib_count();
    println!("Fibonacci numbers under u64: {} ({}ms)", n, t.elapsed().as_millis());
}
