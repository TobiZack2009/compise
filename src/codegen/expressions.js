/**
 * @fileoverview Expression code generation (binaryen IR).
 */

import binaryen from 'binaryen';
import { TYPES } from '../types.js';
import { resolveStdFunction, resolveStdNamespace, resolveStdDefault, resolveStdCollectionMethod, resolveStdCollectionCtor } from '../std.js';
import { CodegenError, toBinType } from './context.js';
import { genBinOp, genCast, maybeNarrow, genLoad, genStore, resolveFieldType } from './types.js';

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
  let needsTmp = false;
  let forOfCounter = 0;

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
    if (node.type === 'NewExpression' || node.type === 'ArrayExpression') needsTmp = true;
    if (node.type === 'MemberExpression' && node.computed) needsTmp = true;
    if (node.type === 'UpdateExpression' && !node.prefix) needsTmp = true;
    if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression') needsTmp = true;
    if (node.type === 'ForOfStatement') {
      const id = forOfCounter++;
      node._forOfId = id;
      const names = [
        `__forof_start_${id}`,
        `__forof_end_${id}`,
        `__forof_step_${id}`,
        `__forof_i_${id}`,
        `__forof_iter_${id}`,
        `__forof_result_${id}`,
      ];
      for (const name of names) {
        if (!seen.has(name)) {
          seen.add(name);
          locals.push({ name, type: TYPES.isize });
        }
      }
    }
    if (node.type === 'ThisExpression') {
      if (!seen.has('this')) {
        seen.add('this');
        locals.push({ name: 'this', type: TYPES.isize });
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
  if (needsTmp && !seen.has('__tmp')) {
    locals.push({ name: '__tmp', type: TYPES.isize });
  }
  return locals;
}

// ── Expression code generation ───────────────────────────────────────────────

/**
 * Emit a std/wasm intrinsic call.
 * @param {string} fnName
 * @param {object[]} args
 * @param {string} filename
 * @param {GenContext} ctx
 * @returns {number} ExpressionRef
 */
export function genWasmIntrinsicCall(fnName, args, filename, ctx) {
  const mod = ctx.mod;
  const isLoad = fnName.includes('_load');
  const isStore = fnName.includes('_store');

  // Split on first underscore to get type prefix vs operation
  const underscoreIdx = fnName.indexOf('_');
  const wt = fnName.slice(0, underscoreIdx);     // e.g. 'i32', 'i64', 'f32', 'f64'
  const methodName = fnName.slice(underscoreIdx + 1); // e.g. 'load', 'load8_u', 'store', 'store8'

  if (isLoad || isStore) {
    const addrExpr = genExpr(args[0], filename, ctx);
    const offsetExpr = args[1] ? genExpr(args[1], filename, ctx) : mod.i32.const(0);
    const ptrExpr = mod.i32.add(addrExpr, offsetExpr);
    if (isLoad) {
      return mod[wt][methodName](0, 0, ptrExpr);
    }
    const valueExpr = args[2] ? genExpr(args[2], filename, ctx) : mod.i32.const(0);
    return mod[wt][methodName](0, 0, ptrExpr, valueExpr);
  }

  // Generic intrinsic (e.g. i32_clz -> mod.i32.clz)
  const argExprs = args.map(arg => genExpr(arg, filename, ctx));
  return mod[wt][methodName](...argExprs);
}

/**
 * Resolve a field access into offset and field type.
 * @param {object} node  MemberExpression
 * @param {GenContext} ctx
 * @param {string} filename
 * @returns {{ offset: number, type: TypeInfo }}
 */
export function resolveFieldAccess(node, ctx, filename) {
  const objType = node.object?._type;
  const className = objType?.kind === 'class' ? objType.name : null;
  const fieldName = node.property?.name;
  if (!className || !fieldName) {
    throw new CodegenError(`Unsupported field access (${filename})`);
  }
  const layout = ctx._layouts.get(className);
  if (!layout || !layout.fields.has(fieldName)) {
    throw new CodegenError(`Unknown field '${className}.${fieldName}' (${filename})`);
  }
  const field = layout.fields.get(fieldName);
  return { offset: field.offset, type: field.type };
}

/**
 * Generate a binaryen ExpressionRef for an expression node.
 * @param {object} node
 * @param {string} filename
 * @param {GenContext} ctx
 * @returns {number} ExpressionRef
 */
export function genExpr(node, filename, ctx) {
  if (!node) return ctx.mod.nop();

  const mod = ctx.mod;

  switch (node.type) {
    case 'Literal': {
      const type = node._type;
      if (type?.name === 'str' && typeof node.value === 'string') {
        const addr = ctx._strings?.get(node.value);
        if (addr === undefined) throw new CodegenError(`Unmapped string literal (${filename})`);
        return mod.i32.const(addr);
      }
      if (!type || type === TYPES.void) {
        if (typeof node.value === 'number') {
          if (Number.isInteger(node.value)) return mod.i32.const(node.value);
          return mod.f64.const(node.value);
        }
        return mod.nop();
      }
      if (type.wasmType === 'i32') return mod.i32.const(node.value);
      if (type.wasmType === 'i64') {
        const lo = node.value & 0xffffffff;
        const hi = Math.floor(node.value / 0x100000000);
        return mod.i64.const(lo, hi);
      }
      if (type.wasmType === 'f32') return mod.f32.const(node.value);
      if (type.wasmType === 'f64') return mod.f64.const(node.value);
      return mod.i32.const(node.value);
    }

    case 'Identifier':
      if (node._fnRef && ctx._fnTableMap?.has(node._fnRef)) {
        return mod.i32.const(ctx._fnTableMap.get(node._fnRef));
      }
      return ctx.localGet(node.name);

    case 'BinaryExpression': {
      const left = genExpr(node.left, filename, ctx);
      const right = genExpr(node.right, filename, ctx);
      const opType = node.left._type ?? node._type;
      let expr = genBinOp(mod, node.operator, opType, left, right);
      if (opType?.isInteger && opType.bits > 0 && opType.bits < 32) {
        expr = mod.i32.and(expr, mod.i32.const((1 << opType.bits) - 1));
      }
      return expr;
    }

    case 'UnaryExpression': {
      if (node.operator === '-') {
        const argType = node.argument._type ?? TYPES.isize;
        const zero = argType.wasmType === 'f64' ? mod.f64.const(0)
                   : argType.wasmType === 'f32' ? mod.f32.const(0)
                   : mod.i32.const(0);
        return mod[argType.wasmType].sub(zero, genExpr(node.argument, filename, ctx));
      }
      return genExpr(node.argument, filename, ctx);
    }

    case 'CallExpression': {
      const callee = node.callee;
      // Cast call: u8(x), i32(x), f64(x), etc.
      if (callee.type === 'Identifier') {
        const castTarget = TYPES[callee.name];
        if (castTarget && !castTarget.abstract) {
          const argExpr = genExpr(node.arguments[0], filename, ctx);
          const srcType = node.arguments[0]?._type;
          return genCast(mod, argExpr, srcType, castTarget);
        }
        const stdFn = resolveStdFunction(ctx._imports, callee.name);
        if (stdFn?.intrinsic) {
          return genWasmIntrinsicCall(callee.name, node.arguments, filename, ctx);
        }
        if (stdFn?.stub) {
          const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
          const retType = node._type ? toBinType(node._type) : binaryen.none;
          return mod.call(stdFn.stub, argExprs, retType);
        }
        if (node._callIndirect) {
          const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
          const idxExpr = genExpr(callee, filename, ctx);
          const arity = node.arguments.length;
          // Build param type for call_indirect
          const paramType = binaryen.createType(new Array(arity).fill(binaryen.i32));
          return mod.call_indirect('0', idxExpr, argExprs, paramType, binaryen.i32);
        }
        const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
        const retType = node._type ? toBinType(node._type) : binaryen.none;
        return mod.call(callee.name, argExprs, retType);
      }
      if (callee.type === 'MemberExpression') {
        const methodName = callee.property?.name;
        const objType = callee.object?._type;
        const className = objType?.kind === 'class' ? objType.name : null;

        if (callee.object.type === 'Identifier' && methodName) {
          if (callee.object.name === 'memory' && (methodName === 'copy' || methodName === 'fill')) {
            const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
            if (methodName === 'copy') return mod.memory.copy(argExprs[0], argExprs[1], argExprs[2]);
            return mod.memory.fill(argExprs[0], argExprs[1], argExprs[2]);
          }
          if (['i32','i64','f32','f64'].includes(callee.object.name)) {
            const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
            // load/store need (align, offset, ptr[, value]) prepended
            const isLoadStore = methodName === 'load' || methodName === 'store' ||
              methodName.startsWith('load') || methodName.startsWith('store');
            if (isLoadStore) return mod[callee.object.name][methodName](0, 0, ...argExprs);
            return mod[callee.object.name][methodName](...argExprs);
          }
        }
        if (node._callIndirect) {
          const idxExpr = genExpr(callee, filename, ctx);
          const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
          const arity = node.arguments.length;
          const paramType = binaryen.createType(new Array(arity).fill(binaryen.i32));
          return mod.call_indirect('0', idxExpr, argExprs, paramType, binaryen.i32);
        }
        if (objType?.kind === 'array' && methodName === 'push') {
          const objExpr = genExpr(callee.object, filename, ctx);
          const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
          const retType = node._type ? toBinType(node._type) : binaryen.i32;
          return mod.call('__jswat_array_push', [objExpr, ...argExprs], retType);
        }
        if (objType?.kind === 'collection' && methodName) {
          const std = resolveStdCollectionMethod(objType.name, methodName);
          if (std) {
            const objExpr = genExpr(callee.object, filename, ctx);
            const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
            const retType = node._type ? toBinType(node._type) : binaryen.none;
            return mod.call(std.stub, [objExpr, ...argExprs], retType);
          }
        }
        if (objType?.kind === 'iter' && methodName) {
          const objExpr = genExpr(callee.object, filename, ctx);
          const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
          switch (methodName) {
            case 'map':    return mod.call('__jswat_iter_map',     [objExpr, ...argExprs], binaryen.i32);
            case 'filter': return mod.call('__jswat_iter_filter',  [objExpr, ...argExprs], binaryen.i32);
            case 'take':   return mod.call('__jswat_iter_take',    [objExpr, ...argExprs], binaryen.i32);
            case 'collect':return mod.call('__jswat_iter_collect', [objExpr], binaryen.i32);
            case 'count':  return mod.call('__jswat_iter_count',   [objExpr], binaryen.i32);
            case 'forEach':return mod.call('__jswat_iter_for_each',[objExpr, ...argExprs], binaryen.none);
            default: throw new CodegenError(`Unknown iter method '${methodName}' (${filename})`);
          }
        }
        if (objType?.kind === 'str' && methodName) {
          const objExpr = genExpr(callee.object, filename, ctx);
          const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
          switch (methodName) {
            case 'slice':      return mod.call('__jswat_str_slice',       [objExpr, ...argExprs], binaryen.i32);
            case 'indexOf':    return mod.call('__jswat_str_index_of',    [objExpr, ...argExprs], binaryen.i32);
            case 'concat':     return mod.call('__jswat_str_concat',      [objExpr, ...argExprs], binaryen.i32);
            case 'charAt':     return mod.call('__jswat_str_char_at',     [objExpr, ...argExprs], binaryen.i32);
            case 'startsWith': return mod.call('__jswat_str_starts_with', [objExpr, ...argExprs], binaryen.i32);
            case 'endsWith':   return mod.call('__jswat_str_ends_with',   [objExpr, ...argExprs], binaryen.i32);
            case 'includes':   return mod.i32.ge_s(
                                 mod.call('__jswat_str_index_of', [objExpr, ...argExprs], binaryen.i32),
                                 mod.i32.const(0));
            case 'equals':     return mod.call('__jswat_str_equals',      [objExpr, ...argExprs], binaryen.i32);
            default: throw new CodegenError(`Unknown str method '${methodName}' (${filename})`);
          }
        }
        if (callee.object.type === 'Identifier' && methodName) {
          const ns = resolveStdNamespace(ctx._imports, callee.object.name, methodName);
          const def = resolveStdDefault(ctx._imports, callee.object.name, methodName);
          const std = ns ?? def;
          if (std) {
            const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
            const retType = node._type ? toBinType(node._type) : binaryen.none;
            return mod.call(std.stub, argExprs, retType);
          }
        }
        const objExpr = genExpr(callee.object, filename, ctx);
        if (!className || !methodName) {
          throw new CodegenError(`Unsupported method call (${filename})`);
        }
        const fnName = `${className}_${methodName}`;
        const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
        const retType = node._type ? toBinType(node._type) : binaryen.none;
        return mod.call(fnName, [objExpr, ...argExprs], retType);
      }
      throw new CodegenError(
        `Cannot generate code for call to '${callee.name ?? '(expr)'}' — not a known cast (${filename})`
      );
    }

    case 'LogicalExpression': {
      const left = genExpr(node.left, filename, ctx);
      const right = genExpr(node.right, filename, ctx);
      if (node.operator === '&&')
        return mod.if(left, right, mod.i32.const(0));
      if (node.operator === '||')
        return mod.if(left, mod.i32.const(1), right);
      throw new CodegenError(`Unsupported logical operator '${node.operator}'`);
    }

    case 'AssignmentExpression': {
      const left = node.left;
      if (left.type === 'Identifier') {
        const name = left.name;
        const leftType = left._type ?? node._type;
        const rightExpr = genExpr(node.right, filename, ctx);
        if (node.operator === '=') {
          return ctx.localTee(name, rightExpr);
        }
        const op = node.operator.slice(0, -1);
        let expr = genBinOp(mod, op, leftType, ctx.localGet(name), rightExpr);
        expr = maybeNarrow(mod, expr, leftType);
        return ctx.localTee(name, expr);
      }
      if (left.type === 'MemberExpression') {
        if (left.computed && left.object?._type?.kind === 'array') {
          if (node.operator !== '=') {
            throw new CodegenError(`Compound assignments on array elements not supported yet (${filename})`);
          }
          const objExpr = genExpr(left.object, filename, ctx);
          const idxExpr = genExpr(left.property, filename, ctx);
          const valueExpr = genExpr(node.right, filename, ctx);
          return mod.block(null, [
            ctx.localSet('__tmp', valueExpr),
            mod.call('__jswat_array_set', [objExpr, idxExpr, ctx.localGet('__tmp')], binaryen.none),
            ctx.localGet('__tmp'),
          ], binaryen.i32);
        }
        if (node.operator !== '=') {
          throw new CodegenError(`Compound assignments on fields not supported yet (${filename})`);
        }
        const field = resolveFieldAccess(left, ctx, filename);
        const objExpr = genExpr(left.object, filename, ctx);
        const valueExpr = genExpr(node.right, filename, ctx);
        const binType = toBinType(field.type);
        return mod.block(null, [
          ctx.localSet('__tmp', valueExpr),
          genStore(mod, objExpr, ctx.localGet('__tmp'), field.type, field.offset),
          ctx.localGet('__tmp'),
        ], binType);
      }
      throw new CodegenError(`Unsupported assignment target (${filename})`);
    }

    case 'UpdateExpression': {
      const arg = node.argument;
      if (arg.type !== 'Identifier') {
        throw new CodegenError(`Only simple update expressions on locals are supported (${filename})`);
      }
      const name = arg.name;
      const t = arg._type ?? TYPES.isize;
      const wt = t.wasmType;
      const one = wt === 'i64' ? mod.i64.const(1, 0)
                : wt === 'f32' ? mod.f32.const(1)
                : wt === 'f64' ? mod.f64.const(1)
                : mod.i32.const(1);
      const addOp = node.operator === '++' ? 'add' : 'sub';
      const newVal = maybeNarrow(mod, mod[wt][addOp](ctx.localGet(name), one), t);
      if (node.prefix) {
        return ctx.localTee(name, newVal);
      }
      // postfix: return old value, set new value
      return mod.block(null, [
        ctx.localSet('__tmp', ctx.localGet(name)),
        ctx.localSet(name, newVal),
        ctx.localGet('__tmp'),
      ], binaryen.i32);
    }

    case 'ConditionalExpression':
      return mod.if(
        genExpr(node.test, filename, ctx),
        genExpr(node.consequent, filename, ctx),
        genExpr(node.alternate, filename, ctx)
      );

    case 'ThisExpression':
      return ctx.localGet('this');

    case 'MemberExpression': {
      const objType = node.object?._type;
      if (node.computed && objType?.kind === 'array') {
        return mod.call('__jswat_array_get', [
          genExpr(node.object, filename, ctx),
          genExpr(node.property, filename, ctx),
        ], binaryen.i32);
      }
      if (!node.computed && objType?.kind === 'array' && node.property?.name === 'length') {
        return mod.call('__jswat_array_length', [genExpr(node.object, filename, ctx)], binaryen.i32);
      }
      if (!node.computed && objType?.kind === 'str' && node.property?.name === 'length') {
        return mod.i32.load(0, 0, genExpr(node.object, filename, ctx));
      }
      // Struct field read
      const field = resolveFieldAccess(node, ctx, filename);
      const base = genExpr(node.object, filename, ctx);
      return genLoad(mod, base, field.type, field.offset);
    }

    case 'NewExpression': {
      if (node.callee?.type === 'Identifier') {
        const className = node.callee.name;
        const ctor = resolveStdCollectionCtor(className);
        if (ctor) {
          return mod.call(ctor, [], binaryen.i32);
        }
        const layout = ctx._layouts.get(className);
        if (!layout) throw new CodegenError(`Unknown class '${className}' (${filename})`);
        const ctorInfo = ctx._classes?.get(className)?.constructor ?? null;
        if (ctorInfo) {
          const ctorName = `${className}__ctor`;
          const argExprs = (node.arguments ?? []).map(arg => genExpr(arg, filename, ctx));
          return mod.block(null, [
            ctx.localSet('__tmp', mod.call('__alloc', [mod.i32.const(layout.size)], binaryen.i32)),
            mod.i32.store(0, 0, ctx.localGet('__tmp'), mod.i32.const(1)),
            mod.call(ctorName, [ctx.localGet('__tmp'), ...argExprs], binaryen.none),
            ctx.localGet('__tmp'),
          ], binaryen.i32);
        }
        return mod.block(null, [
          ctx.localSet('__tmp', mod.call('__alloc', [mod.i32.const(layout.size)], binaryen.i32)),
          mod.i32.store(0, 0, ctx.localGet('__tmp'), mod.i32.const(1)),
          ctx.localGet('__tmp'),
        ], binaryen.i32);
      }
      throw new CodegenError(`Unsupported new expression (${filename})`);
    }

    case 'ArrayExpression': {
      const elements = node.elements ?? [];
      const count = elements.length;
      const cap = Math.max(4, count);
      const stmts = [
        ctx.localSet('__tmp', mod.call('__jswat_array_new', [mod.i32.const(cap)], binaryen.i32)),
      ];
      for (let i = 0; i < count; i++) {
        const el = elements[i];
        stmts.push(mod.call('__jswat_array_set', [
          ctx.localGet('__tmp'),
          mod.i32.const(i),
          el ? genExpr(el, filename, ctx) : mod.i32.const(0),
        ], binaryen.none));
      }
      stmts.push(mod.i32.store(4, 0, ctx.localGet('__tmp'), mod.i32.const(count)));
      stmts.push(ctx.localGet('__tmp'));
      return mod.block(null, stmts, binaryen.i32);
    }

    default:
      throw new CodegenError(
        `Unsupported expression node type '${node.type}' during code generation (${filename})`
      );
  }
}

/**
 * Generate expression and drop the result if it is non-void.
 * @param {object} expr
 * @param {string} filename
 * @param {GenContext} ctx
 * @returns {number} ExpressionRef
 */
export function genExprStatement(expr, filename, ctx) {
  const exprRef = genExpr(expr, filename, ctx);
  const exprType = expr?._type;
  if (exprType && exprType !== TYPES.void && exprType.kind !== 'void')
    return ctx.mod.drop(exprRef);
  return exprRef;
}
