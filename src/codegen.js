/**
 * @fileoverview Typed AST → WAT text generator.
 * Requires `inferTypes` to have already annotated the AST with `_type` properties.
 */

import { TYPES, toWatType } from './types.js';
import { buildModule, buildFunction, memoryExport, param, local, result,
         localGet, localSet, i32Const, i64Const, f32Const, f64Const } from './wat.js';

/**
 * @typedef {import('./types.js').TypeInfo} TypeInfo
 * @typedef {import('./typecheck.js').FunctionSignature} FunctionSignature
 */

export class CodegenError extends Error {
  /** @param {string} msg */
  constructor(msg) { super(msg); this.name = 'CodegenError'; }
}

// ── Operator → WAT instruction ───────────────────────────────────────────────

/**
 * Return the WAT binary instruction for a JS operator given the operand type.
 * @param {string} op  JS operator string
 * @param {TypeInfo} typeInfo  type of the operands
 * @returns {string}
 */
function getBinOpInstruction(op, typeInfo) {
  if (!typeInfo || !typeInfo.wasmType) {
    throw new CodegenError(`No WAT type for operator '${op}' with type '${typeInfo?.name}'`);
  }
  const wt = typeInfo.wasmType;
  const isFloat = typeInfo.isFloat;
  const s = typeInfo.isSigned ? '_s' : '_u';

  if (op === '**') throw new CodegenError('exponentiation requires std/math (Phase 2)');

  switch (op) {
    case '+':   return `${wt}.add`;
    case '-':   return `${wt}.sub`;
    case '*':   return `${wt}.mul`;
    case '/':   return isFloat ? `${wt}.div`       : `${wt}.div${s}`;
    case '%':
      if (isFloat) throw new CodegenError('% is not supported for float types');
      return `${wt}.rem${s}`;
    case '===': return `${wt}.eq`;
    case '!==': return `${wt}.ne`;
    case '<':   return isFloat ? `${wt}.lt`        : `${wt}.lt${s}`;
    case '>':   return isFloat ? `${wt}.gt`        : `${wt}.gt${s}`;
    case '<=':  return isFloat ? `${wt}.le`        : `${wt}.le${s}`;
    case '>=':  return isFloat ? `${wt}.ge`        : `${wt}.ge${s}`;
    default:
      throw new CodegenError(`Unsupported operator '${op}'`);
  }
}

// ── Local collection ─────────────────────────────────────────────────────────

/**
 * Scan a function body for all VariableDeclarator nodes and collect them as
 * locals that must be declared at the top of the WAT function.
 * @param {object} body  BlockStatement node
 * @param {Array<{ name: string, type: TypeInfo }>} params  already declared params
 * @returns {Array<{ name: string, type: TypeInfo }>}
 */
export function collectLocals(body, params) {
  const paramNames = new Set(params.map(p => p.name));
  /** @type {Array<{ name: string, type: TypeInfo }>} */
  const locals = [];
  const seen = new Set(paramNames);

  /** @param {object} node */
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.name && node._type) {
      const name = node.id.name;
      if (!seen.has(name)) {
        seen.add(name);
        locals.push({ name, type: node._type });
      }
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && typeof item.type === 'string') visit(item);
        }
      } else if (child && typeof child === 'object' && typeof child.type === 'string') {
        visit(child);
      }
    }
  }

  visit(body);
  return locals;
}

// ── Expression code generation ───────────────────────────────────────────────

/**
 * Generate WAT instructions for an expression (stack-based postfix order).
 * @param {object} node
 * @param {string} filename
 * @returns {string[]}
 */
function genExpr(node, filename) {
  if (!node) return [];

  switch (node.type) {
    case 'Literal': {
      const type = node._type;
      if (!type || type === TYPES.void) {
        // Fallback: infer from value
        if (typeof node.value === 'number') {
          if (Number.isInteger(node.value)) return [i32Const(node.value)];
          return [f64Const(node.value)];
        }
        return [];
      }
      if (type.wasmType === 'i32') return [i32Const(node.value)];
      if (type.wasmType === 'i64') return [i64Const(node.value)];
      if (type.wasmType === 'f32') return [f32Const(node.value)];
      if (type.wasmType === 'f64') return [f64Const(node.value)];
      return [i32Const(node.value)];
    }

    case 'Identifier':
      return [localGet(node.name)];

    case 'BinaryExpression': {
      const leftInstrs  = genExpr(node.left,  filename);
      const rightInstrs = genExpr(node.right, filename);

      // Use the type of the left operand (both should be same after typecheck)
      const opType = node.left._type ?? node._type;
      const instr  = getBinOpInstruction(node.operator, opType);

      const instrs = [...leftInstrs, ...rightInstrs, instr];

      // Narrow-type masking after arithmetic for sub-32-bit integers
      if (opType && opType.isInteger && opType.bits > 0 && opType.bits < 32) {
        const mask = (1 << opType.bits) - 1;
        instrs.push(i32Const(mask), 'i32.and');
      }

      return instrs;
    }

    case 'UnaryExpression': {
      if (node.operator === '-') {
        // Negate: 0 - value  (WAT has no unary neg for integers)
        const argType = node.argument._type ?? TYPES.isize;
        const zero = argType.wasmType === 'f64' ? f64Const(0.0)
                   : argType.wasmType === 'f32' ? f32Const(0.0)
                   : i32Const(0);
        return [zero, ...genExpr(node.argument, filename), `${argType.wasmType}.sub`];
      }
      return genExpr(node.argument, filename);
    }

    case 'CallExpression': {
      const callee = node.callee;
      // Cast call: u8(x), i32(x), f64(x), etc.
      if (callee.type === 'Identifier') {
        const castTarget = TYPES[callee.name];
        if (castTarget && !castTarget.abstract) {
          const argInstrs = genExpr(node.arguments[0], filename);
          const srcType   = node.arguments[0]?._type;
          const convInstrs = genCastInstrs(srcType, castTarget);
          return [...argInstrs, ...convInstrs];
        }
      }
      throw new CodegenError(
        `Cannot generate code for call to '${callee.name ?? '(expr)'}' — not a known cast (${filename})`
      );
    }

    case 'ConditionalExpression': {
      // ternary: condition ? a : b
      const condInstrs = genExpr(node.test, filename);
      const thenInstrs = genExpr(node.consequent, filename);
      const elseInstrs = genExpr(node.alternate, filename);
      const resType    = toWatType(node._type);
      return [
        ...condInstrs,
        resType ? `if (result ${resType})` : 'if',
        ...thenInstrs.map(i => '  ' + i),
        'else',
        ...elseInstrs.map(i => '  ' + i),
        'end',
      ];
    }

    default:
      throw new CodegenError(
        `Unsupported expression node type '${node.type}' during code generation (${filename})`
      );
  }
}

/**
 * Generate conversion instructions between two concrete types.
 * Returns an empty array when no conversion is needed.
 * @param {TypeInfo|undefined} src
 * @param {TypeInfo} dst
 * @returns {string[]}
 */
function genCastInstrs(src, dst) {
  if (!src || src === dst) return [];
  // Same WASM type — may still need narrow-type masking
  if (src.wasmType === dst.wasmType) {
    // Mask sub-32-bit integers to their declared width (wrapping semantics)
    if (dst.isInteger && dst.bits > 0 && dst.bits < 32) {
      const mask = (1 << dst.bits) - 1;
      return [i32Const(mask), 'i32.and'];
    }
    return [];
  }
  // Integer → float conversions
  if (src.isInteger && dst.isFloat) {
    const srcWasm = src.wasmType;  // i32 or i64
    const dstWasm = dst.wasmType;  // f32 or f64
    const sign = src.isSigned ? '_s' : '_u';
    return [`${dstWasm}.convert_${srcWasm}${sign}`];
  }
  // Float → integer truncation
  if (src.isFloat && dst.isInteger) {
    const srcWasm = src.wasmType;
    const dstWasm = dst.wasmType;
    const sign = dst.isSigned ? '_s' : '_u';
    return [`${dstWasm}.trunc_${srcWasm}${sign}`];
  }
  // f32 ↔ f64
  if (src.wasmType === 'f32' && dst.wasmType === 'f64') return ['f64.promote_f32'];
  if (src.wasmType === 'f64' && dst.wasmType === 'f32') return ['f32.demote_f64'];
  return [];
}

// ── Statement code generation ─────────────────────────────────────────────────

/**
 * Generate WAT instructions for a statement.
 * @param {object} stmt
 * @param {TypeInfo|null} fnReturnType  inferred function return type
 * @param {string} filename
 * @returns {string[]}
 */
function genStatement(stmt, fnReturnType, filename) {
  if (!stmt) return [];

  switch (stmt.type) {
    case 'ReturnStatement': {
      if (!stmt.argument) return ['return'];
      return [...genExpr(stmt.argument, filename), 'return'];
    }

    case 'VariableDeclaration': {
      const instrs = [];
      for (const decl of stmt.declarations) {
        if (decl.init) {
          instrs.push(...genExpr(decl.init, filename));
          instrs.push(localSet(decl.id.name));
        }
      }
      return instrs;
    }

    case 'ExpressionStatement':
      return genExpr(stmt.expression, filename);

    case 'BlockStatement': {
      const instrs = [];
      for (const s of stmt.body) instrs.push(...genStatement(s, fnReturnType, filename));
      return instrs;
    }

    case 'IfStatement': {
      const condInstrs = genExpr(stmt.test, filename);
      const hasElse    = !!stmt.alternate;

      // Use a value-producing if/else block when the function has a return type
      // and all branches unconditionally return (handles else-if chains recursively).
      if (hasElse && fnReturnType && toWatType(fnReturnType) &&
          alwaysReturns(stmt.consequent) && alwaysReturns(stmt.alternate)) {
        const resType    = toWatType(fnReturnType);
        const thenInstrs = genBranchValue(stmt.consequent, fnReturnType, filename);
        const elseInstrs = genBranchValue(stmt.alternate,  fnReturnType, filename);
        return [
          ...condInstrs,
          `if (result ${resType})`,
          ...thenInstrs.map(i => '  ' + i),
          'else',
          ...elseInstrs.map(i => '  ' + i),
          'end',
          'return',
        ];
      }

      // Simple if (no result type needed — e.g. side-effects only, or void branch)
      const thenInstrs = blockBody(stmt.consequent)
        .flatMap(s => genStatement(s, fnReturnType, filename));
      if (hasElse) {
        const elseInstrs = blockBody(stmt.alternate)
          .flatMap(s => genStatement(s, fnReturnType, filename));
        return [
          ...condInstrs,
          'if',
          ...thenInstrs.map(i => '  ' + i),
          'else',
          ...elseInstrs.map(i => '  ' + i),
          'end',
        ];
      }
      return [
        ...condInstrs,
        'if',
        ...thenInstrs.map(i => '  ' + i),
        'end',
      ];
    }

    default:
      return [];
  }
}

/**
 * Get the statements inside a block or treat a single statement as a 1-element list.
 * @param {object|null} node
 * @returns {object[]}
 */
function blockBody(node) {
  if (!node) return [];
  if (node.type === 'BlockStatement') return node.body;
  return [node];
}

/**
 * True if a branch (block or statement) unconditionally returns in all code paths.
 * Handles `else if` chains by recursing into IfStatement alternates.
 * @param {object|null} node
 * @returns {boolean}
 */
function alwaysReturns(node) {
  if (!node) return false;
  const stmts = blockBody(node);
  if (stmts.length === 0) return false;
  const last = stmts[stmts.length - 1];
  if (last.type === 'ReturnStatement') return true;
  if (last.type === 'IfStatement' && last.alternate) {
    return alwaysReturns(last.consequent) && alwaysReturns(last.alternate);
  }
  return false;
}

/**
 * Generate value instructions for a branch that unconditionally returns.
 * Emits the VALUE only (no `return` instruction) so the result is left on the stack
 * inside a result-typed `if` block.  Handles nested `else if` chains recursively.
 * @param {object} node  branch node (BlockStatement or IfStatement)
 * @param {TypeInfo} fnReturnType
 * @param {string} filename
 * @returns {string[]}
 */
function genBranchValue(node, fnReturnType, filename) {
  const instrs = [];
  for (const s of blockBody(node)) {
    if (s.type === 'ReturnStatement') {
      instrs.push(...(s.argument ? genExpr(s.argument, filename) : []));
    } else if (s.type === 'IfStatement' && alwaysReturns(s)) {
      // Nested always-returning if — generate as a nested value-producing block
      const resType    = toWatType(fnReturnType);
      const condInstrs = genExpr(s.test, filename);
      const thenInstrs = genBranchValue(s.consequent, fnReturnType, filename);
      const elseInstrs = s.alternate
        ? genBranchValue(s.alternate, fnReturnType, filename)
        : [];
      instrs.push(...condInstrs);
      instrs.push(`if (result ${resType})`);
      for (const i of thenInstrs) instrs.push('  ' + i);
      if (elseInstrs.length > 0) {
        instrs.push('else');
        for (const i of elseInstrs) instrs.push('  ' + i);
      }
      instrs.push('end');
    } else {
      instrs.push(...genStatement(s, fnReturnType, filename));
    }
  }
  return instrs;
}

// ── Top-level WAT generation ─────────────────────────────────────────────────

/**
 * Generate a complete WAT module string from a type-annotated Program AST.
 * All top-level FunctionDeclarations are exported (Phase 1 convenience).
 *
 * @param {object} ast  type-annotated acorn Program AST
 * @param {Map<string, FunctionSignature>} signatures
 * @param {string} [filename='<input>']
 * @returns {string}  WAT module text
 */
export function generateWat(ast, signatures, filename = '<input>') {
  const functions = [];

  for (const node of ast.body) {
    if (node.type !== 'FunctionDeclaration') continue;
    functions.push(genFunction(node, signatures, filename));
  }

  return buildModule({
    memories:  [memoryExport(1)],
    functions,
  });
}

/**
 * Generate the WAT text for a single FunctionDeclaration.
 * @param {object} node
 * @param {Map<string, FunctionSignature>} signatures
 * @param {string} filename
 * @returns {string}
 */
function genFunction(node, signatures, filename) {
  const name = node.id.name;
  const sig  = signatures.get(name);
  if (!sig) throw new CodegenError(`No signature for function '${name}' (${filename})`);

  // Build param declarations
  const paramDecls = sig.params.map(p => param(p.name, toWatType(p.type)));

  // Collect locals (variable declarations inside the body)
  const localVars = collectLocals(node.body, sig.params);
  const localDecls = localVars.map(l => local(l.name, toWatType(l.type)));

  // Generate body instructions
  const returnType = sig.returnType;
  const body = node.body.body.flatMap(
    stmt => genStatement(stmt, returnType, filename)
  );

  return buildFunction({
    name,
    params:  paramDecls,
    result:  toWatType(returnType),
    locals:  localDecls,
    body,
    export: name,   // Phase 1: all top-level functions are exported by their JS name
  });
}
