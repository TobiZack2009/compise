import time
N = 100_000
LCG_A, LCG_C = 1664525, 1013904223
def partition(arr, lo, hi):
    pivot = arr[hi]; i = lo
    for j in range(lo, hi):
        if arr[j] <= pivot: arr[i], arr[j] = arr[j], arr[i]; i += 1
    arr[i], arr[hi] = arr[hi], arr[i]; return i
def quicksort(arr, n):
    stack = [(0, n-1)]
    while stack:
        lo, hi = stack.pop()
        if lo >= hi: continue
        p = partition(arr, lo, hi)
        if p-1 > lo: stack.append((lo, p-1))
        if p+1 < hi: stack.append((p+1, hi))
rng = 12345
arr = []
for _ in range(N):
    rng = (LCG_A * rng + LCG_C) & 0x7fffffff; arr.append(rng)
t = time.perf_counter()
quicksort(arr, N)
inv = sum(1 for i in range(N-1) if arr[i] > arr[i+1])
print(f"Quicksort {N} ints: {(time.perf_counter()-t)*1000:.1f}ms, inversions={inv} (expect 0)")
