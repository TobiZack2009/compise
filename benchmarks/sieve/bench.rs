use std::time::Instant;
fn sieve(n: usize) -> usize {
    let mut is_prime = vec![true; n + 1];
    is_prime[0] = false; is_prime[1] = false;
    let mut i = 2;
    while i * i <= n { if is_prime[i] { let mut j = i*i; while j <= n { is_prime[j] = false; j += i; } } i += 1; }
    is_prime.iter().filter(|&&x| x).count()
}
fn main() {
    let n = 10_000_000usize;
    let t = Instant::now();
    let c = sieve(n);
    println!("Primes up to {}: {} ({}ms)", n, c, t.elapsed().as_millis());
}
