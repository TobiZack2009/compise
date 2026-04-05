/**
 * Snake game — compiles to wasm32-js-bundle and runs in the browser.
 *
 *   jswat compile examples/snake-html.js -o dist/snake.mjs --target wasm32-js-bundle
 *
 * Then include dist/snake.html (see below) in a web server.
 * The @export functions are called from the accompanying HTML/JS driver.
 *
 * Board: 20×20 grid.  Snake stored as a ring-buffer of (x,y) pairs.
 * Direction: 0=UP 1=RIGHT 2=DOWN 3=LEFT
 */
import Random from "std/random";

// ── Constants ────────────────────────────────────────────────────────────────

const BOARD_W = 20;
const BOARD_H = 20;
const MAX_LEN = 400; // BOARD_W * BOARD_H

// ── State globals ─────────────────────────────────────────────────────────────

// Ring buffer for snake body: head at snakeHead, length snakeLen.
// Each cell is encoded as y*BOARD_W+x (one i32).
let snakeBuf = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

let snakeHead = 0;  // index of head in ring buffer
let snakeLen  = 3;  // current length
let dir       = 1;  // 1=RIGHT
let foodX     = 10;
let foodY     = 10;
let score     = 0;
let gameOver  = false;

// ── Helpers ───────────────────────────────────────────────────────────────────

function cellEncode(x = 0, y = 0) {
  return y * BOARD_W + x;
}

function cellX(cell = 0) { return cell % BOARD_W; }
function cellY(cell = 0) { return isize(cell / BOARD_W); }

function bufIdx(offset = 0) {
  return ((snakeHead + MAX_LEN - offset) % MAX_LEN);
}

function snakeAt(idx = 0) { return snakeBuf[idx]; }

function isSnakeCell(x = 0, y = 0) {
  const enc = cellEncode(x, y);
  let i = 0;
  while (i < snakeLen) {
    if (snakeAt(bufIdx(i)) === enc) { return true; }
    i = i + 1;
  }
  return false;
}

function placeFood() {
  let fx = isize(Random.float() * 20.0);
  let fy = isize(Random.float() * 20.0);
  let tries = 0;
  while (isSnakeCell(fx, fy) && tries < 200) {
    fx = isize(Random.float() * 20.0);
    fy = isize(Random.float() * 20.0);
    tries = tries + 1;
  }
  foodX = fx;
  foodY = fy;
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  snakeHead = 2;
  snakeLen  = 3;
  dir       = 1;
  score     = 0;
  gameOver  = false;
  snakeBuf[0] = cellEncode(8, 10);
  snakeBuf[1] = cellEncode(9, 10);
  snakeBuf[2] = cellEncode(10, 10);
  placeFood();
}

init();

// ── Exported API ──────────────────────────────────────────────────────────────

//@export("setDir")
function setDir(d = 0) {
  // Prevent 180-degree reversal
  if (dir === 0 && d === 2) { return; }
  if (dir === 2 && d === 0) { return; }
  if (dir === 1 && d === 3) { return; }
  if (dir === 3 && d === 1) { return; }
  dir = d;
}

//@export("step")
function step() {
  if (gameOver) { return 0; }

  const head  = snakeAt(bufIdx(0));
  let   hx    = cellX(head);
  let   hy    = cellY(head);

  if (dir === 0) { hy = hy - 1; }
  else if (dir === 1) { hx = hx + 1; }
  else if (dir === 2) { hy = hy + 1; }
  else { hx = hx - 1; }

  // Wall collision
  if (hx < 0 || hx >= BOARD_W || hy < 0 || hy >= BOARD_H) {
    gameOver = true;
    return -1;
  }

  // Self collision
  if (isSnakeCell(hx, hy)) {
    gameOver = true;
    return -1;
  }

  const ate = (hx === foodX && hy === foodY) ? 1 : 0;
  if (!ate) {
    // Advance tail (shrink ring buffer logical tail — ring buffer auto-handles this)
  } else {
    snakeLen = snakeLen + 1;
    score    = score + 10;
    if (snakeLen < MAX_LEN) { placeFood(); }
  }

  snakeHead = (snakeHead + 1) % MAX_LEN;
  snakeBuf[snakeHead] = cellEncode(hx, hy);

  return ate;
}

//@export("getScore")
function getScore() { return score; }

//@export("isGameOver")
function isGameOver() { return gameOver ? 1 : 0; }

//@export("getSnakeLen")
function getSnakeLen() { return snakeLen; }

//@export("getSnakeX")
function getSnakeX(i = 0) { return cellX(snakeAt(bufIdx(i))); }

//@export("getSnakeY")
function getSnakeY(i = 0) { return cellY(snakeAt(bufIdx(i))); }

//@export("getFoodX")
function getFoodX() { return foodX; }

//@export("getFoodY")
function getFoodY() { return foodY; }

//@export("getBoardW")
function getBoardW() { return BOARD_W; }

//@export("getBoardH")
function getBoardH() { return BOARD_H; }

//@export("reset")
function reset() {
  init();
  return score;
}
