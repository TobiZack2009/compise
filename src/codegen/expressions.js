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
 * @param {import('../types.js').TypeInfo|null} [returnType]  function return type (used to type __result)
 * @returns {Array<{ name: string, type: TypeInfo }>}
 */
export function collectLocals(body, params, returnType = null) {
  const paramNames = new Set(params.map(p => p.name));
  /** @type {Array<{ name: string, type: TypeInfo }>} */
  const locals = [];
  const seen = new Set(paramNames);
  let needsTmp = false;
  let needsStrScratch = false;
  let forOfCounter = 0;

  /** @param {object} node */
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id?.name && node._type) {
      const name = node.id.name;
      if (!seen.has(name)) {
        seen.add(name);
        locals.push({ name, type: node._type });
        // Each str-typed local gets a shadow `name__len` local for the fat pointer len.
        if (node._type?.kind === 'str') {
          seen.add(name + '__len');
          locals.push({ name: name + '__len', type: TYPES.isize });
          needsStrScratch = true;
        }
      }
    }
    if (node.type === 'NewExpression' || node.type === 'ArrayExpression') needsTmp = true;
    if (node.type === 'MemberExpression' && node.computed) needsTmp = true;
    if (node.type === 'UpdateExpression' && !node.prefix) needsTmp = true;
    if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression') needsTmp = true;
    // str field read: needs __tmp to save object ptr for double load (ptr + len)
    if (node.type === 'MemberExpression' && !node.computed && node._type?.kind === 'str') needsTmp = true;
    // str field write: needs both __tmp (object ptr) and __str_tmp/__str_tmp__len (str ptr/len)
    if (node.type === 'AssignmentExpression' && node.left?.type === 'MemberExpression' &&
        node.left?._type?.kind === 'str') { needsTmp = true; needsStrScratch = true; }
    // Detect str-producing operations that require the scratch pair
    if (node.type === 'TemplateLiteral') needsStrScratch = true;
    // Cast of str from function call: isize(fn_returning_str()) needs __tmp + __str_tmp to free the buffer
    if (node.type === 'CallExpression' &&
        node.callee?.type === 'Identifier' &&
        TYPES[node.callee.name] && !TYPES[node.callee.name]?.abstract &&
        node.arguments?.[0]?.type === 'CallExpression' &&
        node.arguments[0]?._type?.kind === 'str') {
      needsTmp = true;
      needsStrScratch = true;
    }
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

  // Also flag str scratch if any str-typed params exist
  for (const p of params) {
    if (p.type?.kind === 'str') needsStrScratch = true;
  }

  visit(body);
  if (needsTmp && !seen.has('__tmp')) {
    locals.push({ name: '__tmp',     type: TYPES.isize });
    locals.push({ name: '__tmp_f64', type: TYPES.f64 });
  }
  // Str scratch pair: used as accumulator for TemplateLiteral and complex str sub-expressions.
  if (needsStrScratch && !seen.has('__str_tmp')) {
    seen.add('__str_tmp');
    seen.add('__str_tmp__len');
    locals.push({ name: '__str_tmp',     type: TYPES.isize });
    locals.push({ name: '__str_tmp__len', type: TYPES.isize });
  }

  // Collect heap-typed locals (class/array) for RC management.
  // str is a value-type fat pointer — NOT heap-managed.
  const heapLocals = new Map();
  for (const { name, type } of locals) {
    if (type?.kind === 'class' || type?.kind === 'array') {
      heapLocals.set(name, type);
    }
  }

  // Add __result local for the result-save pattern used at ReturnStatement cleanup.
  // Type it to match the function return type so we can save non-i32 return values.
  if (heapLocals.size > 0 && !seen.has('__result')) {
    seen.add('__result');
    const rWasm = returnType?.wasmType ?? '';
    const resultType = rWasm === 'f64' ? TYPES.f64
                     : rWasm === 'i64' ? TYPES.i64
                     : TYPES.isize;
    locals.push({ name: '__result', type: resultType });
  }

  return { locals, heapLocals };
}

// ── RC header helpers ─────────────────────────────────────────────────────────

const RC_SIZE_CLASSES = [8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

/** Returns size-class index (0-9) for the given allocation size, or 10 for large. */
function sizeClassIdx(size) {
  for (let i = 0; i < RC_SIZE_CLASSES.length; i++) if (size <= RC_SIZE_CLASSES[i]) return i;
  return 10;
}

/** Compute initial rc_class word: bits[31:28]=sizeClassIdx, bits[27:0]=1 (initial rc). */
function computeRcClassInit(size) { return (sizeClassIdx(size) << 28) | 1; }

// ── Str fat-pointer helpers ───────────────────────────────────────────────────

/**
 * Generate both halves of a str fat pointer for a str-typed expression node.
 *
 * Convention:
 *  - Literal string  → (i32.const dataAddr,   i32.const byteLen)      (compile-time constants)
 *  - Identifier str  → (localGet(name),        localGet(name + '__len'))
 *  - Any other expr  → (genExpr(node),         global.get('__str_len_out'))
 *    The third case relies on str-returning runtime functions setting __str_len_out
 *    before returning the ptr.  Since WASM evaluates args left-to-right, by the
 *    time lenRef is consumed the call has already set the global.
 *
 * @param {object} node  str-typed AST expression
 * @param {string} filename
 * @param {import('./context.js').GenContext} ctx
 * @returns {[number, number]}  [ptrRef, lenRef]  (both ExpressionRef)
 */
export function genStrExprAsPair(node, filename, ctx) {
  const mod = ctx.mod;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    const info = ctx._strings?.get(node.value);
    if (!info) throw new CodegenError(`Unmapped string literal (${filename})`);
    return [mod.i32.const(info.ptr), mod.i32.const(info.len)];
  }
  if (node.type === 'Identifier' && node._type?.kind === 'str') {
    return [ctx.localGet(node.name), ctx.localGet(node.name + '__len')];
  }
  // Complex expression — evaluate via genExpr, which sets __str_len_out as a side-effect.
  const ptrRef = genExpr(node, filename, ctx);
  return [ptrRef, mod.global.get('__str_len_out', binaryen.i32)];
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
        const info = ctx._strings?.get(node.value);
        if (!info) throw new CodegenError(`Unmapped string literal (${filename})`);
        // Publish the len to __str_len_out so callers using genStrExprAsPair's
        // "complex" path (which reads the global) also get the correct len.
        // The block returns the ptr as its value.
        return mod.block(null, [
          mod.global.set('__str_len_out', mod.i32.const(info.len)),
          mod.i32.const(info.ptr),
        ], binaryen.i32);
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
      // For str locals, publish len to __str_len_out so callers (genCast, etc.) can read it
      if (node._type?.kind === 'str') {
        return mod.block(null, [
          mod.global.set('__str_len_out', ctx.localGet(node.name + '__len')),
          ctx.localGet(node.name),
        ], binaryen.i32);
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
        const argExprs = [];
        for (let ci = 0; ci < ctorParams.length; ci++) {
          const cp = ctorParams[ci];
          const cpType = cp.type === 'AssignmentPattern' ? (cp.left?._type ?? cp._type) : cp._type;
          const cpIsStr = cpType?.kind === 'str';
          if (ci < provided.length) {
            if (cpIsStr) { const [p, l] = genStrExprAsPair(provided[ci], filename, ctx); argExprs.push(p, l); }
            else argExprs.push(genExpr(provided[ci], filename, ctx));
          } else if (cp.type === 'AssignmentPattern') {
            if (cpIsStr) { const [p, l] = genStrExprAsPair(cp.right, filename, ctx); argExprs.push(p, l); }
            else argExprs.push(genExpr(cp.right, filename, ctx));
          } else {
            if (cpIsStr) { argExprs.push(mod.i32.const(0), mod.i32.const(0)); }
            else argExprs.push(mod.i32.const(0));
          }
        }
        return mod.call(`${parentName}__ctor`, [ctx.localGet('this'), ...argExprs], binaryen.none);
      }
      if (callee.type === 'Identifier') {
        // ptr(x) — null typed raw pointer (the address 0 or the given value as i32)
        if (callee.name === 'ptr') {
          return mod.i32.const(0);
        }
        const castTarget = TYPES[callee.name];
        if (castTarget && !castTarget.abstract) {
          const arg = node.arguments[0];
          const srcType = arg?._type;
          // str from a function call: parse then free the heap buffer to avoid leaking
          if (srcType?.kind === 'str' && (castTarget.isInteger || castTarget.isFloat) &&
              arg?.type === 'CallExpression') {
            const strPtrExpr = genExpr(arg, filename, ctx);
            const lenExpr = mod.global.get('__str_len_out', binaryen.i32);
            // local.tee saves ptr to __str_tmp and passes it to the parse call
            const savedPtr = ctx.localTee('__str_tmp', strPtrExpr);
            if (castTarget.isFloat) {
              const parsedF64 = mod.call('__jswat_parse_f64', [savedPtr, lenExpr], binaryen.f64);
              return mod.block(null, [
                ctx.localSet('__tmp_f64', parsedF64),
                mod.call('__jswat_free_bytes_auto', [ctx.localGet('__str_tmp')], binaryen.none),
                ctx.localGet('__tmp_f64'),
              ], binaryen.f64);
            } else {
              const parsedI32 = mod.call('__jswat_parse_i32', [savedPtr, lenExpr], binaryen.i32);
              const resultBin = castTarget.wasmType === 'i64' ? binaryen.i64 : binaryen.i32;
              return mod.block(null, [
                ctx.localSet('__tmp', parsedI32),
                mod.call('__jswat_free_bytes_auto', [ctx.localGet('__str_tmp')], binaryen.none),
                castTarget.wasmType === 'i64' ? mod.i64.extend_s(ctx.localGet('__tmp')) : ctx.localGet('__tmp'),
              ], resultBin);
            }
          }
          const argExpr = genExpr(arg, filename, ctx);
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
        const argExprs = [];
        for (const arg of node.arguments) {
          if (arg._type?.kind === 'str') {
            const [p, l] = genStrExprAsPair(arg, filename, ctx); argExprs.push(p, l);
          } else {
            argExprs.push(genExpr(arg, filename, ctx));
          }
        }
        const retType = node._type ? toBinType(node._type) : binaryen.none;
        return mod.call(callee.name, argExprs, retType);
      }
      if (callee.type === 'MemberExpression') {
        const methodName = callee.property?.name;
        const objType = callee.object?._type;
        const className = objType?.kind === 'class' ? objType.name : null;

        if (callee.object.type === 'Identifier' && methodName) {
          // ptr.fromAddr(addr, elem) — returns addr as a raw typed pointer (identity)
          if (callee.object.name === 'ptr' && methodName === 'fromAddr') {
            return genExpr(node.arguments[0], filename, ctx);
          }
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
            case 'skip':   return mod.call('__jswat_iter_skip',    [objExpr, ...argExprs], binaryen.i32);
            case 'collect':return mod.call('__jswat_iter_collect', [objExpr], binaryen.i32);
            case 'count':  return mod.call('__jswat_iter_count',   [objExpr], binaryen.i32);
            case 'sum':    return mod.call('__jswat_iter_sum',     [objExpr], binaryen.i32);
            case 'min':    return mod.call('__jswat_iter_min',     [objExpr], binaryen.i32);
            case 'max':    return mod.call('__jswat_iter_max',     [objExpr], binaryen.i32);
            case 'forEach':return mod.call('__jswat_iter_for_each',[objExpr, ...argExprs], binaryen.none);
            case 'find':   return mod.call('__jswat_iter_find',    [objExpr, ...argExprs], binaryen.i32);
            case 'any':    return mod.call('__jswat_iter_any',     [objExpr, ...argExprs], binaryen.i32);
            case 'all':    return mod.call('__jswat_iter_all',     [objExpr, ...argExprs], binaryen.i32);
            case 'reduce': return mod.call('__jswat_iter_reduce',  [objExpr, ...argExprs], binaryen.i32);
            default: throw new CodegenError(`Unknown iter method '${methodName}' (${filename})`);
          }
        }
        if (objType?.kind === 'str' && methodName) {
          // Fat pointer: receiver is (ptr, len); str arguments also expand to (ptr, len).
          const [objPtr, objLen] = genStrExprAsPair(callee.object, filename, ctx);
          // Expand each argument: str args become two args (ptr, len); others are plain.
          const expandedArgs = [];
          for (const arg of node.arguments) {
            if (arg._type?.kind === 'str') {
              const [p, l] = genStrExprAsPair(arg, filename, ctx);
              expandedArgs.push(p, l);
            } else {
              expandedArgs.push(genExpr(arg, filename, ctx));
            }
          }
          switch (methodName) {
            // Str-returning methods set __str_len_out before returning ptr.
            case 'slice':      return mod.call('__jswat_str_slice',       [objPtr, objLen, ...expandedArgs], binaryen.i32);
            case 'indexOf':    return mod.call('__jswat_str_index_of',    [objPtr, objLen, ...expandedArgs], binaryen.i32);
            case 'concat':     return mod.call('__jswat_str_concat',      [objPtr, objLen, ...expandedArgs], binaryen.i32);
            case 'charAt':     return mod.call('__jswat_str_char_at',     [objPtr, objLen, ...expandedArgs], binaryen.i32);
            case 'startsWith': return mod.call('__jswat_str_starts_with', [objPtr, objLen, ...expandedArgs], binaryen.i32);
            case 'endsWith':   return mod.call('__jswat_str_ends_with',   [objPtr, objLen, ...expandedArgs], binaryen.i32);
            case 'includes':   return mod.i32.ge_s(
                                 mod.call('__jswat_str_index_of', [objPtr, objLen, ...expandedArgs], binaryen.i32),
                                 mod.i32.const(0));
            case 'equals':     return mod.call('__jswat_str_equals',      [objPtr, objLen, ...expandedArgs], binaryen.i32);
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
            // Build expanded arg list: str args become two i32 args (ptr, len).
            const argExprs = [];
            let paramIdx = 0;
            for (const arg of node.arguments) {
              if (arg._type?.kind === 'str') {
                const [p, l] = genStrExprAsPair(arg, filename, ctx);
                argExprs.push(p, l);
              } else {
                const expr = genExpr(arg, filename, ctx);
                const expected = std.params?.[paramIdx];
                const actual = arg._type;
                if (expected && actual && expected !== actual) argExprs.push(genCast(mod, expr, actual, expected));
                else argExprs.push(expr);
              }
              paramIdx++;
            }
            // Pad missing logical params with zero/empty defaults
            while (paramIdx < (std.params?.length ?? 0)) {
              const pt = std.params[paramIdx];
              if (pt?.kind === 'str') {
                // Null str: (ptr=0, len=0)
                argExprs.push(mod.i32.const(0), mod.i32.const(0));
              } else if (pt?.wasmType === 'f64') {
                argExprs.push(mod.f64.const(0));
              } else if (pt?.wasmType === 'i64') {
                argExprs.push(mod.i64.const(0, 0));
              } else {
                argExprs.push(mod.i32.const(0));
              }
              paramIdx++;
            }
            const retType = node._type ? toBinType(node._type) : binaryen.none;
            return mod.call(std.stub, argExprs, retType);
          }
        }
        // alloc.pool(Type, cap) — type-as-value: first arg is a class name → use stride
        if (className === 'alloc' && methodName === 'pool' &&
            node.arguments[0]?.type === 'Identifier') {
          const typeName = node.arguments[0].name;
          const layout = ctx._layouts?.get(typeName);
          if (layout) {
            const capExpr = node.arguments[1]
              ? genExpr(node.arguments[1], filename, ctx)
              : mod.i32.const(0);
            return mod.call('__jswat_pool_new',
              [mod.i32.const(layout.size), capExpr], binaryen.i32);
          }
        }
        // Static method call: ClassName.method(args) — no 'this'
        if (className) {
          const ci = ctx._classes?.get(className);
          if (ci?.staticMethods?.has(methodName)) {
            const argExprs = [];
            for (const arg of node.arguments) {
              if (arg._type?.kind === 'str') {
                const [p, l] = genStrExprAsPair(arg, filename, ctx); argExprs.push(p, l);
              } else {
                argExprs.push(genExpr(arg, filename, ctx));
              }
            }
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
        const argExprs = [];
        let methodArgIdx = 0;
        for (const arg of node.arguments) {
          if (arg._type?.kind === 'str') {
            const [p, l] = genStrExprAsPair(arg, filename, ctx); argExprs.push(p, l);
          } else {
            const expr = genExpr(arg, filename, ctx);
            const expectedType = methodSig?.params?.[methodArgIdx]?.type;
            if (expectedType && arg._type && expectedType !== arg._type) {
              const actualWt = binaryen.getExpressionType(expr);
              const expectedWt = toBinType(expectedType);
              argExprs.push(actualWt !== expectedWt ? genCast(mod, expr, arg._type, expectedType) : expr);
            } else {
              argExprs.push(expr);
            }
          }
          methodArgIdx++;
        }
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
        // ptr.val = x → f64.store at the address
        if (!left.computed && left.object?._type?.kind === 'ptr' && left.property?.name === 'val') {
          const ptrExpr = genExpr(left.object, filename, ctx);
          const valueExpr = genExpr(node.right, filename, ctx);
          return mod.block(null, [
            ctx.localSet('__tmp_f64', valueExpr),
            mod.f64.store(0, 0, ptrExpr, ctx.localGet('__tmp_f64')),
            ctx.localGet('__tmp_f64'),
          ], binaryen.f64);
        }
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
        // str field: 8-byte layout [ptr at offset, len at offset+4]
        if (field.type?.kind === 'str') {
          const [ptrExpr, lenExpr] = genStrExprAsPair(node.right, filename, ctx);
          return mod.block(null, [
            ctx.localSet('__tmp', objExpr),
            ctx.localSet('__str_tmp', ptrExpr),
            ctx.localSet('__str_tmp__len', lenExpr),
            mod.i32.store(field.offset,     0, ctx.localGet('__tmp'), ctx.localGet('__str_tmp')),
            mod.i32.store(field.offset + 4, 0, ctx.localGet('__tmp'), ctx.localGet('__str_tmp__len')),
            ctx.localGet('__str_tmp'),
          ], binaryen.i32);
        }
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
      // ClassName.stride — compile-time size constant
      if (!node.computed && node.object?.type === 'Identifier' &&
          node.property?.name === 'stride') {
        const layout = ctx._layouts?.get(node.object.name);
        if (layout) return mod.i32.const(layout.size);
      }
      const objType = node.object?._type;
      // ptr.addr → return the pointer value itself (i32 address)
      if (!node.computed && objType?.kind === 'ptr' && node.property?.name === 'addr') {
        return genExpr(node.object, filename, ctx);
      }
      // ptr.val → load f64 at the address
      if (!node.computed && objType?.kind === 'ptr' && node.property?.name === 'val') {
        return mod.f64.load(0, 0, genExpr(node.object, filename, ctx));
      }
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
        // Fat pointer: len is the shadow local (Identifier) or the __str_len_out global (complex expr).
        if (node.object.type === 'Identifier' && node.object._type?.kind === 'str') {
          return ctx.localGet(node.object.name + '__len');
        }
        if (node.object.type === 'Literal' && typeof node.object.value === 'string') {
          const info = ctx._strings?.get(node.object.value);
          return mod.i32.const(info?.len ?? 0);
        }
        // Complex expr: evaluate for side effect (sets __str_len_out), drop result, read global.
        const ptrExpr = genExpr(node.object, filename, ctx);
        return mod.block(null, [
          mod.drop(ptrExpr),
          mod.global.get('__str_len_out', binaryen.i32),
        ], binaryen.i32);
      }
      // Compile-time $-property access: ClassName.$byteSize, ClassName.$classId, etc.
      // Also: instance.$addr, instance.$val for Box-like access
      if (!node.computed && node.property?.name?.startsWith?.('$')) {
        const propName = node.property.name;
        // Instance-level: e.$addr → the heap pointer itself
        if (propName === '$addr' && objType?.kind === 'class') {
          return genExpr(node.object, filename, ctx);
        }
        // Type-level: ClassName.$byteSize, ClassName.$classId, ClassName.$headerSize, ClassName.$stride
        const layout = ctx._layouts?.get(objType?.name ?? node.object?.name);
        if (layout) {
          if (propName === '$byteSize') return mod.i32.const(layout.size);
          if (propName === '$stride')   return mod.i32.const(layout.size);
          if (propName === '$classId')  return mod.i32.const(layout.classId);
          if (propName === '$headerSize') return mod.i32.const(12);
        }
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
      // str field: 8-byte layout [ptr:i32 at offset, len:i32 at offset+4]
      // Save base to __tmp (needs two loads), set __str_len_out from len word, return ptr.
      if (field.type?.kind === 'str') {
        return mod.block(null, [
          ctx.localSet('__tmp', base),
          mod.global.set('__str_len_out', mod.i32.load(field.offset + 4, 0, ctx.localGet('__tmp'))),
          mod.i32.load(field.offset, 0, ctx.localGet('__tmp')),
        ], binaryen.i32);
      }
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
          const argExprs = [];
          for (let ci = 0; ci < ctorParams.length; ci++) {
            const cp = ctorParams[ci];
            const cpType = cp.type === 'AssignmentPattern' ? (cp.left?._type ?? cp._type) : cp._type;
            const cpIsStr = cpType?.kind === 'str';
            if (ci < provided.length) {
              if (cpIsStr) { const [p, l] = genStrExprAsPair(provided[ci], filename, ctx); argExprs.push(p, l); }
              else argExprs.push(genExpr(provided[ci], filename, ctx));
            } else if (cp.type === 'AssignmentPattern') {
              if (cpIsStr) { const [p, l] = genStrExprAsPair(cp.right, filename, ctx); argExprs.push(p, l); }
              else argExprs.push(genExpr(cp.right, filename, ctx));
            } else {
              if (cpIsStr) { argExprs.push(mod.i32.const(0), mod.i32.const(0)); }
              else argExprs.push(mod.i32.const(0));
            }
          }
          const classId = layout.classId ?? 1;
          const rcInit = computeRcClassInit(layout.size);
          return mod.block(null, [
            ctx.localSet('__tmp', mod.call('__alloc', [mod.i32.const(layout.size)], binaryen.i32)),
            mod.i32.store(0, 0, ctx.localGet('__tmp'), mod.i32.const(rcInit)),   // rc_class: size-class + rc=1
            mod.i32.store(4, 0, ctx.localGet('__tmp'), mod.i32.const(0)),         // vtable_ptr = 0
            mod.i32.store(8, 0, ctx.localGet('__tmp'), mod.i32.const(classId)),   // class_id
            mod.call(ctorName, [ctx.localGet('__tmp'), ...argExprs], binaryen.none),
            ctx.localGet('__tmp'),
          ], binaryen.i32);
        }
        const classId = layout.classId ?? 1;
        const rcInit = computeRcClassInit(layout.size);
        return mod.block(null, [
          ctx.localSet('__tmp', mod.call('__alloc', [mod.i32.const(layout.size)], binaryen.i32)),
          mod.i32.store(0, 0, ctx.localGet('__tmp'), mod.i32.const(rcInit)),   // rc_class: size-class + rc=1
          mod.i32.store(4, 0, ctx.localGet('__tmp'), mod.i32.const(0)),         // vtable_ptr = 0
          mod.i32.store(8, 0, ctx.localGet('__tmp'), mod.i32.const(classId)),   // class_id
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
      // Build a string by concatenating quasis and expressions using fat pointers.
      // Accumulates into scratch locals __str_tmp (ptr) and __str_tmp__len (len).
      const quasis = node.quasis ?? [];
      const exprs  = node.expressions ?? [];

      const stmts = [];

      // Initialise accumulator with the first static quasi.
      const firstCooked = quasis[0]?.value?.cooked ?? '';
      const firstInfo = ctx._strings?.get(firstCooked);
      const firstPtr = firstInfo ? firstInfo.ptr : 0;
      const firstLen = firstInfo ? firstInfo.len : 0;
      stmts.push(ctx.localSet('__str_tmp',     mod.i32.const(firstPtr)));
      stmts.push(ctx.localSet('__str_tmp__len', mod.i32.const(firstLen)));

      for (let i = 0; i < exprs.length; i++) {
        const exprNode = exprs[i];
        const exprType = exprNode._type;

        let exprPtr, exprLen;
        if (exprType?.kind === 'str') {
          [exprPtr, exprLen] = genStrExprAsPair(exprNode, filename, ctx);
        } else {
          // Non-str expression: convert to str via __jswat_string_from_i32 (sets __str_len_out).
          exprPtr = mod.call('__jswat_string_from_i32', [genExpr(exprNode, filename, ctx)], binaryen.i32);
          exprLen = mod.global.get('__str_len_out', binaryen.i32);
        }

        // concat(acc_ptr, acc_len, expr_ptr, expr_len) → captures result into __str_tmp
        stmts.push(ctx.localSet('__str_tmp',
          mod.call('__jswat_str_concat', [
            ctx.localGet('__str_tmp'), ctx.localGet('__str_tmp__len'),
            exprPtr, exprLen,
          ], binaryen.i32)));
        stmts.push(ctx.localSet('__str_tmp__len', mod.global.get('__str_len_out', binaryen.i32)));

        // Append the next quasi if non-empty.
        const nextCooked = quasis[i + 1]?.value?.cooked ?? '';
        if (nextCooked.length > 0) {
          const nextInfo = ctx._strings?.get(nextCooked);
          if (nextInfo && nextInfo.len > 0) {
            stmts.push(ctx.localSet('__str_tmp',
              mod.call('__jswat_str_concat', [
                ctx.localGet('__str_tmp'), ctx.localGet('__str_tmp__len'),
                mod.i32.const(nextInfo.ptr), mod.i32.const(nextInfo.len),
              ], binaryen.i32)));
            stmts.push(ctx.localSet('__str_tmp__len', mod.global.get('__str_len_out', binaryen.i32)));
          }
        }
      }

      // Publish final len to __str_len_out so callers of this expression can read it.
      stmts.push(mod.global.set('__str_len_out', ctx.localGet('__str_tmp__len')));
      // Return the accumulated ptr as the block's value.
      stmts.push(ctx.localGet('__str_tmp'));
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
