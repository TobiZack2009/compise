#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."

echo "============================================================"
echo " js.wat benchmark suite — Sieve of Eratosthenes (N=10M)"
echo "                           Fibonacci under u64"
echo "============================================================"
echo ""

# ── Rust native ──────────────────────────────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/bench-native" ]; then
  echo "[build] Rust native..."
  rustc -O "$SCRIPT_DIR/bench.rs" -o "$SCRIPT_DIR/bench-native"
fi
echo "── Rust (native) ──────────────────────────────────────────"
"$SCRIPT_DIR/bench-native"
echo ""

# ── Rust wasip1 ──────────────────────────────────────────────────────────────
WASM_RUST="$SCRIPT_DIR/bench-wasi/target/wasm32-wasip1/release/bench-wasi.wasm"
if [ ! -f "$WASM_RUST" ]; then
  echo "[build] Rust wasip1..."
  (cd "$SCRIPT_DIR/bench-wasi" && cargo build --target wasm32-wasip1 --release)
fi
echo "── Rust (wasm32-wasip1 / wasmtime) ────────────────────────"
wasmtime "$WASM_RUST"
echo ""

# ── Python 3 ─────────────────────────────────────────────────────────────────
echo "── Python 3 ───────────────────────────────────────────────"
python3 "$SCRIPT_DIR/bench.py"
echo ""

# ── Node.js ──────────────────────────────────────────────────────────────────
echo "── Node.js ────────────────────────────────────────────────"
node "$SCRIPT_DIR/bench.js"
echo ""

# ── js.wat (wasip1 / wasmtime) ───────────────────────────────────────────────
WASM_JSWAT="$SCRIPT_DIR/bench-jswat.wasm"
if [ ! -f "$WASM_JSWAT" ]; then
  echo "[build] js.wat..."
  node "$ROOT/src/cli.js" compile "$SCRIPT_DIR/bench.jswat.js" \
    -o "$WASM_JSWAT" --target wasm32-wasip1
fi
echo "── js.wat (wasm32-wasip1 / wasmtime) ──────────────────────"
wasmtime "$WASM_JSWAT"
echo ""

echo "============================================================"
echo " Done."
echo "============================================================"
