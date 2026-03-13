/**
 * @fileoverview Type inference — bottom-up walk that mutates AST nodes with
 * `_type` (TypeInfo) annotations and collects function signatures.
 */

import { TYPES, CAST_TYPES, PROMOTION_ORDER,
         defaultIntegerType, defaultFloatType, promoteTypes } from './types.js';
import { resolveStdNamespace, resolveStdDefault, resolveStdCollectionMethod, resolveStdCollectionCtor, resolveStdFunction } from './std.js';

/**
 * @typedef {import('./types.js').TypeInfo} TypeInfo
 */

/**
 * @typedef {{ params: Array<{ name: string, type: TypeInfo }>,
 *             returnType: TypeInfo }} FunctionSignature
 */

/**
 * @typedef {{ name: string, type: TypeInfo,
 *             fields: Map<string, TypeInfo>,
 *             methods: Map<string, { node: object, signature: FunctionSignature }>,
 *             constructor: { node: object, signature: FunctionSignature } | null }} ClassInfo
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
  /** @type {Map<string, ClassInfo>} */
  const classes = new Map();
  /** @type {Map<string, { kind: 'namespace'|'default', module: string, name: string }>} */
  const imports = new Map();
  const scope = new ScopeChain();
  scope.push(); // global scope

  // Register class names early.
  for (const stmt of ast.body) {
    if (stmt.type === 'ClassDeclaration' && stmt.id?.name) {
      const typeInfo = {
        kind: 'class',
        name: stmt.id.name,
        nullable: true,
        abstract: false,
        wasmType: 'i32',
        isInteger: false,
        isFloat: false,
        isSigned: false,
        bits: 32,
      };
      classes.set(stmt.id.name, {
        name: stmt.id.name,
        type: typeInfo,
        fields: new Map(),
        methods: new Map(),
        constructor: null,
      });
    }
  }

  for (const stmt of ast.body) {
    if (stmt.type === 'ImportDeclaration') {
      const mod = stmt.source?.value;
      for (const spec of stmt.specifiers || []) {
        if (spec.type === 'ImportSpecifier') {
          imports.set(spec.local.name, { kind: 'namespace', module: mod, name: spec.imported.name });
        } else if (spec.type === 'ImportDefaultSpecifier') {
          imports.set(spec.local.name, { kind: 'default', module: mod, name: spec.local.name });
        }
      }
    }
  }

  for (const classInfo of classes.values()) {
    TYPES[classInfo.name] = classInfo.type;
  }

  // Register function names early with unknown return types for recursion.
  for (const stmt of ast.body) {
    if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
      signatures.set(stmt.id.name, { params: [], returnType: TYPES.unknown });
    }
  }

  // Iterate until signatures stabilize (fixpoint for recursion).
  let changed = true;
  while (changed) {
    changed = false;
    const prevReturns = new Map(
      Array.from(signatures.entries(), ([name, sig]) => [name, sig.returnType])
    );
    for (const stmt of ast.body) {
      inferStatement(stmt, scope, signatures, classes, filename, { currentClass: null, imports });
    }
    for (const [name, sig] of signatures.entries()) {
      if (prevReturns.get(name) !== sig.returnType) changed = true;
    }
  }

  return { ast, signatures, classes, imports };
}

/**
 * @param {object} stmt
 * @param {ScopeChain} scope
 * @param {Map<string, FunctionSignature>} signatures
 * @param {string} filename
 */
function inferStatement(stmt, scope, signatures, classes, filename, ctx) {
  if (!stmt) return;

  switch (stmt.type) {
    case 'FunctionDeclaration':
      inferFunction(stmt, scope, signatures, classes, filename, ctx);
      break;

    case 'ClassDeclaration':
      inferClass(stmt, scope, signatures, classes, filename, ctx);
      break;

    case 'ImportDeclaration':
      break;

    case 'VariableDeclaration':
      for (const decl of stmt.declarations) {
        if (decl.init) {
          const t = inferExpr(decl.init, scope, signatures, classes, filename, ctx);
          decl._type = t;
          if (decl.id?.name) scope.define(decl.id.name, t);
        }
      }
      break;

    case 'ExpressionStatement':
      inferExpr(stmt.expression, scope, signatures, classes, filename, ctx);
      break;

    case 'ReturnStatement':
      if (stmt.argument) {
        const t = inferExpr(stmt.argument, scope, signatures, classes, filename, ctx);
        stmt._type = t;
      }
      break;

    case 'IfStatement':
      inferExpr(stmt.test, scope, signatures, classes, filename, ctx);
      inferStatement(stmt.consequent, scope, signatures, classes, filename, ctx);
      if (stmt.alternate) inferStatement(stmt.alternate, scope, signatures, classes, filename, ctx);
      break;

    case 'WhileStatement':
    case 'DoWhileStatement':
      inferExpr(stmt.test, scope, signatures, classes, filename, ctx);
      inferStatement(stmt.body, scope, signatures, classes, filename, ctx);
      break;

    case 'ForStatement':
      scope.push();
      if (stmt.init) {
        if (stmt.init.type === 'VariableDeclaration') {
          inferStatement(stmt.init, scope, signatures, filename);
        } else {
          inferExpr(stmt.init, scope, signatures, classes, filename, ctx);
        }
      }
      if (stmt.test) inferExpr(stmt.test, scope, signatures, classes, filename, ctx);
      if (stmt.update) inferExpr(stmt.update, scope, signatures, classes, filename, ctx);
      inferStatement(stmt.body, scope, signatures, classes, filename, ctx);
      scope.pop();
      break;

    case 'ForOfStatement': {
      scope.push();
      inferExpr(stmt.right, scope, signatures, classes, filename, ctx);
      let loopType = TYPES.isize;
      const rightType = stmt.right?._type;
      if (rightType?.kind === 'class') {
        const rightInfo = classes.get(rightType.name);
        const iterMethod = rightInfo?.methods.get('iter');
        const iterType = iterMethod?.signature.returnType;
        if (iterType?.kind === 'class') {
          const iterInfo = classes.get(iterType.name);
          const nextMethod = iterInfo?.methods.get('next');
          const resType = nextMethod?.signature.returnType;
          if (resType?.kind === 'class') {
            const resInfo = classes.get(resType.name);
            const valueType = resInfo?.fields.get('value');
            if (valueType) loopType = valueType;
          }
        }
      }
      if (stmt.left?.type === 'VariableDeclaration') {
        const decl = stmt.left.declarations[0];
        if (decl?.id?.name) {
          decl._type = loopType;
          scope.define(decl.id.name, loopType);
        }
      }
      inferStatement(stmt.body, scope, signatures, classes, filename, ctx);
      scope.pop();
      break;
    }

    case 'BlockStatement':
      scope.push();
      for (const s of stmt.body) inferStatement(s, scope, signatures, classes, filename, ctx);
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
function inferFunction(node, scope, signatures, classes, filename, ctx) {
  scope.push();
  const childCtx = { currentClass: null, imports: ctx.imports };

  // Infer parameter types from their default values
  /** @type {Array<{ name: string, type: TypeInfo }>} */
  const params = [];
  for (const p of node.params) {
    if (p.type === 'AssignmentPattern' && p.left?.name) {
      const defaultType = inferExpr(p.right, scope, signatures, classes, filename, childCtx);
      p._type = defaultType;
      p.left._type = defaultType;
      scope.define(p.left.name, defaultType);
      params.push({ name: p.left.name, type: defaultType });
    }
  }

  // Collect return types from all ReturnStatements
  /** @type {TypeInfo[]} */
  const returnTypes = [];
  collectReturnTypes(node.body, returnTypes, scope, signatures, classes, filename, childCtx);

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
    const existing = signatures.get(node.id.name);
    const prevReturn = existing?.returnType ?? TYPES.unknown;
    signatures.set(node.id.name, { params, returnType: promoteTypes(prevReturn, returnType) ?? returnType });
  }
}

/**
 * Infer class fields and method signatures.
 * @param {object} node  ClassDeclaration
 * @param {ScopeChain} scope
 * @param {Map<string, FunctionSignature>} signatures
 * @param {Map<string, ClassInfo>} classes
 * @param {string} filename
 */
function inferClass(node, scope, signatures, classes, filename, ctx) {
  if (!node.id?.name) return;
  const classInfo = classes.get(node.id.name);
  if (!classInfo) return;

  for (const element of node.body.body) {
    if (element.type === 'PropertyDefinition' && !element.static) {
      const name = element.key?.name;
      if (name && !classInfo.fields.has(name)) {
        const fieldType = element.value
          ? inferExpr(element.value, scope, signatures, classes, filename, { currentClass: classInfo })
          : TYPES.unknown;
        classInfo.fields.set(name, fieldType);
      }
    }

    if (element.type === 'MethodDefinition' && !element.static) {
      const methodName = element.key?.name;
      const methodFn = element.value;
      if (!methodName || !methodFn) continue;
      const sig = inferMethod(methodFn, classInfo, scope, signatures, classes, filename, ctx);
      if (element.kind === 'constructor') {
        classInfo.constructor = { node: methodFn, signature: sig };
      } else {
        classInfo.methods.set(methodName, { node: methodFn, signature: sig });
      }
    }
  }
}

/**
 * Infer a class method signature.
 * @param {object} fnNode  FunctionExpression for the method
 * @param {ClassInfo} classInfo
 * @param {ScopeChain} scope
 * @param {Map<string, FunctionSignature>} signatures
 * @param {Map<string, ClassInfo>} classes
 * @param {string} filename
 * @returns {FunctionSignature}
 */
function inferMethod(fnNode, classInfo, scope, signatures, classes, filename, ctx) {
  scope.push();
  scope.define('this', classInfo.type);
  const childCtx = { currentClass: classInfo, imports: ctx.imports };

  /** @type {Array<{ name: string, type: TypeInfo }>} */
  const params = [];
  for (const p of fnNode.params) {
    if (p.type === 'AssignmentPattern' && p.left?.name) {
      const defaultType = inferExpr(p.right, scope, signatures, classes, filename, childCtx);
      p._type = defaultType;
      p.left._type = defaultType;
      scope.define(p.left.name, defaultType);
      params.push({ name: p.left.name, type: defaultType });
    }
  }

  /** @type {TypeInfo[]} */
  const returnTypes = [];
  collectReturnTypes(fnNode.body, returnTypes, scope, signatures, classes, filename, childCtx);

  let returnType = TYPES.void;
  if (returnTypes.length > 0) {
    returnType = returnTypes[0];
    for (let i = 1; i < returnTypes.length; i++) {
      const unified = promoteTypes(returnType, returnTypes[i]);
      if (!unified) {
        throw new Error(
          `Type mismatch in return types of method: ${returnType.name} vs ${returnTypes[i].name} ` +
          `(${filename}:${fnNode.loc?.start?.line ?? '?'})`
        );
      }
      returnType = unified;
    }
  }

  scope.pop();
  return { params, returnType };
}

/**
 * Recursively collect the TypeInfo of every ReturnStatement in a block.
 * Also does type inference on inner statements so the scope is populated.
 * @param {object} node
 * @param {TypeInfo[]} out
 * @param {ScopeChain} scope
 * @param {Map<string, FunctionSignature>} signatures
 * @param {Map<string, ClassInfo>} classes
 * @param {string} filename
 * @param {{ currentClass: ClassInfo|null }} ctx
 */
function collectReturnTypes(node, out, scope, signatures, classes, filename, ctx) {
  if (!node) return;

  switch (node.type) {
    case 'BlockStatement':
      scope.push();
      for (const s of node.body) collectReturnTypes(s, out, scope, signatures, classes, filename, ctx);
      scope.pop();
      break;

    case 'ReturnStatement':
      if (node.argument) {
        const t = inferExpr(node.argument, scope, signatures, classes, filename, ctx);
        node._type = t;
        out.push(t);
      }
      break;

    case 'VariableDeclaration':
      for (const decl of node.declarations) {
        if (decl.init) {
          const t = inferExpr(decl.init, scope, signatures, classes, filename, ctx);
          decl._type = t;
          if (decl.id?.name) scope.define(decl.id.name, t);
        }
      }
      break;

    case 'ExpressionStatement':
      inferExpr(node.expression, scope, signatures, classes, filename, ctx);
      break;

    case 'IfStatement':
      inferExpr(node.test, scope, signatures, classes, filename, ctx);
      collectReturnTypes(node.consequent,  out, scope, signatures, classes, filename, ctx);
      if (node.alternate) collectReturnTypes(node.alternate, out, scope, signatures, classes, filename, ctx);
      break;

    case 'WhileStatement':
    case 'DoWhileStatement':
      inferExpr(node.test, scope, signatures, classes, filename, ctx);
      collectReturnTypes(node.body, out, scope, signatures, classes, filename, ctx);
      break;

    case 'ForStatement':
      scope.push();
      if (node.init) {
        if (node.init.type === 'VariableDeclaration') {
          collectReturnTypes(node.init, out, scope, signatures, classes, filename, ctx);
        } else {
          inferExpr(node.init, scope, signatures, classes, filename, ctx);
        }
      }
      if (node.test) inferExpr(node.test, scope, signatures, classes, filename, ctx);
      if (node.update) inferExpr(node.update, scope, signatures, classes, filename, ctx);
      collectReturnTypes(node.body, out, scope, signatures, classes, filename, ctx);
      scope.pop();
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
 * @param {Map<string, FunctionSignature>} signatures
 * @param {Map<string, ClassInfo>} classes
 * @param {string} filename
 * @param {{ currentClass: ClassInfo|null }} ctx
 * @returns {TypeInfo}
 */
function inferExpr(node, scope, signatures, classes, filename, ctx) {
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
      } else if (classes.has(node.name)) {
        t = classes.get(node.name).type;
      } else if (signatures.has(node.name)) {
        t = TYPES.funcref;
        node._fnRef = node.name;
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
        for (const arg of node.arguments) inferExpr(arg, scope, signatures, classes, filename, ctx);
      } else {
        // User function calls
        for (const arg of node.arguments) inferExpr(arg, scope, signatures, classes, filename, ctx);
        if (callee.type === 'Identifier') {
          const std = resolveStdFunction(ctx.imports, callee.name);
          if (std) {
            t = std.returnType;
          } else {
            const sig = signatures.get(callee.name);
            if (sig) {
              t = sig.returnType ?? TYPES.void;
            } else {
              const ref = scope.lookup(callee.name);
              if (ref?.kind === 'funcref') {
                node._callIndirect = true;
                t = TYPES.isize;
              } else {
                t = TYPES.void;
              }
            }
          }
        } else if (callee.type === 'MemberExpression') {
          const objType = inferExpr(callee.object, scope, signatures, classes, filename, ctx);
          const methodName = callee.property?.name;
          if (callee.object.type === 'Identifier' && methodName) {
            if (callee.object.name === 'memory' && (methodName === 'copy' || methodName === 'fill')) {
              t = TYPES.void;
            }
            if (['i32','i64','f32','f64'].includes(callee.object.name)) {
              if (methodName.startsWith('load')) t = TYPES[callee.object.name];
              if (methodName.startsWith('store')) t = TYPES.void;
            }
          }
          if (callee.object.type === 'Identifier' && methodName) {
            const ns = resolveStdNamespace(ctx.imports, callee.object.name, methodName);
            const def = resolveStdDefault(ctx.imports, callee.object.name, methodName);
            const std = ns ?? def;
            if (std) t = std.returnType;
          }
          if ((!t || t === TYPES.void) && objType?.kind === 'array' && methodName) {
            if (methodName === 'push') t = TYPES.usize;
          }
          if ((!t || t === TYPES.void) && objType?.kind === 'iter' && methodName) {
            if (['map', 'filter', 'take', 'skip'].includes(methodName)) t = TYPES.iter;
            else if (methodName === 'collect') t = TYPES.array;
            else if (methodName === 'forEach') t = TYPES.void;
            else if (['count', 'find'].includes(methodName)) t = TYPES.isize;
            else if (methodName === 'some' || methodName === 'every') t = TYPES.bool;
          }
          if ((!t || t === TYPES.void) && objType?.kind === 'str' && methodName) {
            if (methodName === 'slice' || methodName === 'concat') t = TYPES.str;
            else if (methodName === 'indexOf' || methodName === 'charAt') t = TYPES.isize;
          }
          if ((!t || t === TYPES.void) && objType?.kind === 'collection' && methodName) {
            const std = resolveStdCollectionMethod(objType.name, methodName);
            if (std) t = std.returnType;
          }
          if ((!t || t === TYPES.void) && objType?.kind === 'class' && methodName) {
            const classInfo = classes.get(objType.name);
            const fieldType = classInfo?.fields.get(methodName);
            if (fieldType?.kind === 'funcref') {
              node._callIndirect = true;
              t = TYPES.isize;
            }
          }
          if (!t || t === TYPES.void) {
            const classInfo = objType && objType.kind === 'class' ? classes.get(objType.name) : null;
            const method = methodName && classInfo ? classInfo.methods.get(methodName) : null;
            if (method) {
              t = method.signature.returnType ?? TYPES.void;
            } else {
              t = TYPES.void;
            }
          }
        } else {
          t = TYPES.void;
        }
      }
      break;
    }

    case 'BinaryExpression': {
      const left  = inferExpr(node.left,  scope, signatures, classes, filename, ctx);
      const right = inferExpr(node.right, scope, signatures, classes, filename, ctx);

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
      t = inferExpr(node.argument, scope, signatures, classes, filename, ctx);
      if (node.operator === '!') t = TYPES.bool;
      break;

    case 'LogicalExpression':
      inferExpr(node.left, scope, signatures, classes, filename, ctx);
      inferExpr(node.right, scope, signatures, classes, filename, ctx);
      t = TYPES.bool;
      break;

    case 'AssignmentExpression':
      {
        const leftType = inferExpr(node.left, scope, signatures, classes, filename, ctx);
        t = inferExpr(node.right, scope, signatures, classes, filename, ctx);
        if (node.left.type === 'MemberExpression') {
          const objType = node.left.object?._type;
          const classInfo = objType && objType.kind === 'class' ? classes.get(objType.name) : null;
          const fieldName = node.left.property?.name;
          if (classInfo && fieldName) {
            const existing = classInfo.fields.get(fieldName) ?? TYPES.unknown;
            classInfo.fields.set(fieldName, promoteTypes(existing, t) ?? t);
          }
        }
        if (node.left.type === 'Identifier' && leftType.kind === 'unknown') {
          // No-op: locals are already typed by declaration.
        }
      }
      break;

    case 'UpdateExpression':
      t = inferExpr(node.argument, scope, signatures, classes, filename, ctx);
      break;

    case 'ConditionalExpression': {
      inferExpr(node.test, scope, signatures, classes, filename, ctx);
      const left  = inferExpr(node.consequent, scope, signatures, classes, filename, ctx);
      const right = inferExpr(node.alternate,  scope, signatures, classes, filename, ctx);
      t = promoteTypes(left, right) ?? left;
      break;
    }

    case 'MemberExpression':
      {
        const objType = inferExpr(node.object, scope, signatures, classes, filename, ctx);
        if (node.computed && objType?.kind === 'array') {
          inferExpr(node.property, scope, signatures, classes, filename, ctx);
          t = TYPES.isize;
          break;
        }
        if (objType && objType.kind === 'class') {
          const classInfo = classes.get(objType.name);
          const fieldName = node.property?.name;
          if (classInfo && fieldName && classInfo.fields.has(fieldName)) {
            t = classInfo.fields.get(fieldName);
          } else {
            t = TYPES.unknown;
          }
        } else if (objType?.kind === 'array' && node.property?.name === 'length') {
          t = TYPES.usize;
        } else if (objType?.kind === 'str' && !node.computed) {
          const propName = node.property?.name;
          if (propName === 'length') t = TYPES.isize;
          else t = TYPES.str; // str method access — type refined at call site
        } else {
          t = TYPES.void;
        }
      }
      break;

    case 'ArrayExpression':
      for (const el of node.elements ?? []) {
        if (el) inferExpr(el, scope, signatures, classes, filename, ctx);
      }
      t = TYPES.array;
      break;

    case 'ThisExpression':
      t = ctx.currentClass ? ctx.currentClass.type : TYPES.void;
      break;

    case 'NewExpression':
      if (node.callee?.type === 'Identifier') {
        if (classes.has(node.callee.name)) {
          for (const arg of node.arguments ?? []) {
            inferExpr(arg, scope, signatures, classes, filename, ctx);
          }
          t = classes.get(node.callee.name).type;
        } else if (ctx.imports?.get(node.callee.name)?.module === 'std/collections') {
          t = TYPES[node.callee.name] ?? TYPES.void;
        } else {
          t = TYPES.void;
        }
      } else {
        t = TYPES.void;
      }
      break;

    default:
      t = TYPES.void;
      break;
  }

  node._type = t;
  return t;
}
