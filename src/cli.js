#!/usr/bin/env node
/**
 * @fileoverview jswat CLI entry point — argument parsing and command dispatch.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { compile, wasmToWat } from './compiler.js';

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

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdCompile(args) {
  const input  = args[0];
  const output = parseOutput(args);
  if (!input)  die('Usage: jswat compile <input.js> -o <output.wasm>');
  if (!output) die('Missing -o <output> flag');

  const result = await compile({ input, output });

  for (const w of result.warnings) stderr(`warning: ${w}`);

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, result.wasm);
  stdout(`Compiled ${input} → ${output}`);
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
