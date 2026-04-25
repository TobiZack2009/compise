/**
 * @fileoverview std/io tests — runs programs through jswat-run + wasmtime.
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

/**
 * Write source to a temp file, run through jswat-run, return stdout.
 * @param {string} source
 * @param {{ input?: string }} [opts]
 */
function run(source, opts = {}) {
  const tmp = join(tmpdir(), `jswat-test-${process.pid}-${Date.now()}.js`);
  writeFileSync(tmp, source, 'utf8');
  try {
    return execFileSync(JSWAT_RUN, [tmp], {
      encoding: 'utf8',
      timeout: 10000,
      ...(opts.input !== undefined ? { input: opts.input } : {}),
    });
  } finally {
    unlinkSync(tmp);
  }
}

describe('std/io with WASI', function() {
  before(function() {
    if (!wasmtimeAvailable()) this.skip();
  });

  it('console.log writes to stdout', function() {
    const out = run('import { console } from "std/io"; console.log("Hello from js.wat!");');
    assert.ok(out.includes('Hello from js.wat!'), `expected output, got: ${out}`);
  });

  it('stdin.readAll echoes input', function() {
    const source = 'import { console, stdin } from "std/io"; const s = stdin.readAll(); console.log(s);';
    const out = run(source, { input: 'Echo test' });
    assert.ok(out.includes('Echo test'), `expected echo, got: ${out}`);
  });

  it('console.log(i32) prints signed integer', function() {
    const out = run('import { console } from "std/io"; console.log(-42);');
    assert.ok(out.trim() === '-42', `expected -42, got: ${out.trim()}`);
  });

  it('console.log(u32) prints unsigned integer', function() {
    const out = run('import { console } from "std/io"; console.log(u32(4294967295));');
    assert.ok(out.trim() === '4294967295', `expected 4294967295, got: ${out.trim()}`);
  });

  it('console.log(i64) prints 64-bit integer', function() {
    const out = run('import { console } from "std/io"; console.log(i64(9007199254740993));');
    assert.ok(out.trim() === '9007199254740993', `expected 9007199254740993, got: ${out.trim()}`);
  });

  it('console.log(f64) prints float', function() {
    const out = run('import { console } from "std/io"; console.log(3.14);');
    assert.ok(out.trim() === '3.14', `expected 3.14, got: ${out.trim()}`);
  });

  it('console.log(f64) trims trailing zeros', function() {
    const out = run('import { console } from "std/io"; console.log(1.5);');
    assert.ok(out.trim() === '1.5', `expected 1.5, got: ${out.trim()}`);
  });

  it('console.log(f64) prints integer-valued floats without decimal', function() {
    const out = run('import { console } from "std/io"; console.log(f64(42));');
    assert.ok(out.trim() === '42', `expected 42, got: ${out.trim()}`);
  });

  it('console.log(bool) prints true/false', function() {
    const out1 = run('import { console } from "std/io"; console.log(true);');
    const out2 = run('import { console } from "std/io"; console.log(false);');
    assert.ok(out1.trim() === 'true', `expected true, got: ${out1.trim()}`);
    assert.ok(out2.trim() === 'false', `expected false, got: ${out2.trim()}`);
  });
});
