/**
 * @fileoverview Statement code generation (binaryen IR).
 */

import binaryen from 'binaryen';
import { TYPES } from '../types.js';
import { CodegenError } from './context.js';
import { genLoad } from './types.js';
import { genExpr, genExprStatement } from './expressions.js';

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
    case 'ReturnStatement':
      return stmt.argument
        ? mod.return(genExpr(stmt.argument, filename, ctx))
        : mod.return();

    case 'VariableDeclaration': {
      const stmts = [];
      for (const decl of stmt.declarations) {
        if (decl.init)
          stmts.push(ctx.localSet(decl.id.name, genExpr(decl.init, filename, ctx)));
      }
      if (stmts.length === 0) return mod.nop();
      if (stmts.length === 1) return stmts[0];
      return mod.block(null, stmts, binaryen.none);
    }

    case 'ExpressionStatement':
      return genExprStatement(stmt.expression, filename, ctx);

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

    default:
      return mod.nop();
  }
}
