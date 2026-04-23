/**
 * Compise Browser Editor — main.js
 *
 * Uses CodeMirror 6 for editing and the compiled Compise compiler
 * (dist/compise.esm.js) to compile + run user code in the browser.
 */

import { EditorView, basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { compile } from '../dist/compise.esm.js';
import { generateBridge } from '../dist/compise.esm.js';
import { STD_FILES } from './std-bundle.js';

// ── DOM refs ─────────────────────────────────────────────────────────────────

const outputEl   = document.getElementById('output');
const statusEl   = document.getElementById('status');
const runBtn     = document.getElementById('btn-run');
const watBtn     = document.getElementById('btn-wat');

// ── Editor setup ──────────────────────────────────────────────────────────────

const editor = new EditorView({
  extensions: [
    basicSetup,
    javascript(),
    oneDark,
    EditorView.theme({
      '&': { height: '100%', fontSize: '14px' },
      '.cm-scroller': { overflow: 'auto', fontFamily: "'Fira Code', 'Cascadia Code', monospace" },
    }),
  ],
  parent: document.getElementById('editor'),
  doc: `import { Math } from "std/math";
import { console } from "std/io";

// Compise — runs in your browser!
for (let i = 1; i <= 20; i = i + 1) {
  const v = Math.sqrt(f64(i));
  console.log(String.from(i) + "\\t" + String.from(v));
}
`,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setStatus(msg, ok = true) {
  statusEl.textContent = msg;
  statusEl.className = ok ? 'status ok' : 'status err';
}

function clearOutput() {
  outputEl.innerHTML = '';
}

function appendOutput(text, kind = 'log') {
  const line = document.createElement('div');
  line.className = `out-line out-${kind}`;
  line.textContent = text;
  outputEl.appendChild(line);
  outputEl.scrollTop = outputEl.scrollHeight;
}

// ── readFile shim — resolves std/* imports from the bundled map ───────────────

function readFile(path) {
  if (Object.prototype.hasOwnProperty.call(STD_FILES, path)) {
    return STD_FILES[path];
  }
  return null;
}

// ── Run ───────────────────────────────────────────────────────────────────────

let lastWat = '';

runBtn.addEventListener('click', async () => {
  clearOutput();
  setStatus('Compiling…');
  runBtn.disabled = true;

  const source = editor.state.doc.toString();

  // Capture console output by overriding the global console temporarily.
  // The generated wasm32-js-bundle bridge calls console.log/error/warn,
  // which we intercept here to show in the output panel.
  const _log   = console.log;
  const _error = console.error;
  const _warn  = console.warn;
  console.log   = (s) => { appendOutput(String(s), 'log');   _log(s);   };
  console.error = (s) => { appendOutput(String(s), 'error'); _error(s); };
  console.warn  = (s) => { appendOutput(String(s), 'warn');  _warn(s);  };

  let blobUrl = null;
  try {
    // Compile to raw WASM binary + export metadata
    const result = await compile(source, '<editor>', {
      target: 'wasm32-js-bundle',
      readFile,
      stdRoot: '',
    });

    lastWat = result.wat ?? '';

    // Generate the self-contained JS bridge (WASM inlined as base64)
    const bridgeJs = generateBridge(result.binary, result.exportList ?? [], {
      target: 'wasm32-js-bundle',
    });

    // Dynamically import the generated JS via a Blob URL
    const blob = new Blob([bridgeJs], { type: 'text/javascript' });
    blobUrl = URL.createObjectURL(blob);
    await import(blobUrl);

    setStatus('Done.');
  } catch (err) {
    appendOutput(err.message, 'error');
    setStatus(err.message.slice(0, 80), false);
  } finally {
    console.log   = _log;
    console.error = _error;
    console.warn  = _warn;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    runBtn.disabled = false;
  }
});

// ── WAT viewer ────────────────────────────────────────────────────────────────

watBtn.addEventListener('click', async () => {
  if (!lastWat) {
    // Compile first to get WAT, without running
    const source = editor.state.doc.toString();
    try {
      const result = await compile(source, '<editor>', { readFile, stdRoot: '' });
      lastWat = result.wat ?? '';
    } catch (err) {
      appendOutput(err.message, 'error');
      return;
    }
  }
  clearOutput();
  const pre = document.createElement('pre');
  pre.className = 'out-wat';
  pre.textContent = lastWat;
  outputEl.appendChild(pre);
});
