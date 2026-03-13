/**
 * @fileoverview std/fs tests — runs programs through jswat-run + wasmtime.
 * Skips the entire suite when wasmtime is not installed.
 */

import { strict as assert } from 'assert';
import { execFileSync, execSync } from 'child_process';
import { writeFileSync, unlinkSync, mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const JSWAT_RUN = join(ROOT, 'jswat-run');

function wasmtimeAvailable() {
  try { execSync('wasmtime --version', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

/**
 * Run source with jswat-run, optionally passing extra wasmtime flags.
 * @param {string} source
 * @param {string[]} [wasmtimeFlags]
 */
function run(source, wasmtimeFlags = []) {
  const tmp = join(tmpdir(), `jswat-test-${process.pid}-${Date.now()}.js`);
  writeFileSync(tmp, source, 'utf8');
  try {
    return execFileSync(JSWAT_RUN, [tmp, ...wasmtimeFlags], {
      encoding: 'utf8',
      timeout: 10000,
    });
  } finally {
    unlinkSync(tmp);
  }
}

describe('std/fs with WASI', function() {
  before(function() {
    if (!wasmtimeAvailable()) this.skip();
  });

  it('FS.write/read/append/exists/delete', function() {
    const dir = mkdtempSync(join(tmpdir(), 'jswat-fs-'));
    const source = `
      import { FS } from "std/fs";
      import { console } from "std/io";
      const path = "file.txt";
      FS.write(path, "hi");
      FS.append(path, " there");
      const content = FS.read(path);
      console.log(content);
      if (FS.exists(path)) { FS.delete(path); console.log("deleted"); }
    `;
    const out = run(source, ['--dir', `${dir}::/`]);
    assert.ok(out.includes('hi there'), `expected 'hi there', got: ${out}`);
    assert.ok(out.includes('deleted'), `expected 'deleted', got: ${out}`);
    assert.ok(!existsSync(join(dir, 'file.txt')), 'expected file to be deleted');
  });
});
