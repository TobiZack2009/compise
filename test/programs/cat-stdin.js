// Reads all stdin and writes it to stdout — tests IO bridge hooks.
import { stdin, stdout } from "std/io";

const data = stdin.readAll();
if (data) {
  stdout.write(data);
}
