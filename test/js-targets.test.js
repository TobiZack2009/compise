/**
 * @fileoverview wasm32-js-* target tests.
 *
 * Compiles js.wat programs to ESM, CJS, and bundle formats, runs the resulting
 * JS with Node.js, and verifies the output.  Tests cover:
 *  - @export functions with i32 and str params/return values
 *  - stdin/stdout IO via the bridge env hooks
 *  - FS read/exists via the bridge env hooks
 *
 * The generated JS bridge source is validated by parsing it with node --check.
 */

import { strict as assert } from 'assert';
import { execFileSync, execSync } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { compileSource } from '../src/compiler.js';
import { generateBridge } from '../src/codegen/js-bridge.js';

const ROOT    = new URL('..', import.meta.url).pathname;
const STD_ROOT = join(ROOT, 'std');
const { readFileSync: _rf } = await import('fs');
const readFileFn = p => _rf(p, 'utf8');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compile a js.wat source to a given JS target and return { bridge, wasm, exportList }.
 * @param {string} source
 * @param {string} target  'wasm32-js-esm'|'wasm32-js-cjs'|'wasm32-js-bundle'
 */
async function compileToJs(source, target) {
  const result = await compileSource(source, '<test>', {
    readFile: readFileFn,
    stdRoot: STD_ROOT,
    target,
  });
  assert.ok(result.wasm, 'expected WASM binary');
  return {
    wasm: result.wasm,
    exportList: result.exportList ?? [],
    warnings: result.warnings,
  };
}

/**
 * Write a bridge file (ESM or bundle) to a temp .mjs file, optionally
 * alongside a .wasm sidecar, and return the path.
 */
function writeTempBridge(bridge, wasm, isBundle) {
  const dir = join(tmpdir(), `jswat-jstest-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const jsPath = join(dir, 'bridge.mjs');
  writeFileSync(jsPath, bridge, 'utf8');
  if (!isBundle && wasm) {
    writeFileSync(join(dir, 'module.wasm'), wasm);
  }
  return { dir, jsPath };
}

/**
 * Validate that a JS string is syntactically valid by running node --check.
 * @param {string} js
 * @param {string} [ext='.mjs']
 */
function validateJs(js, ext = '.mjs') {
  const tmp = join(tmpdir(), `jswat-jscheck-${process.pid}-${Date.now()}${ext}`);
  writeFileSync(tmp, js, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

/**
 * Run a JS bridge file using Node.js and return stdout.
 * @param {string} jsPath   Path to the .mjs bridge file
 * @param {string} [input]  Optional stdin input
 */
function runBridge(jsPath, input) {
  return execFileSync(process.execPath, [jsPath], {
    encoding: 'utf8',
    timeout: 10000,
    ...(input !== undefined ? { input } : {}),
  });
}

/**
 * Run a small Node.js inline script that imports the bridge and calls an export.
 * @param {string} bridgePath  Path to the .mjs bridge
 * @param {string} callCode    JS code to run after `const { ... } = await import(bridgePath)`
 * @param {string[]} importNames  Names to destructure from the bridge
 */
function callExport(bridgePath, importNames, callCode) {
  const script = `
import { ${importNames.join(', ')} } from ${JSON.stringify(bridgePath)};
${callCode}
`.trim();
  const tmp = join(tmpdir(), `jswat-runner-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(tmp, script, 'utf8');
  try {
    return execFileSync(process.execPath, [tmp], { encoding: 'utf8', timeout: 10000 });
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const ADD_SRC = readFileSync(join(ROOT, 'test/programs/add.js'), 'utf8');
const GREET_SRC = readFileSync(join(ROOT, 'test/programs/greet.js'), 'utf8');
const CAT_STDIN_SRC = readFileSync(join(ROOT, 'test/programs/cat-stdin.js'), 'utf8');
const CAT_FILE_SRC = readFileSync(join(ROOT, 'test/programs/cat-file.js'), 'utf8');

describe('wasm32-js-* targets', function() {
  this.timeout(30000);

  // ── ESM target ─────────────────────────────────────────────────────────────

  describe('wasm32-js-esm', function() {
    it('compiles add.js and bridge JS is valid', async function() {
      const { wasm, exportList } = await compileToJs(ADD_SRC, 'wasm32-js-esm');
      const bridge = generateBridge(wasm, exportList, {
        target: 'wasm32-js-esm', wasmFilename: 'module.wasm' });
      assert.ok(bridge.length > 0, 'bridge should be non-empty');
      validateJs(bridge, '.mjs');
    });

    it('add export returns correct result', async function() {
      const { wasm, exportList } = await compileToJs(ADD_SRC, 'wasm32-js-esm');
      const bridge = generateBridge(wasm, exportList, {
        target: 'wasm32-js-esm', wasmFilename: 'module.wasm' });
      const { dir, jsPath } = writeTempBridge(bridge, wasm, false);
      try {
        const out = callExport(jsPath, ['add', 'multiply'],
          `console.log(add(3, 4)); console.log(multiply(5, 6));`);
        const lines = out.trim().split('\n');
        assert.equal(lines[0].trim(), '7');
        assert.equal(lines[1].trim(), '30');
      } finally { cleanup(dir); }
    });

    it('greet export marshals str params and return', async function() {
      const { wasm, exportList } = await compileToJs(GREET_SRC, 'wasm32-js-esm');
      const bridge = generateBridge(wasm, exportList, {
        target: 'wasm32-js-esm', wasmFilename: 'module.wasm' });
      validateJs(bridge, '.mjs');
      const { dir, jsPath } = writeTempBridge(bridge, wasm, false);
      try {
        const out = callExport(jsPath, ['greet'],
          `const result = greet('World'); console.log(result);`);
        assert.ok(out.includes('Hello, World!'), `expected greeting, got: ${out}`);
      } finally { cleanup(dir); }
    });

    it('strLen export returns string byte length', async function() {
      const { wasm, exportList } = await compileToJs(GREET_SRC, 'wasm32-js-esm');
      const bridge = generateBridge(wasm, exportList, {
        target: 'wasm32-js-esm', wasmFilename: 'module.wasm' });
      const { dir, jsPath } = writeTempBridge(bridge, wasm, false);
      try {
        const out = callExport(jsPath, ['strLen'],
          `console.log(strLen('hello'));`);
        assert.equal(out.trim(), '5');
      } finally { cleanup(dir); }
    });

    it('cat-stdin reads stdin and writes to stdout', async function() {
      const { wasm, exportList } = await compileToJs(CAT_STDIN_SRC, 'wasm32-js-esm');
      const bridge = generateBridge(wasm, exportList, {
        target: 'wasm32-js-esm', wasmFilename: 'module.wasm' });
      validateJs(bridge, '.mjs');
      const { dir, jsPath } = writeTempBridge(bridge, wasm, false);
      try {
        const out = runBridge(jsPath, 'hello world');
        assert.ok(out.includes('hello world'), `expected echo, got: ${out}`);
      } finally { cleanup(dir); }
    });

    it('cat-file reads a file via FS bridge', async function() {
      const { wasm, exportList } = await compileToJs(CAT_FILE_SRC, 'wasm32-js-esm');
      const bridge = generateBridge(wasm, exportList, {
        target: 'wasm32-js-esm', wasmFilename: 'module.wasm' });
      validateJs(bridge, '.mjs');
      const { dir, jsPath } = writeTempBridge(bridge, wasm, false);
      // Write a test file to read
      const testFilePath = join(dir, 'test.txt');
      writeFileSync(testFilePath, 'file content here', 'utf8');
      try {
        const out = callExport(jsPath, ['readFile', 'fileExists'],
          `const exists = fileExists(${JSON.stringify(testFilePath)});
           console.log('exists:', exists);
           const content = readFile(${JSON.stringify(testFilePath)});
           console.log(content);`);
        assert.ok(out.includes('exists: 1'), `expected fileExists=1, got: ${out}`);
        assert.ok(out.includes('file content here'), `expected file content, got: ${out}`);
      } finally { cleanup(dir); }
    });
  });

  // ── Bundle target ──────────────────────────────────────────────────────────

  describe('wasm32-js-bundle', function() {
    it('compiles add.js to bundle and bridge JS is valid', async function() {
      const { wasm, exportList } = await compileToJs(ADD_SRC, 'wasm32-js-bundle');
      const bridge = generateBridge(wasm, exportList, { target: 'wasm32-js-bundle' });
      assert.ok(bridge.includes('atob('), 'bundle should inline base64 WASM');
      validateJs(bridge, '.mjs');
    });

    it('bundle add export works without sidecar', async function() {
      const { wasm, exportList } = await compileToJs(ADD_SRC, 'wasm32-js-bundle');
      const bridge = generateBridge(wasm, exportList, { target: 'wasm32-js-bundle' });
      const { dir, jsPath } = writeTempBridge(bridge, null, true);
      try {
        const out = callExport(jsPath, ['add'], `console.log(add(10, 20));`);
        assert.equal(out.trim(), '30');
      } finally { cleanup(dir); }
    });

    it('bundle greet export works', async function() {
      const { wasm, exportList } = await compileToJs(GREET_SRC, 'wasm32-js-bundle');
      const bridge = generateBridge(wasm, exportList, { target: 'wasm32-js-bundle' });
      const { dir, jsPath } = writeTempBridge(bridge, null, true);
      try {
        const out = callExport(jsPath, ['greet'], `console.log(greet('Bundle'));`);
        assert.ok(out.includes('Hello, Bundle!'), `expected greeting, got: ${out}`);
      } finally { cleanup(dir); }
    });
  });

  // ── CJS target ─────────────────────────────────────────────────────────────

  describe('wasm32-js-cjs', function() {
    it('compiles add.js to CJS and bridge JS is valid', async function() {
      const { wasm, exportList } = await compileToJs(ADD_SRC, 'wasm32-js-cjs');
      const bridge = generateBridge(wasm, exportList, {
        target: 'wasm32-js-cjs', wasmFilename: 'module.wasm' });
      assert.ok(bridge.includes("'use strict'"), 'CJS should have use strict');
      assert.ok(bridge.includes('module.exports'), 'CJS should use module.exports');
      validateJs(bridge, '.cjs');
    });

    it('CJS add export works', async function() {
      const { wasm, exportList } = await compileToJs(ADD_SRC, 'wasm32-js-cjs');
      const bridge = generateBridge(wasm, exportList, {
        target: 'wasm32-js-cjs', wasmFilename: 'module.wasm' });
      const dir = join(tmpdir(), `jswat-cjstest-${process.pid}-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      const jsPath = join(dir, 'bridge.cjs');
      writeFileSync(jsPath, bridge, 'utf8');
      writeFileSync(join(dir, 'module.wasm'), wasm);
      const runnerPath = join(dir, 'run.cjs');
      writeFileSync(runnerPath, `
const m = require(${JSON.stringify(jsPath)});
m.then(({ add }) => {
  console.log(add(7, 8));
}).catch(e => { console.error(e); process.exit(1); });
`);
      try {
        const out = execFileSync(process.execPath, [runnerPath],
          { encoding: 'utf8', timeout: 10000 });
        assert.equal(out.trim(), '15');
      } finally { cleanup(dir); }
    });
  });
});
