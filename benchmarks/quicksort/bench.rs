use std::time::Instant;
fn partition(arr: &mut Vec<i32>, lo: usize, hi: usize) -> usize {
    let pivot = arr[hi];
    let mut i = lo;
    for j in lo..hi {
        if arr[j] <= pivot {
            arr.swap(i, j);
            i += 1;
        }
    }
    arr.swap(i, hi);
    i
}
fn quicksort(arr: &mut Vec<i32>, n: usize) {
    let mut stack: Vec<(usize, usize)> = Vec::new();
    stack.push((0, n - 1));
    while let Some((lo, hi)) = stack.pop() {
        if lo < hi {
            let p = partition(arr, lo, hi);
            if p > 0 && p - 1 > lo { stack.push((lo, p - 1)); }
            if p + 1 < hi { stack.push((p + 1, hi)); }
        }
    }
}
fn main() {
    let n = 100_000usize;
    let mut arr: Vec<i32> = Vec::with_capacity(n);
    let mut rng: u32 = 12345;
    for _ in 0..n {
        rng = rng.wrapping_mul(1664525).wrapping_add(1013904223) & 0x7fffffff;
        arr.push(rng as i32);
    }
    let t = Instant::now();
    quicksort(&mut arr, n);
    let elapsed = t.elapsed().as_millis();
    let inv = arr.windows(2).filter(|w| w[0] > w[1]).count();
    println!("Quicksort {} ints: {}ms, inversions={} (expect 0)", n, elapsed, inv);
}
