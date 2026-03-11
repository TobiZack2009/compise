/**
 * @fileoverview WASI-backed std/fs tests.
 */

import { strict as assert } from 'assert';
import { mkdtempSync, readFileSync, openSync, closeSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WASI } from 'node:wasi';
import { compileSource } from '../src/compiler.js';

describe('std/fs with WASI', () => {
  it('FS.write/read/append/exists/delete', async () => {
    const source = `
      import { FS } from "std/fs";
      import { console } from "std/io";
      const path = "file.txt";
      FS.write(path, "hi");
      FS.append(path, " there");
      const content = FS.read(path);
      console.log(content);
      if (FS.exists(path)) { FS.delete(path); }
    `;
    const { wasm } = await compileSource(source, 'fs.js');
    const dir = mkdtempSync(join(tmpdir(), 'jswat-fs-'));
    const stdoutPath = join(dir, 'stdout.txt');
    const stdoutFd = openSync(stdoutPath, 'w+');
    const wasi = new WASI({ version: 'preview1', stdout: stdoutFd, preopens: { '/': dir } });
    const { instance } = await WebAssembly.instantiate(wasm, wasi.getImportObject());
    wasi.start(instance);
    closeSync(stdoutFd);
    const out = readFileSync(stdoutPath, 'utf8');
    assert.ok(out.includes('hi there'), `expected output, got: ${out}`);
    assert.ok(!existsSync(join(dir, 'file.txt')), 'expected file to be deleted');
  });
});
