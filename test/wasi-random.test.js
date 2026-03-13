/**
 * @fileoverview std/random tests — runs programs through jswat-run + wasmtime.
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

describe('std/random with WASI', function() {
  before(function() {
    if (!wasmtimeAvailable()) this.skip();
  });

  it('Random.float returns value in [0,1)', function() {
    // The program logs "ok" if the value is in [0,1), "fail:<n>" otherwise.
    // We use integer comparison since f64 console output isn't yet implemented.
    const source = `
      import Random from "std/random";
      import { console } from "std/io";
      const v = Random.float();
      if (v >= 0.0) { console.log("ok-lower"); }
      if (v < 1.0)  { console.log("ok-upper"); }
    `;
    const out = run(source);
    assert.ok(out.includes('ok-lower'), `expected value >= 0, got: ${out}`);
    assert.ok(out.includes('ok-upper'), `expected value < 1, got: ${out}`);
  });
});
