// Demonstrates: std/io stdin.read and stdin.readAll.
import { console, stdin } from "std/io";

function readOnce() {
  const s = stdin.read(usize(1024));
  if (s) console.log(s);
}

function readAll() {
  const s = stdin.readAll();
  if (s) console.log(s);
}

function readLine() {
  const s = stdin.readLine();
  if (s) console.log(s);
}

console.log(`${stdin.readAll()}booo`)
