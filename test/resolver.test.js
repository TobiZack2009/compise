/**
 * @fileoverview Tests for src/resolver.js — ModuleResolver unit tests.
 * Tests CE-M01 (not found), CE-M02 (cycle), CE-M03 (bare specifier),
 * std/* resolution, and relative path resolution.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { ModuleResolver, ResolveError } from '../src/resolver.js';
import { parseSource } from '../src/parser.js';

const STD_ROOT = '/std';

/**
 * Build a resolver backed by an in-memory file map.
 * @param {Record<string, string>} files  absolute-path → source
 * @returns {ModuleResolver}
 */
function makeResolver(files = {}) {
  const readFile = (p) => {
    if (Object.prototype.hasOwnProperty.call(files, p)) return files[p];
    const err = new Error(`ENOENT: no such file or directory, open '${p}'`);
    /** @type {any} */ (err).code = 'ENOENT';
    throw err;
  };
  return new ModuleResolver(STD_ROOT, readFile, parseSource);
}

describe('ModuleResolver — resolveSpecifier', () => {

  it('resolves std/ specifier to stdRoot path', () => {
    const r = makeResolver();
    assert.equal(r.resolveSpecifier('std/math', '/entry.js'), '/std/math.js');
    assert.equal(r.resolveSpecifier('std/alloc/pool', '/entry.js'), '/std/alloc/pool.js');
  });

  it('resolves std/ specifier with trailing .js unchanged', () => {
    const r = makeResolver();
    assert.equal(r.resolveSpecifier('std/math.js', '/entry.js'), '/std/math.js');
  });

  it('resolves relative ./ specifier', () => {
    const r = makeResolver();
    assert.equal(r.resolveSpecifier('./utils', '/project/main.js'), '/project/utils.js');
    assert.equal(r.resolveSpecifier('./utils.js', '/project/main.js'), '/project/utils.js');
  });

  it('resolves relative ../ specifier', () => {
    const r = makeResolver();
    assert.equal(r.resolveSpecifier('../lib/core', '/project/src/main.js'), '/project/lib/core.js');
  });

  it('throws CE-M03 for bare specifier', () => {
    const r = makeResolver();
    let err;
    try {
      r.resolveSpecifier('lodash', '/entry.js');
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof ResolveError, 'expected ResolveError');
    assert.equal(err.code, 'CE-M03');
    assert.ok(err.message.includes('bare specifier'));
  });

});

describe('ModuleResolver — collectDeps', () => {

  it('returns empty array for entry with no imports', () => {
    const r = makeResolver();
    const ast = parseSource('function hello() { return 1; }', '/entry.js');
    const deps = r.collectDeps(ast, '/entry.js');
    assert.deepEqual(deps, []);
  });

  it('returns single dep for one import', () => {
    const r = makeResolver({
      '/lib.js': 'export function helper() { return 42; }',
    });
    const ast = parseSource(`
      import { helper } from './lib';
      function main() { return helper(); }
    `, '/entry.js');
    const deps = r.collectDeps(ast, '/entry.js');
    assert.equal(deps.length, 1);
    assert.equal(deps[0].filename, '/lib.js');
  });

  it('does not include the entry file itself', () => {
    const r = makeResolver({
      '/lib.js': 'export function helper() { return 1; }',
    });
    const ast = parseSource(`import { helper } from './lib';`, '/entry.js');
    const deps = r.collectDeps(ast, '/entry.js');
    assert.ok(deps.every(d => d.filename !== '/entry.js'));
  });

  it('returns deps in dependency-first order (deepest deps first)', () => {
    const r = makeResolver({
      '/a.js': 'import { b } from "./b"; export function a() { return b(); }',
      '/b.js': 'import { c } from "./c"; export function b() { return c(); }',
      '/c.js': 'export function c() { return 99; }',
    });
    const ast = parseSource(`import { a } from './a';`, '/entry.js');
    const deps = r.collectDeps(ast, '/entry.js');
    const names = deps.map(d => d.filename);
    assert.ok(names.indexOf('/c.js') < names.indexOf('/b.js'), 'c must come before b');
    assert.ok(names.indexOf('/b.js') < names.indexOf('/a.js'), 'b must come before a');
  });

  it('deduplicates shared dependencies (diamond)', () => {
    const r = makeResolver({
      '/a.js': 'import { c } from "./c"; export function a() { return 0; }',
      '/b.js': 'import { c } from "./c"; export function b() { return 0; }',
      '/c.js': 'export function c() { return 0; }',
    });
    const ast = parseSource(`
      import { a } from './a';
      import { b } from './b';
    `, '/entry.js');
    const deps = r.collectDeps(ast, '/entry.js');
    const cCount = deps.filter(d => d.filename === '/c.js').length;
    assert.equal(cCount, 1, 'shared dep should appear exactly once');
  });

  it('resolves std/ imports transitively', () => {
    const r = makeResolver({
      [STD_ROOT + '/range.js']: 'export class Range {}',
    });
    const ast = parseSource(`import { Range } from 'std/range';`, '/entry.js');
    const deps = r.collectDeps(ast, '/entry.js');
    assert.equal(deps.length, 1);
    assert.equal(deps[0].filename, '/std/range.js');
  });

  it('throws CE-M01 for missing file', () => {
    const r = makeResolver(); // empty file system
    const ast = parseSource(`import { x } from './missing';`, '/entry.js');
    let err;
    try {
      r.collectDeps(ast, '/entry.js');
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof ResolveError, 'expected ResolveError');
    assert.equal(err.code, 'CE-M01');
    assert.ok(err.message.includes('/missing.js'));
  });

  it('throws CE-M02 for import cycle', () => {
    const r = makeResolver({
      '/a.js': 'import { b } from "./b";',
      '/b.js': 'import { a } from "./a";',
    });
    const ast = parseSource(`import { a } from './a';`, '/entry.js');
    let err;
    try {
      r.collectDeps(ast, '/entry.js');
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof ResolveError, 'expected ResolveError');
    assert.equal(err.code, 'CE-M02');
    assert.ok(err.message.includes('cycle'));
  });

  it('throws CE-M03 for bare specifier in transitive dep', () => {
    const r = makeResolver({
      '/lib.js': 'import { x } from "lodash";',
    });
    const ast = parseSource(`import { lib } from './lib';`, '/entry.js');
    let err;
    try {
      r.collectDeps(ast, '/entry.js');
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof ResolveError, 'expected ResolveError');
    assert.equal(err.code, 'CE-M03');
  });

  it('provides source content in returned deps', () => {
    const libSrc = 'export function helper() { return 7; }';
    const r = makeResolver({ '/lib.js': libSrc });
    const ast = parseSource(`import { helper } from './lib';`, '/entry.js');
    const deps = r.collectDeps(ast, '/entry.js');
    assert.equal(deps[0].source, libSrc);
  });

});
