/**
 * @fileoverview Type inference — bottom-up walk that mutates AST nodes with
 * `_type` (TypeInfo) annotations and collects function signatures.
 */

import { TYPES, CAST_TYPES, PROMOTION_ORDER,
         defaultIntegerType, defaultFloatType, promoteTypes } from './types.js';

/**
 * @typedef {import('./types.js').TypeInfo} TypeInfo
 */

/**
 * @typedef {{ params: Array<{ name: string, type: TypeInfo }>,
 *             returnType: TypeInfo }} FunctionSignature
 */

// ── Scope chain ──────────────────────────────────────────────────────────────

class ScopeChain {
  constructor() {
    /** @type {Map<string, TypeInfo>[]} */
    this._frames = [];
  }

  push() { this._frames.push(new Map()); }
  pop()  { this._frames.pop(); }

  /** @param {string} name @param {TypeInfo} type */
  define(name, type) {
    this._frames[this._frames.length - 1].set(name, type);
  }

  /**
   * @param {string} name
   * @returns {TypeInfo|undefined}
   */
  lookup(name) {
    for (let i = this._frames.length - 1; i >= 0; i--) {
      if (this._frames[i].has(name)) return this._frames[i].get(name);
    }
    return undefined;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Is the literal node a float (has a decimal point or exponent in its raw source)?
 * We use `node.raw` rather than `Number.isInteger` because `0.0 === 0` in JS,
 * so both would appear as integer-valued without the raw text.
 * @param {object} node  Literal AST node
 * @returns {boolean}
 */
function isFloatLiteral(node) {
  if (typeof node.value !== 'number') return false;
  if (typeof node.raw === 'string') return /[.eE]/.test(node.raw);
  return !Number.isInteger(node.value);
}

/**
 * Is the literal node an integer (no decimal point or exponent in raw source)?
 * @param {object} node  Literal AST node
 * @returns {boolean}
 */
function isIntLiteral(node) {
  if (typeof node.value !== 'number') return false;
  if (typeof node.raw === 'string') return !/[.eE]/.test(node.raw);
  return Number.isInteger(node.value);
}

// ── Main inference engine ────────────────────────────────────────────────────

/**
 * Infer types for an entire Program AST.
 * Mutates every expression node with a `_type` property.
 *
 * @param {object} ast  acorn Program AST
 * @param {string} [filename='<input>']
 * @returns {{ ast: object, signatures: Map<string, FunctionSignature> }}
 */
export function inferTypes(ast, filename = '<input>') {
  /** @type {Map<string, FunctionSignature>} */
  const signatures = new Map();
  const scope = new ScopeChain();
  scope.push(); // global scope

  for (const stmt of ast.body) {
    inferStatement(stmt, scope, signatures, filename);
  }

  return { ast, signatures };
}

/**
 * @param {object} stmt
 * @param {ScopeChain} scope
 * @param {Map<string, FunctionSignature>} signatures
 * @param {string} filename
 */
function inferStatement(stmt, scope, signatures, filename) {
  if (!stmt) return;

  switch (stmt.type) {
    case 'FunctionDeclaration':
      inferFunction(stmt, scope, signatures, filename);
      break;

    case 'VariableDeclaration':
      for (const decl of stmt.declarations) {
        if (decl.init) {
          const t = inferExpr(decl.init, scope, filename);
          decl._type = t;
          if (decl.id?.name) scope.define(decl.id.name, t);
        }
      }
      break;

    case 'ExpressionStatement':
      inferExpr(stmt.expression, scope, filename);
      break;

    case 'ReturnStatement':
      if (stmt.argument) {
        const t = inferExpr(stmt.argument, scope, filename);
        stmt._type = t;
      }
      break;

    case 'IfStatement':
      inferExpr(stmt.test, scope, filename);
      inferStatement(stmt.consequent, scope, signatures, filename);
      if (stmt.alternate) inferStatement(stmt.alternate, scope, signatures, filename);
      break;

    case 'BlockStatement':
      scope.push();
      for (const s of stmt.body) inferStatement(s, scope, signatures, filename);
      scope.pop();
      break;

    default:
      break;
  }
}

/**
 * Infer the type of a function and register its signature.
 * @param {object} node  FunctionDeclaration
 * @param {ScopeChain} scope
 * @param {Map<string, FunctionSignature>} signatures
 * @param {string} filename
 */
function inferFunction(node, scope, signatures, filename) {
  scope.push();

  // Infer parameter types from their default values
  /** @type {Array<{ name: string, type: TypeInfo }>} */
  const params = [];
  for (const p of node.params) {
    if (p.type === 'AssignmentPattern' && p.left?.name) {
      const defaultType = inferExpr(p.right, scope, filename);
      p._type = defaultType;
      p.left._type = defaultType;
      scope.define(p.left.name, defaultType);
      params.push({ name: p.left.name, type: defaultType });
    }
  }

  // Collect return types from all ReturnStatements
  /** @type {TypeInfo[]} */
  const returnTypes = [];
  collectReturnTypes(node.body, returnTypes, scope, signatures, filename);

  // Unify return types
  let returnType = TYPES.void;
  if (returnTypes.length > 0) {
    returnType = returnTypes[0];
    for (let i = 1; i < returnTypes.length; i++) {
      const unified = promoteTypes(returnType, returnTypes[i]);
      if (!unified) {
        throw new Error(
          `Type mismatch in return types of '${node.id?.name}': ` +
          `${returnType.name} vs ${returnTypes[i].name} (${filename}:${node.loc?.start?.line ?? '?'})`
        );
      }
      returnType = unified;
    }
  }

  node._returnType = returnType;
  scope.pop();

  if (node.id?.name) {
    signatures.set(node.id.name, { params, returnType });
  }
}

/**
 * Recursively collect the TypeInfo of every ReturnStatement in a block.
 * Also does type inference on inner statements so the scope is populated.
 * @param {object} node
 * @param {TypeInfo[]} out
 * @param {ScopeChain} scope
 * @param {Map<string, FunctionSignature>} signatures
 * @param {string} filename
 */
function collectReturnTypes(node, out, scope, signatures, filename) {
  if (!node) return;

  switch (node.type) {
    case 'BlockStatement':
      scope.push();
      for (const s of node.body) collectReturnTypes(s, out, scope, signatures, filename);
      scope.pop();
      break;

    case 'ReturnStatement':
      if (node.argument) {
        const t = inferExpr(node.argument, scope, filename);
        node._type = t;
        out.push(t);
      }
      break;

    case 'VariableDeclaration':
      for (const decl of node.declarations) {
        if (decl.init) {
          const t = inferExpr(decl.init, scope, filename);
          decl._type = t;
          if (decl.id?.name) scope.define(decl.id.name, t);
        }
      }
      break;

    case 'ExpressionStatement':
      inferExpr(node.expression, scope, filename);
      break;

    case 'IfStatement':
      inferExpr(node.test, scope, filename);
      collectReturnTypes(node.consequent,  out, scope, signatures, filename);
      if (node.alternate) collectReturnTypes(node.alternate, out, scope, signatures, filename);
      break;

    default:
      break;
  }
}

/**
 * Infer the type of an expression node.
 * Mutates node._type and returns it.
 * @param {object} node
 * @param {ScopeChain} scope
 * @param {string} filename
 * @returns {TypeInfo}
 */
function inferExpr(node, scope, filename) {
  if (!node) return TYPES.void;

  /** @type {TypeInfo} */
  let t;

  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'boolean') {
        t = TYPES.bool;
      } else if (typeof node.value === 'string') {
        t = TYPES.str;
      } else if (typeof node.value === 'number') {
        t = isFloatLiteral(node) ? defaultFloatType() : defaultIntegerType();
      } else {
        t = TYPES.void;
      }
      break;

    case 'Identifier': {
      const resolved = scope.lookup(node.name);
      if (resolved) {
        t = resolved;
      } else if (TYPES[node.name]) {
        t = TYPES[node.name]; // abstract type reference e.g. `Integer`
      } else {
        t = TYPES.void; // unresolved — tolerate in phase 1
      }
      break;
    }

    case 'CallExpression': {
      const callee = node.callee;
      // Cast calls: u8(x), i32(x), f64(x), etc.
      if (callee.type === 'Identifier' && CAST_TYPES.has(callee.name)) {
        t = TYPES[callee.name];
        // Infer arg types for side-effects / nested inference
        for (const arg of node.arguments) inferExpr(arg, scope, filename);
      } else {
        // Generic call — infer args, return void for now (phase 1)
        for (const arg of node.arguments) inferExpr(arg, scope, filename);
        t = TYPES.void;
      }
      break;
    }

    case 'BinaryExpression': {
      const left  = inferExpr(node.left,  scope, filename);
      const right = inferExpr(node.right, scope, filename);

      const cmpOps = new Set(['===', '!==', '<', '>', '<=', '>=']);
      if (cmpOps.has(node.operator)) {
        t = TYPES.bool;
      } else {
        const promoted = promoteTypes(left, right);
        if (!promoted) {
          throw new Error(
            `Type error: cannot mix ${left.name} and ${right.name} in '${node.operator}' ` +
            `without explicit cast (${filename}:${node.loc?.start?.line ?? '?'})`
          );
        }
        t = promoted;
      }
      break;
    }

    case 'UnaryExpression':
      t = inferExpr(node.argument, scope, filename);
      if (node.operator === '!') t = TYPES.bool;
      break;

    case 'AssignmentExpression':
      t = inferExpr(node.right, scope, filename);
      break;

    case 'ConditionalExpression': {
      inferExpr(node.test, scope, filename);
      const left  = inferExpr(node.consequent, scope, filename);
      const right = inferExpr(node.alternate,  scope, filename);
      t = promoteTypes(left, right) ?? left;
      break;
    }

    case 'MemberExpression':
      inferExpr(node.object, scope, filename);
      t = TYPES.void; // field access type resolution — Phase 2
      break;

    default:
      t = TYPES.void;
      break;
  }

  node._type = t;
  return t;
}
