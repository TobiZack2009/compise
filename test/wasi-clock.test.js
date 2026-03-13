/**
 * @fileoverview std/clock tests — runs programs through jswat-run + wasmtime.
 * Skips the entire suite when wasmtime is not installed.
 */

import { strict as assert } from 'assert';
import { execFileSync, execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const JSWAT_RUN = join(ROOT, 'jswat-run');

function wasmtimeAvailable() {
  try { execSync('wasmtime --version', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function run(source) {
  const tmp = join(tmpdir(), `jswat-test-${process.pid}-${Date.now()}.js`);
  writeFileSync(tmp, source, 'utf8');
  try {
    return execFileSync(JSWAT_RUN, [tmp], { encoding: 'utf8', timeout: 10000 });
  } finally {
    unlinkSync(tmp);
  }
}

describe('std/clock with WASI', function() {
  before(function() {
    if (!wasmtimeAvailable()) this.skip();
  });

  it('Clock.now returns a non-zero timestamp', function() {
    // Clock.now() returns i32-wrapped milliseconds — the value may be negative due
    // to wrapping, but it must be non-zero (the probability of landing on 0 is negligible).
    const source = `
      import { Clock } from "std/clock";
      import { console } from "std/io";
      const t = Clock.now();
      if (t !== 0) { console.log("ok"); } else { console.log("zero"); }
    `;
    const out = run(source);
    assert.ok(out.includes('ok'), `expected 'ok', got: ${out}`);
  });

  it('Clock.monotonic returns a non-zero value', function() {
    const source = `
      import { Clock } from "std/clock";
      import { console } from "std/io";
      const t = Clock.monotonic();
      if (t !== 0) { console.log("ok"); } else { console.log("zero"); }
    `;
    const out = run(source);
    assert.ok(out.includes('ok'), `expected 'ok', got: ${out}`);
  });
});
