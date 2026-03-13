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
});
