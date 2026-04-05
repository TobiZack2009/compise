/**
 * Number guessing game for the wasm32-js-esm target.
 *
 * Run via the bridge:
 *   jswat compile examples/guess-node.js -o dist/guess.mjs --target wasm32-js-esm
 *   node dist/guess.mjs
 *
 * Uses std/io (stdin/stdout) and std/random.
 */
import { stdin, console } from "std/io";
import Random from "std/random";

const secret = isize(Random.float() * 100.0) + 1;
let attempts = 0;

console.log("=== Number Guessing Game ===");
console.log("Guess a number between 1 and 100.");

while (true) {
  console.log("Your guess: ");
  const line = stdin.readLine();
  if (!line) {
    console.log("No input — goodbye!");
    break;
  }
  const guess = isize(line);
  attempts = attempts + 1;
  if (guess < secret) {
    console.log("Too low! Try higher.");
  } else if (guess > secret) {
    console.log("Too high! Try lower.");
  } else {
    console.log(`Correct! You got it in ${attempts} attempt(s). The number was ${secret}.`);
    break;
  }
}
