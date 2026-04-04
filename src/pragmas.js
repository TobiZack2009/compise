/**
 * @fileoverview compiler::test pragma runner.
 *
 * Supports in-source assertions that verify compiler behaviour without
 * executing the resulting WASM. Pragma files start with:
 *   //# compiler::test
 *
 * Each directive applies to the first non-pragma, non-empty line that follows:
 *   //# compiler::type.infer {isize}
 *   const x = 0;
 *
 * Implemented assertions
 * ─────────────────────
 *   parse.ok              — parseSource() must succeed
 *   parse.error           — parseSource() must throw
 *   type.infer {T}        — top-level binding inferred type name equals T
 *   error.expect {text}   — full compilation must throw and message contains text
 *   emit.wat {pattern}    — compiled WAT contains pattern substring
 *   emit.sig {sig}        — compiled WAT contains sig substring (for signatures)
 *   layout.field {n} op v — class field byte offset satisfies comparison
 *   layout.size op v      — class total size satisfies comparison
 */

import { parseSource }  from './parser.js';
import { inferTypes }   from './typecheck.js';
import { compileSource } from './compiler.js';

// ── Directive parser ──────────────────────────────────────────────────────────

/**
 * Parse a pragma directive string into structured form.
 * @param {string} text  e.g. "type.infer {isize}" or "layout.field {x} eq 12"
 * @returns {{ namespace: string, name: string, args: string[] } | null}
 */
export function parsePragmaDirective(text) {
  const m = text.match(/^(\w+)\.(\w+)\s*(.*)/s);
  if (!m) return null;
  const [, namespace, name, rest] = m;
  return { namespace, name, args: parsePragmaArgs(rest.trim()) };
}

/**
 * Parse zero or more pragma arguments from the tail of a directive.
 * Arguments are either curly-brace-quoted spans {…} or bare non-space tokens.
 * @param {string} rest
 * @returns {string[]}
 */
function parsePragmaArgs(rest) {
  const args = [];
  let r = rest;
  while (r.length > 0) {
    if (r[0] === '{') {
      // Find the matching closing brace, respecting nesting.
      let depth = 0, i = 0;
      for (; i < r.length; i++) {
        if (r[i] === '{') depth++;
        else if (r[i] === '}') { if (--depth === 0) { i++; break; } }
      }
      args.push(r.slice(1, i - 1));
      r = r.slice(i).trimStart();
    } else {
      const m = r.match(/^(\S+)/);
      if (!m) break;
      args.push(m[1]);
      r = r.slice(m[1].length).trimStart();
    }
  }
  return args;
}

// ── Assertion extractor (synchronous) ────────────────────────────────────────

/**
 * @typedef {{ directive: string, parsed: object, line: number,
 *             contextLine: number, context: string, label: string }} Assertion
 */

/**
 * Extract pragma assertions from raw source text.
 * Scans for `//# compiler::` line comments; each directive is paired with the
 * first non-pragma, non-empty source line that follows it.
 *
 * @param {string} source
 * @returns {{ isTestFile: boolean, assertions: Assertion[] }}
 */
export function extractAssertions(source) {
  const lines = source.split('\n');

  // The file header must be the first //# compiler:: directive and its value must be "test".
  const isTestFile = lines.some(l => /^\s*\/\/#\s*compiler::test\s*$/.test(l));
  if (!isTestFile) return { isTestFile: false, assertions: [] };

  const assertions = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\/\/#\s*compiler::(.+)$/);
    if (!m) continue;
    const directive = m[1].trim();
    if (directive === 'test') continue; // file header — not an assertion

    const parsed = parsePragmaDirective(directive);
    if (!parsed) continue;

    // The "context" is the next source line that is neither empty nor a pragma.
    let contextLine = i + 1;
    while (contextLine < lines.length) {
      const cl = lines[contextLine].trim();
      if (cl.length > 0 && !cl.match(/^\/\/#\s*compiler::/)) break;
      contextLine++;
    }
    const context = lines[contextLine]?.trim() ?? '<eof>';

    assertions.push({
      directive,
      parsed,
      line: i + 1,           // 1-based line of the pragma
      contextLine: contextLine + 1, // 1-based line of the subject
      context,
      label: `${directive}  ← ${context.slice(0, 60)}`,
    });
  }

  return { isTestFile, assertions };
}

// ── Per-assertion runner ──────────────────────────────────────────────────────

/**
 * Run one pragma assertion against the given source.
 *
 * @param {Assertion} assertion
 * @param {string}    source    full source of the pragma file
 * @param {string}    filename
 * @param {object}    [opts]    passed through to compileSource
 * @returns {Promise<{ pass: boolean, reason: string }>}
 */
export async function runAssertion(assertion, source, filename, opts = {}) {
  const { namespace, name, args } = assertion.parsed;

  switch (namespace) {
    case 'parse':  return runParseAssertion(name, args, source, filename);
    case 'type':   return runTypeAssertion(name, args, assertion, source, filename);
    case 'error':  return runErrorAssertion(name, args, source, filename, opts);
    case 'emit':   return runEmitAssertion(name, args, assertion, source, filename, opts);
    case 'layout': return runLayoutAssertion(name, args, assertion, source, filename, opts);
    default:
      return { pass: false, reason: `Unknown pragma namespace: ${namespace} (CIT-032)` };
  }
}

// ── parse.* ───────────────────────────────────────────────────────────────────

/** @returns {{ pass: boolean, reason: string }} */
function runParseAssertion(name, _args, source, filename) {
  if (name === 'ok') {
    try {
      parseSource(source, filename);
      return { pass: true, reason: 'parsed ok' };
    } catch (e) {
      return { pass: false, reason: `unexpected parse error: ${e.message}` };
    }
  }
  if (name === 'error') {
    try {
      parseSource(source, filename);
      return { pass: false, reason: 'expected parse error but parsing succeeded (CIT-005)' };
    } catch (_e) {
      return { pass: true, reason: 'got expected parse error' };
    }
  }
  return { pass: false, reason: `Unknown parse assertion: ${name} (CIT-032)` };
}

// ── type.* ────────────────────────────────────────────────────────────────────

/** @returns {Promise<{ pass: boolean, reason: string }>} */
async function runTypeAssertion(name, args, assertion, source, filename) {
  if (name !== 'infer') {
    return { pass: false, reason: `Unknown type assertion: ${name} (CIT-032)` };
  }

  const expectedType = args[0];
  if (!expectedType) {
    return { pass: false, reason: 'type.infer requires a type argument {T}' };
  }

  let typedAst;
  try {
    const ast = parseSource(source, filename);
    ({ ast: typedAst } = inferTypes(ast, filename));
  } catch (e) {
    return { pass: false, reason: `Inference error: ${e.message}` };
  }

  // Walk top-level body looking for the VariableDeclaration at contextLine.
  const targetLine = assertion.contextLine;
  const type = findTopLevelDeclTypeAtLine(typedAst, targetLine);

  if (!type) {
    return { pass: false, reason: `No top-level VariableDeclaration found at line ${targetLine}` };
  }
  return {
    pass: type.name === expectedType,
    reason: type.name === expectedType
      ? `type is ${type.name} ✓`
      : `expected ${expectedType}, got ${type.name} (CIT-007)`,
  };
}

// ── error.* ───────────────────────────────────────────────────────────────────

/** @returns {Promise<{ pass: boolean, reason: string }>} */
async function runErrorAssertion(name, args, source, filename, opts) {
  if (name !== 'expect') {
    return { pass: false, reason: `Unknown error assertion: ${name} (CIT-032)` };
  }

  const pattern = args[0] ?? '';
  try {
    await compileSource(source, filename, opts);
    return {
      pass: false,
      reason: pattern
        ? `Expected error containing "${pattern}" but compilation succeeded (CIT-003)`
        : 'Expected a compile error but compilation succeeded (CIT-003)',
    };
  } catch (e) {
    const msg = (e.message ?? String(e)).slice(0, 400);
    if (!pattern) return { pass: true, reason: 'Got expected compile error' };
    const pass = msg.toLowerCase().includes(pattern.toLowerCase());
    return {
      pass,
      reason: pass
        ? `Got expected error containing "${pattern}" ✓`
        : `Error did not contain "${pattern}": ${msg} (CIT-003)`,
    };
  }
}

// ── emit.* ────────────────────────────────────────────────────────────────────

/** @returns {Promise<{ pass: boolean, reason: string }>} */
async function runEmitAssertion(name, args, assertion, source, filename, opts) {
  let result;
  try {
    result = await compileSource(source, filename, opts);
  } catch (e) {
    return { pass: false, reason: `Compilation failed: ${e.message}` };
  }

  if (name === 'wat') {
    const pattern = args[0];
    if (!pattern) return { pass: false, reason: 'emit.wat requires {pattern}' };
    const pass = result.wat.includes(pattern);
    return {
      pass,
      reason: pass
        ? `WAT contains "${pattern}" ✓`
        : `WAT does not contain "${pattern}" (CIT-010)`,
    };
  }

  if (name === 'sig') {
    // The signature substring must appear in the WAT — binaryen emits full func signatures.
    // For the function following the pragma, its name is extracted from assertion.context.
    const sig = args[0];
    if (!sig) return { pass: false, reason: 'emit.sig requires {sig}' };
    const pass = result.wat.includes(sig);
    return {
      pass,
      reason: pass
        ? `WAT contains signature "${sig}" ✓`
        : `WAT does not contain signature "${sig}" (CIT-012)`,
    };
  }

  if (name === 'noCall') {
    const fn = args[0];
    if (!fn) return { pass: false, reason: 'emit.noCall requires {fn}' };
    const pass = !result.wat.includes(`call $${fn}`) && !result.wat.includes(`call ${fn}`);
    return {
      pass,
      reason: pass ? `WAT has no call to ${fn} ✓` : `WAT unexpectedly calls ${fn} (CIT-011)`,
    };
  }

  return { pass: false, reason: `Unknown emit assertion: ${name} (CIT-032)` };
}

// ── layout.* ──────────────────────────────────────────────────────────────────

/** @returns {Promise<{ pass: boolean, reason: string }>} */
async function runLayoutAssertion(name, args, assertion, source, filename, opts) {
  let result;
  try {
    // lib:true avoids requiring a _start entry point in test sources.
    result = await compileSource(source, filename, { ...opts, lib: true });
  } catch (e) {
    return { pass: false, reason: `Compilation failed: ${e.message}` };
  }

  const layoutMap = result.layoutMap;
  if (!layoutMap || Object.keys(layoutMap).length === 0) {
    return { pass: false, reason: 'No class layout data in compilation result' };
  }

  // Determine the target class name from the pragma's subject line.
  const classMatch = assertion.context.match(/^class\s+(\w+)/);
  const targetClass = classMatch?.[1] ?? null;

  if (name === 'field') {
    // args: [fieldName, operator, value]
    const [fieldName, op, valueStr] = args;
    if (!fieldName || !op || !valueStr) {
      return { pass: false, reason: 'layout.field requires {fieldName} op value' };
    }
    const expected = parseInt(valueStr, 10);

    // If we have a target class, use it; otherwise search all classes.
    const candidates = targetClass
      ? (layoutMap[targetClass] ? [layoutMap[targetClass]] : [])
      : Object.values(layoutMap);

    for (const cl of candidates) {
      const field = cl.fields?.[fieldName];
      if (field) return compare(field.offset, op, expected, `${fieldName} offset`);
    }
    return {
      pass: false,
      reason: `Field "${fieldName}" not found in ${targetClass ?? 'any class'} (CIT-023)`,
    };
  }

  if (name === 'size') {
    // args: [operator, value]
    const [op, valueStr] = args;
    if (!op || !valueStr) return { pass: false, reason: 'layout.size requires op value' };
    const expected = parseInt(valueStr, 10);

    const candidates = targetClass
      ? (layoutMap[targetClass] ? [layoutMap[targetClass]] : [])
      : Object.values(layoutMap);

    for (const cl of candidates) {
      if (cl.size !== undefined) return compare(cl.size, op, expected, 'class size');
    }
    return { pass: false, reason: `No size found for ${targetClass ?? 'any class'} (CIT-024)` };
  }

  return { pass: false, reason: `Unknown layout assertion: ${name} (CIT-032)` };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Find the `_type` of the first top-level VariableDeclarator whose declaration
 * starts at the given 1-based line number.
 * @param {object} ast
 * @param {number} targetLine
 * @returns {import('./types.js').TypeInfo | null}
 */
function findTopLevelDeclTypeAtLine(ast, targetLine) {
  for (const node of ast.body) {
    if (node.type !== 'VariableDeclaration') continue;
    if ((node.loc?.start?.line ?? 0) === targetLine) {
      const decl = node.declarations[0];
      // _type may live on the declarator itself or on its init expression.
      return decl._type ?? decl.init?._type ?? null;
    }
  }
  return null;
}

/**
 * Numeric comparison with a named operator.
 * @param {number} actual
 * @param {string} op   'eq' | 'lt' | 'lte' | 'gt' | 'gte'
 * @param {number} expected
 * @param {string} label
 * @returns {{ pass: boolean, reason: string }}
 */
function compare(actual, op, expected, label) {
  const OPS = { eq: '===', lt: '<', lte: '<=', gt: '>', gte: '>=' };
  const pass = op === 'eq'  ? actual === expected
             : op === 'lt'  ? actual <   expected
             : op === 'lte' ? actual <=  expected
             : op === 'gt'  ? actual >   expected
             : op === 'gte' ? actual >=  expected
             : false;
  const sym = OPS[op] ?? op;
  return {
    pass,
    reason: pass
      ? `${label}: ${actual} ${sym} ${expected} ✓`
      : `${label}: ${actual} does not satisfy ${sym} ${expected}`,
  };
}
