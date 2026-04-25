/**
 * @fileoverview Statement code generation (binaryen IR).
 */

import binaryen from 'binaryen';
import { TYPES } from '../types.js';
import { CodegenError } from './context.js';
import { genLoad, isHeapType } from './types.js';
import { genExpr, genExprStatement, genStrExprAsPair } from './expressions.js';

// ── RC heap cleanup helper ─────────────────────────────────────────────────────

/**
 * Generate rc_dec + nullify for all heap locals except the optional skipLocal.
 * Nullification prevents double-free when early returns also clean up heap locals.
 *
 * @param {import('./context.js').GenContext} ctx
 * @param {string|null} skipLocal  local name to skip (the one being returned, if any)
 * @returns {number[]} array of ExpressionRef (void statements)
 */
export function genHeapCleanup(ctx, skipLocal) {
  const mod = ctx.mod;
  const stmts = [];
  for (const [name, type] of ctx._heapLocals) {
    if (name === skipLocal) continue;
    // str is a value-type fat pointer — not heap-managed, never RC-dec'd.
    stmts.push(mod.call('__jswat_rc_dec', [ctx.localGet(name)], binaryen.none));
    stmts.push(ctx.localSet(name, mod.i32.const(0)));
  }
  return stmts;
}

// ── Statement code generation ─────────────────────────────────────────────────

/**
 * Get the statements inside a block or treat a single statement as a 1-element list.
 * @param {object|null} node
 * @returns {object[]}
 */
export function blockBody(node) {
  if (!node) return [];
  if (node.type === 'BlockStatement') return node.body;
  return [node];
}

/**
 * True if a branch (block or statement) unconditionally returns in all code paths.
 * @param {object|null} node
 * @returns {boolean}
 */
export function alwaysReturns(node) {
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
 * Generate a binaryen ExpressionRef for a statement.
 * @param {object} stmt
 * @param {TypeInfo|null} fnReturnType
 * @param {GenContext} ctx
 * @param {string} filename
 * @returns {number} ExpressionRef
 */
export function genStatement(stmt, fnReturnType, ctx, filename) {
  if (!stmt) return ctx.mod.nop();

  const mod = ctx.mod;

  switch (stmt.type) {
    case 'ReturnStatement': {
      // Str-returning functions: set __str_len_out before returning the ptr so callers
      // using the fat-pointer convention can recover the len.
      if (stmt.argument && fnReturnType?.kind === 'str') {
        const [ptrRef, lenRef] = genStrExprAsPair(stmt.argument, filename, ctx);
        return mod.block(null, [
          mod.global.set('__str_len_out', lenRef),
          mod.return(ptrRef),
        ], binaryen.none);
      }

      const heapLocals = ctx._heapLocals;
      if (!heapLocals || heapLocals.size === 0) {
        return stmt.argument
          ? mod.return(genExpr(stmt.argument, filename, ctx))
          : mod.return();
      }
      // Determine if we're returning a heap local (to skip its rc_dec).
      const skipLocal = (stmt.argument?.type === 'Identifier' && heapLocals.has(stmt.argument.name))
        ? stmt.argument.name
        : null;
      const cleanups = genHeapCleanup(ctx, skipLocal);
      if (cleanups.length === 0) {
        return stmt.argument
          ? mod.return(genExpr(stmt.argument, filename, ctx))
          : mod.return();
      }
      // Pattern: save return value → cleanup → return saved value
      const retStmts = [];
      if (stmt.argument) {
        retStmts.push(ctx.localSet('__result', genExpr(stmt.argument, filename, ctx)));
      }
      retStmts.push(...cleanups);
      retStmts.push(stmt.argument ? mod.return(ctx.localGet('__result')) : mod.return());
      return mod.block(null, retStmts, binaryen.none);
    }

    case 'VariableDeclaration': {
      const stmts = [];
      for (const decl of stmt.declarations) {
        if (decl.init) {
          // Enum declarations are compile-time only — no WASM code emitted
          if (decl._type?.kind === 'enumDescriptor') continue;
          if (decl.init._type?.kind === 'str') {
            // Str fat pointer: set both `name` (ptr) and `name__len` (len).
            const [ptrRef, lenRef] = genStrExprAsPair(decl.init, filename, ctx);
            stmts.push(ctx.localSet(decl.id.name, ptrRef));
            stmts.push(ctx.localSet(decl.id.name + '__len', lenRef));
          } else {
            stmts.push(ctx.localSet(decl.id.name, genExpr(decl.init, filename, ctx)));
            // If copying an existing heap reference (not a freshly-created value),
            // rc_inc the new owner.
            if (isHeapType(decl.init._type) &&
                decl.init.type !== 'NewExpression' &&
                decl.init.type !== 'ArrayExpression' &&
                decl.init.type !== 'CallExpression') {
              stmts.push(mod.call('__jswat_rc_inc', [ctx.localGet(decl.id.name)], binaryen.none));
            }
          }
        }
      }
      if (stmts.length === 0) return mod.nop();
      if (stmts.length === 1) return stmts[0];
      return mod.block(null, stmts, binaryen.none);
    }

    case 'ExpressionStatement':
      return genExprStatement(stmt.expression, filename, ctx);

    case 'ThrowStatement': {
      const ptr = genExpr(stmt.argument, filename, ctx);
      return mod.throw('__jswat_exception', [ptr]);
    }

    case 'TryStatement': {
      const outerLabel = ctx.nextLabel('exc');
      const bodyBlock = mod.block(null,
        stmt.block.body.map(s => genStatement(s, fnReturnType, ctx, filename)),
        binaryen.none);

      if (!stmt.handler && !stmt.finalizer) return bodyBlock;

      const makeCatchBody = () => {
        const pop = ctx.localSet('__exc_ptr', mod.i32.pop());
        const handlerBody = stmt.handler?.body?.body ?? [];
        const paramName = stmt.handler?.param?.name ?? null;
        if (!paramName) {
          return mod.block(null,
            [pop, ...handlerBody.map(s => genStatement(s, fnReturnType, ctx, filename))],
            binaryen.none);
        }
        const excInfo = ctx._localMap.get('__exc_ptr');
        if (!excInfo) {
          return mod.block(null,
            [pop, ...handlerBody.map(s => genStatement(s, fnReturnType, ctx, filename))],
            binaryen.none);
        }
        const prev = ctx._localMap.get(paramName) ?? null;
        ctx._localMap.set(paramName, excInfo);
        const bodyExpr = mod.block(null,
          [pop, ...handlerBody.map(s => genStatement(s, fnReturnType, ctx, filename))],
          binaryen.none);
        if (prev) ctx._localMap.set(paramName, prev);
        else ctx._localMap.delete(paramName);
        return bodyExpr;
      };

      const makeFinally = () =>
        mod.block(null,
          (stmt.finalizer?.body ?? []).map(s => genStatement(s, fnReturnType, ctx, filename)),
          binaryen.none);

      if (stmt.handler && !stmt.finalizer) {
        return mod.try(outerLabel, bodyBlock, ['__jswat_exception'], [makeCatchBody()], null);
      }

      if (!stmt.handler) {
        return mod.block(null, [
          mod.try(outerLabel, bodyBlock, [], [
            mod.block(null, [makeFinally(), mod.rethrow(outerLabel)], binaryen.none),
          ], null),
          makeFinally(),
        ], binaryen.none);
      }

      const innerLabel = ctx.nextLabel('exc_inner');
      const innerTry = mod.try(innerLabel, bodyBlock, ['__jswat_exception'], [makeCatchBody()], null);
      const outerBody = mod.block(null, [innerTry, makeFinally()], binaryen.none);
      const catchAll = mod.block(null, [makeFinally(), mod.rethrow(outerLabel)], binaryen.none);
      return mod.try(outerLabel, outerBody, [], [catchAll], null);
    }

    case 'BlockStatement': {
      const stmts = stmt.body.map(s => genStatement(s, fnReturnType, ctx, filename));
      if (stmts.length === 0) return mod.nop();
      if (stmts.length === 1) return stmts[0];
      return mod.block(null, stmts, binaryen.none);
    }

    case 'IfStatement': {
      const cond = genExpr(stmt.test, filename, ctx);
      const thenStmts = blockBody(stmt.consequent).map(s => genStatement(s, fnReturnType, ctx, filename));
      const thenExpr = thenStmts.length === 0 ? mod.nop()
                     : thenStmts.length === 1 ? thenStmts[0]
                     : mod.block(null, thenStmts, binaryen.none);
      if (!stmt.alternate) {
        return mod.if(cond, thenExpr);
      }
      const elseStmts = blockBody(stmt.alternate).map(s => genStatement(s, fnReturnType, ctx, filename));
      const elseExpr = elseStmts.length === 0 ? mod.nop()
                     : elseStmts.length === 1 ? elseStmts[0]
                     : mod.block(null, elseStmts, binaryen.none);
      return mod.if(cond, thenExpr, elseExpr);
    }

    case 'WhileStatement': {
      const brk = ctx.nextLabel('brk');
      const lp  = ctx.nextLabel('lp');
      ctx.pushLoop(brk, lp);
      const cond = genExpr(stmt.test, filename, ctx);
      const body = genStatement(stmt.body, fnReturnType, ctx, filename);
      ctx.popLoop();
      const loopBody = mod.block(null, [
        mod.br_if(brk, mod.i32.eqz(cond)),
        body,
        mod.br(lp),
      ], binaryen.none);
      return mod.block(brk, [mod.loop(lp, loopBody)], binaryen.none);
    }

    case 'DoWhileStatement': {
      const brk  = ctx.nextLabel('brk');
      const lp   = ctx.nextLabel('lp');
      const cont = ctx.nextLabel('cont');
      ctx.pushLoop(brk, cont);
      const body = genStatement(stmt.body, fnReturnType, ctx, filename);
      const cond = genExpr(stmt.test, filename, ctx);
      ctx.popLoop();
      const loopBody = mod.block(null, [
        mod.block(cont, [body], binaryen.none),
        mod.br_if(lp, cond),
      ], binaryen.none);
      return mod.block(brk, [mod.loop(lp, loopBody)], binaryen.none);
    }

    case 'ForStatement': {
      const brk   = ctx.nextLabel('brk');
      const lp    = ctx.nextLabel('lp');
      const inner = ctx.nextLabel('inner');
      ctx.pushLoop(brk, inner);

      const initExpr = stmt.init
        ? (stmt.init.type === 'VariableDeclaration'
            ? genStatement(stmt.init, fnReturnType, ctx, filename)
            : genExprStatement(stmt.init, filename, ctx))
        : null;
      const condExpr   = stmt.test   ? genExpr(stmt.test, filename, ctx)          : null;
      const updateExpr = stmt.update ? genExprStatement(stmt.update, filename, ctx) : null;
      const bodyExpr   = genStatement(stmt.body, fnReturnType, ctx, filename);
      ctx.popLoop();

      // innerBodyParts: inner block + optional update + branch back
      const innerBodyParts = [
        mod.block(inner, [bodyExpr], binaryen.none),
      ];
      if (updateExpr) innerBodyParts.push(updateExpr);
      innerBodyParts.push(mod.br(lp));

      const loopBodyParts = [];
      if (condExpr) loopBodyParts.push(mod.br_if(brk, mod.i32.eqz(condExpr)));
      loopBodyParts.push(...innerBodyParts);

      const loop = mod.loop(lp, mod.block(null, loopBodyParts, binaryen.none));
      const parts = [];
      if (initExpr) parts.push(initExpr);
      parts.push(mod.block(brk, [loop], binaryen.none));
      return parts.length === 1 ? parts[0] : mod.block(null, parts, binaryen.none);
    }

    case 'ForOfStatement': {
      const id = stmt._forOfId ?? 0;
      const startLocal  = `__forof_start_${id}`;
      const endLocal    = `__forof_end_${id}`;
      const stepLocal   = `__forof_step_${id}`;
      const iterLocal   = `__forof_i_${id}`;
      const itLocal     = `__forof_iter_${id}`;
      const resLocal    = `__forof_result_${id}`;
      const breakLabel  = ctx.nextLabel('forof_break');
      const loopPos     = ctx.nextLabel('forof_pos');
      const loopNeg     = ctx.nextLabel('forof_neg');

      const right = stmt.right;
      const rightType  = right?._type;
      const rightClass = rightType?.kind === 'class' ? ctx._classes?.get(rightType.name) : null;
      const iterMethod = rightClass?.methods.get('iter');
      const iterType   = iterMethod?.signature.returnType;
      const iterClass  = iterType?.kind === 'class' ? ctx._classes?.get(iterType.name) : null;
      const nextMethod = iterClass?.methods.get('next');
      const resType    = nextMethod?.signature.returnType;
      const resClass   = resType?.kind === 'class' ? ctx._classes?.get(resType.name) : null;
      const resLayout  = resClass ? ctx._layouts?.get(resClass.name) : null;
      const valueField = resLayout?.fields.get('value') ?? null;
      const doneField  = resLayout?.fields.get('done') ?? null;

      if (rightClass && iterClass && resLayout && valueField && doneField) {
        const brk = breakLabel;
        const lp  = loopPos;
        ctx.pushLoop(brk, lp);
        const bodyExpr = genStatement(stmt.body, fnReturnType, ctx, filename);
        ctx.popLoop();

        // Assign the loop variable from the result struct's value field
        const assignLoopVar = (() => {
          const loadVal = genLoad(mod, ctx.localGet(resLocal), valueField.type, valueField.offset);
          if (stmt.left?.type === 'VariableDeclaration') {
            const decl = stmt.left.declarations[0];
            if (decl?.id?.name) return ctx.localSet(decl.id.name, loadVal);
          } else if (stmt.left?.type === 'Identifier') {
            return ctx.localSet(stmt.left.name, loadVal);
          }
          return mod.nop();
        })();

        // Load the done field
        const doneVal = genLoad(mod, ctx.localGet(resLocal), doneField.type, doneField.offset);

        const loopBody = mod.block(null, [
          // result = iter.next()
          ctx.localSet(resLocal, mod.call(`${iterClass.name}_next`, [ctx.localGet(itLocal)], binaryen.i32)),
          // if not done: assign var, run body, br back
          mod.if(
            mod.i32.eqz(doneVal),
            mod.block(null, [
              assignLoopVar,
              bodyExpr,
              mod.br(lp),
            ], binaryen.none)
          ),
        ], binaryen.none);

        return mod.block(null, [
          ctx.localSet(itLocal, mod.call(`${rightClass.name}_iter`, [genExpr(right, filename, ctx)], binaryen.i32)),
          mod.block(brk, [mod.loop(lp, loopBody)], binaryen.none),
        ], binaryen.none);
      }

      // Range-based for-of
      let startExpr = mod.i32.const(0);
      let endExpr   = mod.i32.const(0);
      let stepExpr  = mod.i32.const(1);
      if (right?.type === 'NewExpression' && right.callee?.type === 'Identifier') {
        const args = right.arguments ?? [];
        if (args[0]) startExpr = genExpr(args[0], filename, ctx);
        if (args[1]) endExpr   = genExpr(args[1], filename, ctx);
        if (args[2]) stepExpr  = genExpr(args[2], filename, ctx);
      }

      const initStmts = [
        ctx.localSet(startLocal, startExpr),
        ctx.localSet(endLocal,   endExpr),
        ctx.localSet(stepLocal,  stepExpr),
        ctx.localSet(iterLocal,  ctx.localGet(startLocal)),
      ];

      const makeAssignLoopVar = () => {
        if (stmt.left?.type === 'VariableDeclaration') {
          const decl = stmt.left.declarations[0];
          if (decl?.id?.name) return ctx.localSet(decl.id.name, ctx.localGet(iterLocal));
        } else if (stmt.left?.type === 'Identifier') {
          return ctx.localSet(stmt.left.name, ctx.localGet(iterLocal));
        }
        return mod.nop();
      };

      // Generate positive and negative loop bodies separately
      // (ExpressionRefs cannot be shared in two places in the binaryen tree)
      ctx.pushLoop(breakLabel, loopPos);
      const bodyPos = genStatement(stmt.body, fnReturnType, ctx, filename);
      ctx.popLoop();
      ctx.pushLoop(breakLabel, loopNeg);
      const bodyNeg = genStatement(stmt.body, fnReturnType, ctx, filename);
      ctx.popLoop();

      const posLoop = mod.loop(loopPos, mod.block(null, [
        mod.if(
          mod.i32.lt_s(ctx.localGet(iterLocal), ctx.localGet(endLocal)),
          mod.block(null, [
            makeAssignLoopVar(),
            bodyPos,
            ctx.localSet(iterLocal, mod.i32.add(ctx.localGet(iterLocal), ctx.localGet(stepLocal))),
            mod.br(loopPos),
          ], binaryen.none)
        ),
      ], binaryen.none));

      const negLoop = mod.loop(loopNeg, mod.block(null, [
        mod.if(
          mod.i32.gt_s(ctx.localGet(iterLocal), ctx.localGet(endLocal)),
          mod.block(null, [
            makeAssignLoopVar(),
            bodyNeg,
            ctx.localSet(iterLocal, mod.i32.add(ctx.localGet(iterLocal), ctx.localGet(stepLocal))),
            mod.br(loopNeg),
          ], binaryen.none)
        ),
      ], binaryen.none));

      const brkBlock = mod.block(breakLabel, [
        mod.if(
          mod.i32.gt_s(ctx.localGet(stepLocal), mod.i32.const(0)),
          posLoop,
          negLoop
        ),
      ], binaryen.none);

      return mod.block(null, [...initStmts, brkBlock], binaryen.none);
    }

    case 'BreakStatement': {
      const loop = ctx.currentLoop();
      if (!loop) throw new CodegenError(`break used outside loop (${filename})`);
      return mod.br(loop.breakLabel);
    }

    case 'ContinueStatement': {
      const loop = ctx.currentLoop();
      if (!loop) throw new CodegenError(`continue used outside loop (${filename})`);
      return mod.br(loop.continueLabel);
    }

    case 'SwitchStatement': {
      const discType = stmt.discriminant?._type;
      if (discType?.kind === 'class') {
        // Type-narrowing switch: compare type tag (ptr[0]) to each case class ID
        // Wrap in a block so that `break` inside a case can exit the switch.
        const breakLabel = ctx.nextLabel('switch_break');
        ctx.pushLoop(breakLabel, null);
        let chain = mod.nop();
        for (let i = stmt.cases.length - 1; i >= 0; i--) {
          const c = stmt.cases[i];
          if (!c.test) continue; // default case — skip for now
          const caseLayout = ctx._layouts.get(c.test.name);
          if (!caseLayout) continue;
          const bodyStmts = c.consequent.map(s => genStatement(s, fnReturnType, ctx, filename));
          const body = bodyStmts.length === 0 ? mod.nop()
                     : bodyStmts.length === 1 ? bodyStmts[0]
                     : mod.block(null, bodyStmts, binaryen.none);
          const tagCheck = mod.i32.eq(
            mod.i32.load(8, 0, genExpr(stmt.discriminant, filename, ctx)),
            mod.i32.const(caseLayout.classId)
          );
          chain = mod.if(tagCheck, body, chain);
        }
        ctx.popLoop();
        return mod.block(breakLabel, [chain], binaryen.none);
      }
      // Enum switch: cases are MemberExpressions with _enumVariant (e.g. Direction.North)
      const isEnumSwitch = stmt.cases.some(c => c.test?._enumVariant !== undefined);
      if (isEnumSwitch) {
        const breakLabel = ctx.nextLabel('switch_break');
        ctx.pushLoop(breakLabel, null);
        let chain = mod.nop();
        for (let i = stmt.cases.length - 1; i >= 0; i--) {
          const c = stmt.cases[i];
          if (!c.test) {
            // default case
            const bodyStmts = c.consequent.map(s => genStatement(s, fnReturnType, ctx, filename));
            chain = bodyStmts.length === 0 ? mod.nop()
                  : bodyStmts.length === 1 ? bodyStmts[0]
                  : mod.block(null, bodyStmts, binaryen.none);
            continue;
          }
          const variant = c.test._enumVariant;
          if (!variant) continue;
          const bodyStmts = c.consequent.map(s => genStatement(s, fnReturnType, ctx, filename));
          const body = bodyStmts.length === 0 ? mod.nop()
                     : bodyStmts.length === 1 ? bodyStmts[0]
                     : mod.block(null, bodyStmts, binaryen.none);
          const isI64 = variant.type?.wasmType === 'i64';
          const cond = isI64
            ? mod.i64.eq(genExpr(stmt.discriminant, filename, ctx), mod.i64.const(variant.value, 0))
            : mod.i32.eq(genExpr(stmt.discriminant, filename, ctx), mod.i32.const(variant.value));
          chain = mod.if(cond, body, chain);
        }
        ctx.popLoop();
        return mod.block(breakLabel, [chain], binaryen.none);
      }
      return mod.nop();
    }

    default:
      return mod.nop();
  }
}
