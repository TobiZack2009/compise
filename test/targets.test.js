/**
 * @fileoverview Tests for wasm32-ld and wasm32-component targets.
 *
 * wasm32-ld: produces a relocatable-style WASM binary with __wasm_call_ctors
 *            instead of _start (LLVM linker convention).
 *
 * wasm32-component: produces a core WASM binary + WIT interface file.
 *                   Full component wrapping requires wasm-tools (external).
 */

import { strict as assert } from 'assert';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { compileSource } from '../src/compiler.js';

const ROOT     = new URL('..', import.meta.url).pathname;
const STD_ROOT = join(ROOT, 'std');
const readFileFn = p => readFileSync(p, 'utf8');

async function compile(src, target) {
  return compileSource(src, '<test>', { readFile: readFileFn, stdRoot: STD_ROOT, target });
}

// ── Simple programs used across tests ─────────────────────────────────────────

const SIMPLE = `
//@export
function add(a = 0, b = 0) {
  return a + b;
}
`;

const WITH_TOP_LEVEL = `
let x = 1;
//@export
function getX() { return x; }
`;

// ── wasm32-ld ─────────────────────────────────────────────────────────────────

describe('wasm32-ld target', () => {
  it('compiles without error', async () => {
    const result = await compile(SIMPLE, 'wasm32-ld');
    assert.ok(result.binary instanceof Uint8Array, 'should produce binary');
    assert.ok(result.binary.length > 0, 'binary should be non-empty');
  });

  it('WAT contains __wasm_call_ctors for top-level init', async () => {
    const result = await compile(WITH_TOP_LEVEL, 'wasm32-ld');
    assert.ok(result.wat.includes('__wasm_call_ctors'), 'should have __wasm_call_ctors');
    assert.ok(!result.wat.includes('"_start"'), 'should NOT export _start');
    assert.ok(!result.wat.includes('"__jswat_init"'), 'should NOT export __jswat_init');
  });

  it('no top-level code → no __wasm_call_ctors, no _start', async () => {
    const result = await compile(SIMPLE, 'wasm32-ld');
    assert.ok(!result.wat.includes('"_start"'), 'should NOT export _start');
    assert.ok(!result.wat.includes('"__jswat_init"'), 'should NOT export __jswat_init');
    assert.ok(!result.wat.includes('"__wasm_call_ctors"'), 'should NOT have __wasm_call_ctors when no top-level code');
  });

  it('keeps WASI imports for I/O functions', async () => {
    const withIo = `
      import { console } from 'std/io';
      //@export
      function greet() { console.log('hi'); }
    `;
    const result = await compile(withIo, 'wasm32-ld');
    assert.ok(result.wat.includes('wasi_snapshot_preview1'), 'should have WASI imports for I/O');
  });

  it('exports @export-annotated functions', async () => {
    const result = await compile(SIMPLE, 'wasm32-ld');
    assert.ok(result.wat.includes('"add"'), 'should export the add function');
  });

  it('binary is a valid WASM module (magic bytes + version 1)', async () => {
    const result = await compile(SIMPLE, 'wasm32-ld');
    assert.equal(result.binary[0], 0x00);
    assert.equal(result.binary[1], 0x61);
    assert.equal(result.binary[2], 0x73);
    assert.equal(result.binary[3], 0x6d);
    assert.equal(result.binary[4], 0x01);
    assert.equal(result.binary[5], 0x00);
  });
});

// ── wasm32-component ──────────────────────────────────────────────────────────

describe('wasm32-component target', () => {
  it('compiles without error', async () => {
    const result = await compile(SIMPLE, 'wasm32-component');
    assert.ok(result.binary instanceof Uint8Array, 'should produce binary');
    assert.ok(result.binary.length > 0, 'binary should be non-empty');
  });

  it('produces a WIT interface string', async () => {
    const result = await compile(SIMPLE, 'wasm32-component');
    assert.ok(typeof result.wit === 'string', 'should produce WIT string');
    assert.ok(result.wit.includes('world'), 'WIT should contain a world declaration');
    assert.ok(result.wit.includes('package'), 'WIT should contain a package declaration');
    assert.ok(result.wit.includes('export add'), 'WIT should export the add function');
  });

  it('WIT maps i32 params and return to s32', async () => {
    const result = await compile(SIMPLE, 'wasm32-component');
    assert.ok(result.wit.includes('s32'), 'i32 params should map to s32 in WIT');
    assert.ok(result.wit.includes('-> s32'), 'i32 return should map to s32 in WIT');
  });

  it('WIT maps str type to string', async () => {
    const withStr = `
      //@export
      function hello(name = '') {
        return name;
      }
    `;
    const result = await compile(withStr, 'wasm32-component');
    assert.ok(result.wit.includes('string'), 'str should map to string in WIT');
  });

  it('WIT maps f64 to f64', async () => {
    const withFloat = `
      //@export
      function scale(x = 0.0, factor = 0.0) {
        return x * factor;
      }
    `;
    const result = await compile(withFloat, 'wasm32-component');
    assert.ok(result.wit.includes('f64'), 'f64 should appear in WIT');
  });

  it('WIT maps bool return to bool', async () => {
    const withBool = `
      //@export
      function isPositive(x = 0) {
        return x > 0;
      }
    `;
    const result = await compile(withBool, 'wasm32-component');
    assert.ok(result.wit.includes('bool'), 'bool return should appear in WIT');
  });

  it('void function has no return in WIT', async () => {
    const withVoid = `
      //@export
      function noop() { }
    `;
    const result = await compile(withVoid, 'wasm32-component');
    assert.ok(result.wit.includes('func()'), 'void function should have no return type in WIT');
    assert.ok(!result.wit.includes('-> ;'), 'void should not emit arrow syntax');
  });

  it('uses _initialize instead of _start for top-level init', async () => {
    const result = await compile(WITH_TOP_LEVEL, 'wasm32-component');
    assert.ok(result.wat.includes('_initialize'), 'component uses _initialize');
    assert.ok(!result.wat.includes('"_start"'), 'component should NOT export _start');
  });

  it('binary is a valid core WASM module (magic + version 1)', async () => {
    const result = await compile(SIMPLE, 'wasm32-component');
    assert.equal(result.binary[0], 0x00);
    assert.equal(result.binary[1], 0x61);
    assert.equal(result.binary[2], 0x73);
    assert.equal(result.binary[3], 0x6d);
    assert.equal(result.binary[4], 0x01);
  });

  it('multiple exports all appear in WIT', async () => {
    const multi = `
      //@export
      function add(a = 0, b = 0) { return a + b; }
      //@export
      function mul(a = 0, b = 0) { return a * b; }
      //@export
      function neg(x = 0) { return -x; }
    `;
    const result = await compile(multi, 'wasm32-component');
    assert.ok(result.wit.includes('export add'), 'WIT should have add');
    assert.ok(result.wit.includes('export mul'), 'WIT should have mul');
    assert.ok(result.wit.includes('export neg'), 'WIT should have neg');
  });

  it('wit is null for non-component targets', async () => {
    const result = await compile(SIMPLE, 'wasm32-wasip1');
    assert.equal(result.wit, null, 'non-component targets should have null WIT');
  });
});
