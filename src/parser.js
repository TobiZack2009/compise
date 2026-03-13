/**
 * @fileoverview Acorn wrapper with syntactic banned-construct detection.
 * Performs a first-pass AST walk and rejects constructs that are
 * statically visible in the parse tree.
 */

import { parse } from 'acorn';

/**
 * Minimal recursive AST walker.
 * Calls visitor[node.type](node) if a handler exists, then recurses into child nodes.
 * @param {object} node
 * @param {Record<string, (node: object) => void>} visitor
 */
function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  const fn = visitor[node.type];
  if (fn) fn(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && typeof item.type === 'string') {
          walk(item, visitor);
        }
      }
    } else if (child && typeof child === 'object' && typeof child.type === 'string') {
      walk(child, visitor);
    }
  }
}

/**
 * Parse js.wat source with acorn and run syntactic banned-construct detection.
 * Throws on the first batch of syntactic violations found.
 *
 * @param {string} source  js.wat source text
 * @param {string} [filename='<input>']  used in error messages
 * @returns {object}  acorn Program AST
 * @throws {Error}  if the source has parse errors or banned syntax
 */
export function parseSource(source, filename = '<input>') {
  /** @type {object} */
  let ast;
  /** @type {Array<{ line: number, exportName: string }>} */
  const exportAnnotations = [];
  try {
    ast = parse(source, {
      ecmaVersion: 2022,
      sourceType: 'module',
      locations: true,
      onComment(isBlock, text, _start, _end, startLoc) {
        if (isBlock) return;
        const m = text.match(/^@export(?:\("([^"]+)"\))?/);
        if (!m) return;
        // m[1] is the custom name (or undefined for bare @export)
        exportAnnotations.push({ line: startLoc?.line ?? 0, exportName: m[1] ?? null });
      },
    });
  } catch (/** @type {any} */ e) {
    throw new Error(`Parse error in ${filename}: ${e.message}`);
  }

  // Attach export annotations to function declarations
  if (exportAnnotations.length > 0) {
    // Build a map from line number to export name
    /** @type {Map<number, string|null>} */
    const exportByLine = new Map();
    for (const ann of exportAnnotations) exportByLine.set(ann.line, ann.exportName);

    for (const node of ast.body) {
      if (node.type !== 'FunctionDeclaration') continue;
      const fnLine = node.loc?.start?.line ?? 0;
      for (const [annLine, exportName] of exportByLine) {
        // Allow @export on the same line or the line immediately before the function
        if (annLine === fnLine || annLine === fnLine - 1) {
          node._exportName = exportName ?? node.id?.name ?? null;
          exportByLine.delete(annLine);
          break;
        }
      }
    }
  }

  const errors = [];

  /** @param {string} msg @param {{ loc?: { start?: { line?: number } } }} node */
  function err(msg, node) {
    const line = node?.loc?.start?.line ?? '?';
    errors.push(`${msg} (${filename}:${line})`);
  }

  walk(ast, {
    /** @param {object} node */
    FunctionDeclaration(node) {
      if (node.generator) err('Generators are not allowed', node);
      if (node.async)     err('async functions are not allowed', node);
    },
    /** @param {object} node */
    FunctionExpression(node) {
      if (node.generator) err('Generators are not allowed', node);
      if (node.async)     err('async functions are not allowed', node);
    },
    /** @param {object} node */
    ArrowFunctionExpression(node) {
      if (node.async) err('async functions are not allowed', node);
    },
    /** @param {object} node */
    AwaitExpression(node) {
      err('await is not allowed', node);
    },
    /** @param {object} node */
    WithStatement(node) {
      err('with statement is not allowed', node);
    },
    /** @param {object} node */
    ForInStatement(node) {
      err('for...in is not allowed; use for...of', node);
    },
    /** @param {object} node */
    SequenceExpression(node) {
      err('Comma operator (sequence expression) is not allowed', node);
    },
    /** @param {object} node */
    ImportExpression(node) {
      err('Dynamic import() is not allowed; use static imports', node);
    },
    /** @param {object} node */
    Identifier(node) {
      if (node.name === 'arguments') {
        err("'arguments' is not allowed; use rest parameters", node);
      }
    },
  });

  if (errors.length > 0) throw new Error(errors.join('\n'));
  return ast;
}
