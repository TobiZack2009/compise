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
  /** @type {Array<{ line: number, module: string, name: string }>} */
  const externalAnnotations = [];
  /** @type {Array<{ line: number, symbol: string }>} */
  const symbolAnnotations = [];
  try {
    ast = parse(source, {
      ecmaVersion: 2022,
      sourceType: 'module',
      locations: true,
      onComment(isBlock, text, _start, _end, startLoc) {
        if (isBlock) return;
        const line = startLoc?.line ?? 0;
        const mExport = text.match(/^@export(?:\("([^"]+)"\))?/);
        if (mExport) {
          exportAnnotations.push({ line, exportName: mExport[1] ?? null });
          return;
        }
        const mExternal = text.match(/^@external\("([^"]+)",\s*"([^"]+)"\)/);
        if (mExternal) {
          externalAnnotations.push({ line, module: mExternal[1], name: mExternal[2] });
          return;
        }
        const mSymbol = text.match(/^@symbol\((.+)\)/);
        if (mSymbol) {
          symbolAnnotations.push({ line, symbol: mSymbol[1].trim() });
        }
      },
    });
  } catch (/** @type {any} */ e) {
    throw new Error(`Parse error in ${filename}: ${e.message}`);
  }

  // Helper: attach annotation to nearest function declaration within 2 lines
  /**
   * @param {Map<number, any>} byLine
   * @param {(node: object, value: any) => void} attach
   */
  function attachToFunctions(byLine, attach) {
    for (const node of ast.body) {
      if (node.type !== 'FunctionDeclaration') continue;
      const fnLine = node.loc?.start?.line ?? 0;
      for (const [annLine, value] of byLine) {
        if (annLine === fnLine || annLine === fnLine - 1) {
          attach(node, value);
          byLine.delete(annLine);
          break;
        }
      }
    }
    // Also scan class method declarations
    for (const node of ast.body) {
      if (node.type !== 'ClassDeclaration') continue;
      for (const el of node.body?.body ?? []) {
        if (el.type !== 'MethodDefinition') continue;
        const fnLine = el.loc?.start?.line ?? 0;
        for (const [annLine, value] of byLine) {
          if (annLine === fnLine || annLine === fnLine - 1) {
            attach(el, value);
            byLine.delete(annLine);
            break;
          }
        }
      }
    }
  }

  // Attach export annotations to function declarations
  if (exportAnnotations.length > 0) {
    /** @type {Map<number, string|null>} */
    const exportByLine = new Map();
    for (const ann of exportAnnotations) exportByLine.set(ann.line, ann.exportName);
    attachToFunctions(exportByLine, (node, exportName) => {
      node._exportName = exportName ?? node.id?.name ?? null;
    });
  }

  // Attach @external annotations to function declarations
  if (externalAnnotations.length > 0) {
    /** @type {Map<number, { module: string, name: string }>} */
    const extByLine = new Map();
    for (const ann of externalAnnotations) extByLine.set(ann.line, { module: ann.module, name: ann.name });
    attachToFunctions(extByLine, (node, ext) => {
      node._externalModule = ext.module;
      node._externalName   = ext.name;
    });
  }

  // Attach @symbol annotations to function/method declarations
  if (symbolAnnotations.length > 0) {
    /** @type {Map<number, string>} */
    const symByLine = new Map();
    for (const ann of symbolAnnotations) symByLine.set(ann.line, ann.symbol);
    attachToFunctions(symByLine, (node, symbol) => {
      node._symbolName = symbol;
    });
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
