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
    locals.push({ name: '__tmp',     type: TYPES.isize });
    locals.push({ name: '__tmp_f64', type: TYPES.f64 });
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
      if (node.value === null) return mod.i32.const(0); // null pointer
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
      if (node.operator === '!') {
        return mod.i32.eqz(genExpr(node.argument, filename, ctx));
      }
      return genExpr(node.argument, filename, ctx);
    }

    case 'CallExpression': {
      const callee = node.callee;
      // Cast call: u8(x), i32(x), f64(x), etc.
      if (callee.type === 'Super') {
        const parentName = ctx._currentClassInfo?.superClassName;
        if (!parentName) throw new CodegenError(`super() used without parent class (${filename})`);
        const parentCtorInfo = ctx._classes?.get(parentName)?.constructor;
        // If parent has no constructor, super() is a no-op
        if (!parentCtorInfo || parentCtorInfo._builtin) return mod.nop();
        const provided = node.arguments ?? [];
        const ctorParams = parentCtorInfo?.node.params ?? [];
        const argExprs = ctorParams.map((p, i) => {
          if (i < provided.length) return genExpr(provided[i], filename, ctx);
          return p.type === 'AssignmentPattern' ? genExpr(p.right, filename, ctx) : mod.i32.const(0);
        });
        return mod.call(`${parentName}__ctor`, [ctx.localGet('this'), ...argExprs], binaryen.none);
      }
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
        if (objType?.kind === 'array' && methodName) {
          const objExpr = genExpr(callee.object, filename, ctx);
          const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
          switch (methodName) {
            case 'push': return mod.call('__jswat_array_push', [objExpr, ...argExprs], binaryen.none);
            case 'pop':  return mod.call('__jswat_array_pop',  [objExpr], binaryen.i32);
            default: throw new CodegenError(`Unknown array method '${methodName}' (${filename})`);
          }
        }
        if (callee.object.type === 'Identifier' && methodName) {
          const ns = resolveStdNamespace(ctx._imports, callee.object.name, methodName);
          const def = resolveStdDefault(ctx._imports, callee.object.name, methodName);
          const std = ns ?? def;
          if (std) {
            const argExprs = node.arguments.map((arg, i) => {
              const expr = genExpr(arg, filename, ctx);
              const expected = std.params?.[i];
              const actual = arg._type;
              if (expected && actual && expected !== actual) return genCast(mod, expr, actual, expected);
              return expr;
            });
            const retType = node._type ? toBinType(node._type) : binaryen.none;
            return mod.call(std.stub, argExprs, retType);
          }
        }
        // Static method call: ClassName.method(args) — no 'this'
        if (className) {
          const ci = ctx._classes?.get(className);
          if (ci?.staticMethods?.has(methodName)) {
            const argExprs = node.arguments.map(arg => genExpr(arg, filename, ctx));
            const retType = node._type ? toBinType(node._type) : binaryen.none;
            return mod.call(`${className}__sm_${methodName}`, argExprs, retType);
          }
        }
        const objExpr = genExpr(callee.object, filename, ctx);
        if (!className || !methodName) {
          throw new CodegenError(`Unsupported method call (${filename})`);
        }
        const fnName = `${className}_${methodName}`;
        const methodSig = ctx._classes?.get(className)?.methods?.get(methodName)?.signature;
        const argExprs = node.arguments.map((arg, i) => {
          const expr = genExpr(arg, filename, ctx);
          const expectedType = methodSig?.params?.[i]?.type;
          if (!expectedType) return expr;
          const actualWt = binaryen.getExpressionType(expr);
          const expectedWt = toBinType(expectedType);
          if (actualWt !== expectedWt) return genCast(mod, expr, arg._type, expectedType);
          return expr;
        });
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
        // Static field assignment: ClassName.field = value
        const leftObjType = left.object?._type;
        if (!left.computed && leftObjType?.kind === 'class') {
          const ci = ctx._classes?.get(leftObjType.name);
          const fn = left.property?.name;
          if (ci && fn && ci.staticFields?.has(fn)) {
            const valueExpr = genExpr(node.right, filename, ctx);
            return mod.block(null, [
              ctx.localSet('__tmp', valueExpr),
              mod.global.set(`${leftObjType.name}__sf_${fn}`, ctx.localGet('__tmp')),
              ctx.localGet('__tmp'),
            ], binaryen.i32);
          }
        }
        if (node.operator !== '=') {
          // Compound assignment on instance field: load, op, store
          const field = resolveFieldAccess(left, ctx, filename);
          const objExpr = genExpr(left.object, filename, ctx);
          const op = node.operator.slice(0, -1);
          const currentVal = genLoad(mod, objExpr, field.type, field.offset);
          const rightExpr = genExpr(node.right, filename, ctx);
          const newVal = genBinOp(mod, op, field.type, currentVal, rightExpr);
          const binType = toBinType(field.type);
          const tmpName = (field.type.wasmType === 'f64') ? '__tmp_f64' : '__tmp';
          return mod.block(null, [
            ctx.localSet(tmpName, newVal),
            genStore(mod, genExpr(left.object, filename, ctx), ctx.localGet(tmpName), field.type, field.offset),
            ctx.localGet(tmpName),
          ], binType);
        }
        const field = resolveFieldAccess(left, ctx, filename);
        const objExpr = genExpr(left.object, filename, ctx);
        const rawValueExpr = genExpr(node.right, filename, ctx);
        // Auto-cast if right-side type differs from field type (e.g. Math.max f64 into i32 field)
        const rightType = node.right._type;
        const valueExpr = (rightType && rightType !== field.type)
          ? genCast(mod, rawValueExpr, rightType, field.type)
          : rawValueExpr;
        const binType = toBinType(field.type);
        const tmpName = (field.type.wasmType === 'f64') ? '__tmp_f64' : '__tmp';
        return mod.block(null, [
          ctx.localSet(tmpName, valueExpr),
          genStore(mod, objExpr, ctx.localGet(tmpName), field.type, field.offset),
          ctx.localGet(tmpName),
        ], binType);
      }
      throw new CodegenError(`Unsupported assignment target (${filename})`);
    }

    case 'UpdateExpression': {
      const arg = node.argument;
      const addOp = node.operator === '++' ? 'add' : 'sub';

      if (arg.type === 'MemberExpression') {
        // UpdateExpression on an instance field: load, inc/dec, store
        const field = resolveFieldAccess(arg, ctx, filename);
        const t = field.type;
        const wt = t.wasmType ?? 'i32';
        const one = wt === 'i64' ? mod.i64.const(1, 0) : wt === 'f64' ? mod.f64.const(1) : mod.i32.const(1);
        const tmpName = wt === 'f64' ? '__tmp_f64' : '__tmp';
        const oldVal  = genLoad(mod, genExpr(arg.object, filename, ctx), t, field.offset);
        const newVal  = maybeNarrow(mod, mod[wt][addOp](oldVal, one), t);
        if (node.prefix) {
          return mod.block(null, [
            ctx.localSet(tmpName, newVal),
            genStore(mod, genExpr(arg.object, filename, ctx), ctx.localGet(tmpName), t, field.offset),
            ctx.localGet(tmpName),
          ], toBinType(t));
        }
        // postfix: return old, then store new
        const oldValSaved = genLoad(mod, genExpr(arg.object, filename, ctx), t, field.offset);
        return mod.block(null, [
          ctx.localSet(tmpName, oldValSaved),
          genStore(mod, genExpr(arg.object, filename, ctx), mod[wt][addOp](ctx.localGet(tmpName), one), t, field.offset),
          ctx.localGet(tmpName),
        ], toBinType(t));
      }

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
      // Static field/getter access: ClassName.field or ClassName.#field
      if (!node.computed && objType?.kind === 'class') {
        const ci = ctx._classes?.get(objType.name);
        const fn = node.property?.name;
        if (ci && fn) {
          if (ci.staticFields?.has(fn)) {
            const sfType = ci.staticFields.get(fn);
            return mod.global.get(`${objType.name}__sf_${fn}`, toBinType(sfType));
          }
          if (ci.staticGetters?.has(fn)) {
            const retType = ci.staticGetters.get(fn).signature.returnType;
            return mod.call(`${objType.name}__sg_${fn}`, [], toBinType(retType));
          }
          // Instance getter access on a class instance — call as method
          // Only for public Identifiers (not PrivateIdentifier which are field accesses)
          if (node.property?.type !== 'PrivateIdentifier' && ci.methods?.has(fn)) {
            const method = ci.methods.get(fn);
            const retType = method.signature?.returnType ?? TYPES.isize;
            const objExpr = genExpr(node.object, filename, ctx);
            return mod.call(`${objType.name}_${fn}`, [objExpr], toBinType(retType));
          }
        }
      }
      // Struct field read
      const field = resolveFieldAccess(node, ctx, filename);
      const base = genExpr(node.object, filename, ctx);
      return genLoad(mod, base, field.type, field.offset);
    }

    case 'NewExpression': {
      if (node.callee?.type === 'Identifier') {
        const className = node.callee.name;
        // User-defined classes take priority over stdlib collections
        const layout = ctx._layouts.get(className);
        if (!layout) {
          const ctor = resolveStdCollectionCtor(className);
          if (ctor) {
            return mod.call(ctor, [], binaryen.i32);
          }
        }
        if (!layout) throw new CodegenError(`Unknown class '${className}' (${filename})`);
        const ctorInfo = ctx._classes?.get(className)?.constructor ?? null;
        if (ctorInfo) {
          const ctorName = `${className}__ctor`;
          const provided = node.arguments ?? [];
          const ctorParams = ctorInfo.node.params ?? [];
          const argExprs = ctorParams.map((p, i) => {
            if (i < provided.length) return genExpr(provided[i], filename, ctx);
            return p.type === 'AssignmentPattern' ? genExpr(p.right, filename, ctx) : mod.i32.const(0);
          });
          const classId = layout.classId ?? 1;
          return mod.block(null, [
            ctx.localSet('__tmp', mod.call('__alloc', [mod.i32.const(layout.size)], binaryen.i32)),
            mod.i32.store(0, 0, ctx.localGet('__tmp'), mod.i32.const(classId)),
            mod.call(ctorName, [ctx.localGet('__tmp'), ...argExprs], binaryen.none),
            ctx.localGet('__tmp'),
          ], binaryen.i32);
        }
        const classId = layout.classId ?? 1;
        return mod.block(null, [
          ctx.localSet('__tmp', mod.call('__alloc', [mod.i32.const(layout.size)], binaryen.i32)),
          mod.i32.store(0, 0, ctx.localGet('__tmp'), mod.i32.const(classId)),
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
        let valExpr = el ? genExpr(el, filename, ctx) : mod.i32.const(0);
        // Arrays store i32; coerce float elements to i32 bits via reinterpret
        if (el && binaryen.getExpressionType(valExpr) === binaryen.f64) {
          valExpr = mod.i32.reinterpret(mod.f32.demote(valExpr));
        } else if (el && binaryen.getExpressionType(valExpr) === binaryen.f32) {
          valExpr = mod.i32.reinterpret(valExpr);
        }
        stmts.push(mod.call('__jswat_array_set', [
          ctx.localGet('__tmp'),
          mod.i32.const(i),
          valExpr,
        ], binaryen.none));
      }
      stmts.push(mod.i32.store(4, 0, ctx.localGet('__tmp'), mod.i32.const(count)));
      stmts.push(ctx.localGet('__tmp'));
      return mod.block(null, stmts, binaryen.i32);
    }

    case 'TemplateLiteral': {
      // Build a string by concatenating quasis and expressions
      // quasis[0] expr[0] quasis[1] expr[1] ... quasis[n]
      const quasis = node.quasis ?? [];
      const exprs  = node.expressions ?? [];
      // Start with the first quasi (static string)
      const firstCooked = quasis[0]?.value?.cooked ?? '';
      const firstAddr = ctx._strings?.get(firstCooked);
      let result = firstAddr !== undefined
        ? mod.i32.const(firstAddr)
        : mod.i32.const(ctx._strings?.get('') ?? 8); // empty string fallback

      for (let i = 0; i < exprs.length; i++) {
        const exprRef = genExpr(exprs[i], filename, ctx);
        const exprType = exprs[i]._type;
        // Coerce non-string expression to str
        let strExpr;
        if (exprType?.kind === 'str' || exprType?.name === 'str') {
          strExpr = exprRef;
        } else {
          // Integer → string conversion
          strExpr = mod.call('__jswat_string_from_i32', [exprRef], binaryen.i32);
        }
        result = mod.call('__jswat_str_concat', [result, strExpr], binaryen.i32);
        // Append the next quasi
        const nextCooked = quasis[i + 1]?.value?.cooked ?? '';
        if (nextCooked.length > 0) {
          const nextAddr = ctx._strings?.get(nextCooked);
          if (nextAddr !== undefined) {
            result = mod.call('__jswat_str_concat', [result, mod.i32.const(nextAddr)], binaryen.i32);
          }
        }
      }
      return result;
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
