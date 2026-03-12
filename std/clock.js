import { i64_load } from "std/wasm";
import { alloc } from "std/mem";

const CLOCK_REALTIME = u32(0);
const CLOCK_MONOTONIC = u32(1);

//@external("wasi_snapshot_preview1", "clock_time_get")
function __clock_time_get(clockId = u32(0), precision = i64(0), time = usize(0)) { return i32(0); }

//@external("wasi_snapshot_preview1", "sched_yield")
function __sched_yield() { return i32(0); }

export class Clock {
  static now() {
    const buf = alloc.bytes(usize(8), u8(0));
    __clock_time_get(CLOCK_REALTIME, i64(1000000), usize(buf));
    const ns = i64_load(usize(buf), usize(0));
    return isize(ns / i64(1000000));
  }

  static monotonic() {
    const buf = alloc.bytes(usize(8), u8(0));
    __clock_time_get(CLOCK_MONOTONIC, i64(1), usize(buf));
    return isize(i64_load(usize(buf), usize(0)));
  }

  static sleep(ms = 0) {
    const end = Clock.monotonic() + isize(ms) * 1000000;
    while (Clock.monotonic() < end) __sched_yield();
  }
}
