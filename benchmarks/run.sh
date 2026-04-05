#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."

BENCHMARKS=(sieve fibonacci matrix mandelbrot quicksort monte-carlo list-dot)

run_benchmark() {
  local name="$1"
  local dir="$SCRIPT_DIR/$name"

  echo ""
  echo "════════════════════════════════════════════════════════════"
  echo "  $name"
  echo "════════════════════════════════════════════════════════════"

  # ── Rust (native) ──────────────────────────────────────────────
  local native="$dir/bench-native"
  if [ ! -f "$native" ]; then
    echo "[build] Rust native ($name)..."
    rustc -O "$dir/bench.rs" -o "$native"
  fi
  echo "── Rust (native) ──"
  "$native"

  # ── Node.js ────────────────────────────────────────────────────
  if [ -f "$dir/bench.js" ]; then
    echo "── Node.js ──"
    node "$dir/bench.js"
  fi

  # ── Python 3 ───────────────────────────────────────────────────
  if [ -f "$dir/bench.py" ]; then
    echo "── Python 3 ──"
    python3 "$dir/bench.py"
  fi

  # ── js.wat (wasm32-wasip1 / wasmtime) ─────────────────────────
  local wasm="$dir/bench.wasm"
  if [ -f "$dir/bench.jswat.js" ]; then
    if [ ! -f "$wasm" ]; then
      echo "[build] js.wat ($name)..."
      node "$ROOT/src/cli.js" compile "$dir/bench.jswat.js" \
        -o "$wasm" --target wasm32-wasip1
    fi
    echo "── js.wat (wasm32-wasip1 / wasmtime) ──"
    wasmtime "$wasm"
  fi
}

echo "════════════════════════════════════════════════════════════"
echo "  js.wat benchmark suite"
echo "════════════════════════════════════════════════════════════"

for bench in "${BENCHMARKS[@]}"; do
  run_benchmark "$bench"
done

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  Done."
echo "════════════════════════════════════════════════════════════"
