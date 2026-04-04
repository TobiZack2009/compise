#!/usr/bin/env node
/**
 * @fileoverview jswat CLI entry point — argument parsing and command dispatch.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { compileSource, wasmToWat } from './compiler.js';

const STD_ROOT = fileURLToPath(new URL('../std', import.meta.url));

/**
 * Read a file from disk and compile it.
 * @param {{ input: string, checkOnly?: boolean }} opts
 * @returns {Promise<import('./compiler.js').CompileResult>}
 */
async function compile(opts) {
  const { input, checkOnly = false } = opts;
  const source = await readFile(input, 'utf8');
  return compileSource(source, input, {
    checkOnly,
    readFile: (p) => readFileSync(p, 'utf8'),
    stdRoot: STD_ROOT,
  });
}


const [,, cmd, ...rest] = process.argv;

/**
 * Print to stderr.
 * @param {string} msg
 */
function stderr(msg) { process.stderr.write(msg + '\n'); }

/**
 * Print to stdout.
 * @param {string} msg
 */
function stdout(msg) { process.stdout.write(msg + '\n'); }

/** @param {string} msg */
function die(msg) { stderr(`error: ${msg}`); process.exit(1); }

// ── Argument parsing helpers ─────────────────────────────────────────────────

/**
 * Find `-o <path>` in an argument list.
 * @param {string[]} args
 * @returns {string|null}
 */
function parseOutput(args) {
  const idx = args.indexOf('-o');
  return idx !== -1 ? args[idx + 1] ?? null : null;
}

/**
 * Derive the .wat output path from a .wasm path (replaces or appends extension).
 * @param {string} wasmPath
 * @returns {string}
 */
function watPathFrom(wasmPath) {
  return wasmPath.replace(/\.wasm$/, '.wat') + (wasmPath.endsWith('.wasm') ? '' : '.wat');
}

// ── Commands ──────────────────────────────────────────────────────────────────

/**
 * Find `--flag <value>` in an argument list.
 * @param {string[]} args
 * @param {string} flag
 * @returns {string|null}
 */
function parseFlag(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] ?? null : null;
}

async function cmdCompile(args) {
  const input      = args[0];
  const output     = parseOutput(args);
  const emitWat    = args.includes('--emit-wat');
  const saveWat    = args.includes('--save-wat');
  const lib        = args.includes('--lib');
  const target     = parseFlag(args, '--target') ?? 'wasm32-wasip1';
  const emitLayout = parseFlag(args, '--emit-layout');

  if (!input)  die('Usage: jswat compile <input.js> -o <output.wasm> [--emit-wat] [--save-wat] [--lib] [--target wasm32-wasip1|wasm32-unknown] [--emit-layout <file>]');
  if (!output) die('Missing -o <output> flag');

  const source = await readFile(input, 'utf8');
  const result = await compileSource(source, input, {
    readFile: (p) => readFileSync(p, 'utf8'),
    stdRoot: STD_ROOT,
    target,
    lib,
  });

  for (const w of result.warnings) stderr(`warning: ${w}`);

  mkdirSync(dirname(output), { recursive: true });
  if (!saveWat) {
    writeFileSync(output, result.wasm);
    stdout(`Compiled ${input} → ${output}`);
  }
  if (emitWat || saveWat) {
    const watPath = saveWat ? output : watPathFrom(output);
    writeFileSync(watPath, result.wat, 'utf8');
    stdout(`WAT      ${input} → ${watPath}`);
  }
  if (emitLayout) {
    writeFileSync(resolve(emitLayout), JSON.stringify(result.layoutMap, null, 2), 'utf8');
    stdout(`Layout   ${input} → ${emitLayout}`);
  }
}

async function cmdBuild(args) {
  // Phase 1: build is identical to compile
  return cmdCompile(args);
}

async function cmdCheck(args) {
  const input = args[0];
  if (!input) die('Usage: jswat check <input.js>');

  const result = await compile({ input, checkOnly: true });
  for (const w of result.warnings) stderr(`warning: ${w}`);
  stdout('OK');
}

async function cmdInspect(args) {
  const input = args[0];
  if (!input) die('Usage: jswat inspect <input.wasm>');

  const buf = readFileSync(input);
  const wat = await wasmToWat(buf);
  stdout(wat);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

const commands = { compile: cmdCompile, build: cmdBuild, check: cmdCheck, inspect: cmdInspect };

if (!cmd || !commands[cmd]) {
  stderr('Usage: jswat <compile|build|check|inspect> [options]');
  process.exit(1);
}

commands[cmd](rest).catch(err => {
  stderr(`error: ${err.message}`);
  process.exit(1);
});
