// Reads a file and returns its content as a string. Tests FS bridge hooks.
import { FS } from "std/fs";

//@export("readFile")
function readFile(path = "") {
  return FS.read(path);
}

//@export("fileExists")
function fileExists(path = "") {
  return FS.exists(path) ? 1 : 0;
}
