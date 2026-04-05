use std::time::{SystemTime, UNIX_EPOCH};

fn clock_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn sieve(n: usize) -> usize {
    let mut is_prime = vec![true; n + 1];
    is_prime[0] = false;
    is_prime[1] = false;
    let mut i = 2;
    while i * i <= n {
        if is_prime[i] {
            let mut j = i * i;
            while j <= n {
                is_prime[j] = false;
                j += i;
            }
        }
        i += 1;
    }
    is_prime.iter().filter(|&&x| x).count()
}

fn fib_count() -> u32 {
    let mut a: u64 = 0;
    let mut b: u64 = 1;
    let mut count: u32 = 0;
    loop {
        let next = a.wrapping_add(b);
        if next < b {
            break;
        }
        a = b;
        b = next;
        count += 1;
        if b == u64::MAX {
            break;
        }
    }
    count
}

fn main() {
    let n: usize = 10_000_000;

    let t0 = clock_ms();
    let count = sieve(n);
    let elapsed_sieve = clock_ms() - t0;
    println!("Primes up to {}: {} ({} ms)", n, count, elapsed_sieve);

    let t1 = clock_ms();
    let fib_n = fib_count();
    let elapsed_fib = clock_ms() - t1;
    println!("Fibonacci numbers under u64: {} ({} ms)", fib_n, elapsed_fib);
}
