/**
 * @fileoverview WASI-backed std/io tests.
 */

import { strict as assert } from 'assert';
import { mkdtempSync, readFileSync, openSync, closeSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WASI } from 'node:wasi';
import { compileSource } from '../src/compiler.js';

describe('std/io with WASI', () => {
  it('console.log writes to stdout', async () => {
    const source = 'import { console } from \"std/io\"; console.log(\"Hello from js.wat!\");';
    const { wasm } = await compileSource(source, 'hello.js');
    const dir = mkdtempSync(join(tmpdir(), 'jswat-'));
    const stdoutPath = join(dir, 'stdout.txt');
    const stderrPath = join(dir, 'stderr.txt');
    const stdoutFd = openSync(stdoutPath, 'w+');
    const stderrFd = openSync(stderrPath, 'w+');
    const wasi = new WASI({ version: 'preview1', stdout: stdoutFd, stderr: stderrFd });
    const { instance } = await WebAssembly.instantiate(wasm, wasi.getImportObject());
    wasi.start(instance);
    closeSync(stdoutFd);
    closeSync(stderrFd);
    const out = readFileSync(stdoutPath, 'utf8');
    assert.ok(out.includes('Hello from js.wat!'), `expected output, got: ${out}`);
  });

  it('stdin.readAll echoes input', async () => {
    const source = 'import { console, stdin } from \"std/io\"; const s = stdin.readAll(); console.log(s);';
    const { wasm } = await compileSource(source, 'stdin.js');
    const dir = mkdtempSync(join(tmpdir(), 'jswat-'));
    const stdinPath = join(dir, 'stdin.txt');
    const stdoutPath = join(dir, 'stdout.txt');
    const stderrPath = join(dir, 'stderr.txt');
    const input = 'Echo test';
    const stdinFd = openSync(stdinPath, 'w+');
    const stdoutFd = openSync(stdoutPath, 'w+');
    const stderrFd = openSync(stderrPath, 'w+');
    writeFileSync(stdinPath, input, 'utf8');
    const wasi = new WASI({ version: 'preview1', stdin: stdinFd, stdout: stdoutFd, stderr: stderrFd });
    const { instance } = await WebAssembly.instantiate(wasm, wasi.getImportObject());
    wasi.start(instance);
    closeSync(stdinFd);
    closeSync(stdoutFd);
    closeSync(stderrFd);
    const out = readFileSync(stdoutPath, 'utf8');
    assert.ok(out.includes(input), `expected output, got: ${out}`);
  });
});
