/**
 * @fileoverview Runtime allocator (binaryen IR).
 * Size classes + free lists + bump pointer.
 */

import binaryen from 'binaryen';

const CLASS_SIZES = [8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096];

/**
 * Build nested if/else chain for size class selection.
 * Sets classSize (local 2) and classIndex (local 3).
 */
function buildSizeClassSelect(mod, getR) {
  let expr = mod.block(null, [
    mod.local.set(2, getR()),               // classSize = rounded (large)
    mod.local.set(3, mod.i32.const(10)),    // classIndex = 10 (no free list)
  ], binaryen.none);
  for (let i = CLASS_SIZES.length - 1; i >= 0; i--) {
    expr = mod.if(
      mod.i32.le_u(getR(), mod.i32.const(CLASS_SIZES[i])),
      mod.block(null, [
        mod.local.set(2, mod.i32.const(CLASS_SIZES[i])),
        mod.local.set(3, mod.i32.const(i)),
      ], binaryen.none),
      expr
    );
  }
  return expr;
}

/** Build if/else chain: head = freelist[classIndex] */
function buildGetFreeList(mod, getCI) {
  let expr = mod.local.set(4, mod.global.get('__jswat_fl_9', binaryen.i32));
  for (let i = 8; i >= 0; i--) {
    expr = mod.if(
      mod.i32.eq(getCI(), mod.i32.const(i)),
      mod.local.set(4, mod.global.get(`__jswat_fl_${i}`, binaryen.i32)),
      expr
    );
  }
  return expr;
}

/** Build if/else chain: freelist[classIndex] = next */
function buildSetFreeList(mod, getCI, getNext) {
  let expr = mod.global.set('__jswat_fl_9', getNext());
  for (let i = 8; i >= 0; i--) {
    expr = mod.if(
      mod.i32.eq(getCI(), mod.i32.const(i)),
      mod.global.set(`__jswat_fl_${i}`, getNext()),
      expr
    );
  }
  return expr;
}

function buildAllocFn(mod) {
  // params: size(0)
  // vars: rounded(1), classSize(2), classIndex(3), head(4), next(5), ptr(6), newBump(7), mem(8), pages(9)
  const getSize = () => mod.local.get(0, binaryen.i32);
  const getRnd  = () => mod.local.get(1, binaryen.i32);
  const getCS   = () => mod.local.get(2, binaryen.i32);
  const getCI   = () => mod.local.get(3, binaryen.i32);
  const getHead = () => mod.local.get(4, binaryen.i32);
  const getNext = () => mod.local.get(5, binaryen.i32);
  const getPtr  = () => mod.local.get(6, binaryen.i32);
  const getNB   = () => mod.local.get(7, binaryen.i32);
  const getMem  = () => mod.local.get(8, binaryen.i32);
  const getPgs  = () => mod.local.get(9, binaryen.i32);

  const body = mod.block(null, [
    // rounded = (size + 7) & -8
    mod.local.set(1, mod.i32.and(
      mod.i32.add(getSize(), mod.i32.const(7)),
      mod.i32.const(-8)
    )),

    // pick size class
    buildSizeClassSelect(mod, getRnd),

    // try free list
    mod.block('bump', [
      mod.if(
        mod.i32.le_u(getCI(), mod.i32.const(9)),
        mod.block(null, [
          buildGetFreeList(mod, getCI),
          mod.br_if('bump', mod.i32.eqz(getHead())),
          mod.local.set(5, mod.i32.load(0, 0, getHead())),
          buildSetFreeList(mod, getCI, getNext),
          mod.i32.store(0, 0, getHead(), mod.i32.const(-1)),
          mod.return(getHead()),
        ], binaryen.none)
      ),
    ], binaryen.none),

    // bump allocation
    mod.local.set(6, mod.global.get('__jswat_bump', binaryen.i32)),
    mod.local.set(7, mod.i32.add(getPtr(), getCS())),
    mod.local.set(8, mod.i32.mul(mod.memory.size(), mod.i32.const(65536))),
    mod.if(
      mod.i32.gt_u(getNB(), getMem()),
      mod.block(null, [
        mod.local.set(9,
          mod.i32.div_u(
            mod.i32.add(mod.i32.sub(getNB(), getMem()), mod.i32.const(65535)),
            mod.i32.const(65536)
          )
        ),
        mod.if(
          mod.i32.eq(mod.memory.grow(getPgs()), mod.i32.const(-1)),
          mod.unreachable()
        ),
      ], binaryen.none)
    ),
    mod.global.set('__jswat_bump', getNB()),
    mod.i32.store(0, 0, getPtr(), mod.i32.const(-1)),
    mod.return(getPtr()),
  ], binaryen.i32);

  mod.addFunction('__jswat_alloc',
    binaryen.createType([binaryen.i32]), binaryen.i32,
    new Array(9).fill(binaryen.i32),
    body);
  mod.addFunctionExport('__jswat_alloc', '__jswat_alloc');
}

function buildFreeFn(mod) {
  // params: ptr(0), size(1)
  // vars: rounded(2), classIndex(3)
  const getPtr = () => mod.local.get(0, binaryen.i32);
  const getSize = () => mod.local.get(1, binaryen.i32);
  const getRnd  = () => mod.local.get(2, binaryen.i32);
  const getCI   = () => mod.local.get(3, binaryen.i32);

  // Build the free-list return cases:
  // if classIndex == i: ptr.store(fl_i); fl_i = ptr; return
  const buildFreeCase = (i) => mod.if(
    mod.i32.eq(getCI(), mod.i32.const(i)),
    mod.block(null, [
      mod.i32.store(0, 0, getPtr(), mod.global.get(`__jswat_fl_${i}`, binaryen.i32)),
      mod.global.set(`__jswat_fl_${i}`, getPtr()),
      mod.return(),
    ], binaryen.none)
  );

  // Size class selection for free (sets classIndex only, no classSize needed)
  // Build from inside out
  let sizeSelect = mod.block(null, [
    mod.return(), // classIndex >= 10 (large): just return (no free list)
  ], binaryen.none);
  for (let i = CLASS_SIZES.length - 1; i >= 0; i--) {
    sizeSelect = mod.if(
      mod.i32.le_u(getRnd(), mod.i32.const(CLASS_SIZES[i])),
      mod.local.set(3, mod.i32.const(i)),
      sizeSelect
    );
  }

  const freeCases = [];
  for (let i = 0; i < CLASS_SIZES.length - 1; i++) {
    freeCases.push(buildFreeCase(i));
  }
  freeCases.push(mod.block(null, [
    mod.i32.store(0, 0, getPtr(), mod.global.get('__jswat_fl_9', binaryen.i32)),
    mod.global.set('__jswat_fl_9', getPtr()),
  ], binaryen.none));

  const body = mod.block(null, [
    mod.if(mod.i32.eqz(getPtr()), mod.return()),
    // rounded = (size + 7) & -8
    mod.local.set(2, mod.i32.and(
      mod.i32.add(getSize(), mod.i32.const(7)),
      mod.i32.const(-8)
    )),
    sizeSelect,
    ...freeCases,
  ], binaryen.none);

  mod.addFunction('__jswat_free',
    binaryen.createType([binaryen.i32, binaryen.i32]), binaryen.none,
    [binaryen.i32, binaryen.i32],
    body);
  mod.addFunctionExport('__jswat_free', '__jswat_free');
}

function buildAllocBytesFn(mod) {
  // params: n(0), fill(1)
  // vars: ptr(2), size(3)
  const getN    = () => mod.local.get(0, binaryen.i32);
  const getFill = () => mod.local.get(1, binaryen.i32);
  const getPtr  = () => mod.local.get(2, binaryen.i32);
  const getSize = () => mod.local.get(3, binaryen.i32);

  const body = mod.block(null, [
    mod.local.set(3, mod.i32.add(getN(), mod.i32.const(4))),
    // ptr = alloc(size)
    mod.local.set(2, mod.call('__jswat_alloc', [getSize()], binaryen.i32)),
    // store n in header so __jswat_free_bytes_auto can recover the size
    mod.i32.store(0, 0, getPtr(), getN()),
    // fill ptr+4..ptr+4+n with fill
    mod.memory.fill(
      mod.i32.add(getPtr(), mod.i32.const(4)),
      getFill(),
      getN()
    ),
    mod.return(mod.i32.add(getPtr(), mod.i32.const(4))),
  ], binaryen.i32);

  mod.addFunction('__jswat_alloc_bytes',
    binaryen.createType([binaryen.i32, binaryen.i32]), binaryen.i32,
    [binaryen.i32, binaryen.i32],
    body);
  mod.addFunctionExport('__jswat_alloc_bytes', '__jswat_alloc_bytes');
}

function buildFreeBytesFn(mod) {
  // params: ptr(0), n(1)
  // vars: hdr(2), size(3)
  const getPtr  = () => mod.local.get(0, binaryen.i32);
  const getN    = () => mod.local.get(1, binaryen.i32);
  const getHdr  = () => mod.local.get(2, binaryen.i32);
  const getSize = () => mod.local.get(3, binaryen.i32);

  const body = mod.block(null, [
    mod.local.set(2, mod.i32.sub(getPtr(), mod.i32.const(4))),
    mod.local.set(3, mod.i32.add(getN(), mod.i32.const(4))),
    mod.call('__jswat_free', [getHdr(), getSize()], binaryen.none),
  ], binaryen.none);

  mod.addFunction('__jswat_free_bytes',
    binaryen.createType([binaryen.i32, binaryen.i32]), binaryen.none,
    [binaryen.i32, binaryen.i32],
    body);
  mod.addFunctionExport('__jswat_free_bytes', '__jswat_free_bytes');
}

function buildFreeByteAutoFn(mod) {
  // params: dataPtr(0)
  // vars: hdr(1), n(2), size(3)
  // Reads n from the 4-byte header stored by __jswat_alloc_bytes, then frees.
  const getDataPtr = () => mod.local.get(0, binaryen.i32);
  const getHdr     = () => mod.local.get(1, binaryen.i32);
  const getN       = () => mod.local.get(2, binaryen.i32);
  const getSize    = () => mod.local.get(3, binaryen.i32);

  const body = mod.block(null, [
    mod.if(mod.i32.eqz(getDataPtr()), mod.return()),
    mod.local.set(1, mod.i32.sub(getDataPtr(), mod.i32.const(4))),  // hdr = dataPtr - 4
    mod.local.set(2, mod.i32.load(0, 0, getHdr())),                  // n = *(hdr)
    mod.local.set(3, mod.i32.add(getN(), mod.i32.const(4))),         // size = n + 4
    mod.call('__jswat_free', [getHdr(), getSize()], binaryen.none),
  ], binaryen.none);

  mod.addFunction('__jswat_free_bytes_auto',
    binaryen.createType([binaryen.i32]), binaryen.none,
    [binaryen.i32, binaryen.i32, binaryen.i32],
    body);
  mod.addFunctionExport('__jswat_free_bytes_auto', '__jswat_free_bytes_auto');
}

function buildReallocFn(mod) {
  // params: ptr(0), oldSize(1), newSize(2)
  // vars: newPtr(3), copyLen(4)
  const getPtr     = () => mod.local.get(0, binaryen.i32);
  const getOldSize = () => mod.local.get(1, binaryen.i32);
  const getNewSize = () => mod.local.get(2, binaryen.i32);
  const getNewPtr  = () => mod.local.get(3, binaryen.i32);
  const getCopyLen = () => mod.local.get(4, binaryen.i32);

  const body = mod.block(null, [
    mod.if(
      mod.i32.eq(getNewSize(), getOldSize()),
      mod.return(getPtr())
    ),
    mod.local.set(3, mod.call('__jswat_alloc_bytes', [getNewSize(), mod.i32.const(0)], binaryen.i32)),
    mod.if(
      mod.i32.lt_u(getOldSize(), getNewSize()),
      mod.local.set(4, getOldSize()),
      mod.local.set(4, getNewSize())
    ),
    mod.memory.copy(getNewPtr(), getPtr(), getCopyLen()),
    mod.call('__jswat_free_bytes', [getPtr(), getOldSize()], binaryen.none),
    mod.return(getNewPtr()),
  ], binaryen.i32);

  mod.addFunction('__jswat_realloc',
    binaryen.createType([binaryen.i32, binaryen.i32, binaryen.i32]), binaryen.i32,
    [binaryen.i32, binaryen.i32],
    body);
  mod.addFunctionExport('__jswat_realloc', '__jswat_realloc');
}

/**
 * Add allocator globals and functions to the binaryen module.
 * @param {any} mod  binaryen Module
 */
export function buildAllocator(mod) {
  mod.addGlobal('__jswat_bump', binaryen.i32, true, mod.i32.const(1024));
  for (let i = 0; i < CLASS_SIZES.length; i++) {
    mod.addGlobal(`__jswat_fl_${i}`, binaryen.i32, true, mod.i32.const(0));
  }

  buildAllocFn(mod);
  buildFreeFn(mod);
  buildAllocBytesFn(mod);
  buildFreeBytesFn(mod);
  buildFreeByteAutoFn(mod);
  buildReallocFn(mod);

  // __alloc / __free wrappers
  mod.addFunction('__alloc',
    binaryen.createType([binaryen.i32]), binaryen.i32, [],
    mod.call('__jswat_alloc', [mod.local.get(0, binaryen.i32)], binaryen.i32));
  mod.addFunctionExport('__alloc', '__alloc');

  mod.addFunction('__free',
    binaryen.createType([binaryen.i32, binaryen.i32]), binaryen.none, [],
    mod.call('__jswat_free',
      [mod.local.get(0, binaryen.i32), mod.local.get(1, binaryen.i32)],
      binaryen.none));
  mod.addFunctionExport('__free', '__free');
}
