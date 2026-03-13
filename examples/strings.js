/**
 * @fileoverview std/string examples — length, slice, indexOf, concat,
 * startsWith, endsWith, includes, equals, charAt, String.from.
 */
import { String } from 'std/string';

// Return the number of vowels in a string (a/e/i/o/u, lowercase).
//@export
function countVowels(s = '') {
  let count = 0;
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === 97 || c === 101 || c === 105 || c === 111 || c === 117) {
      count = count + 1;
    }
    i = i + 1;
  }
  return count;
}

// Return a greeting: "Hello, <name>! (n chars)"
//@export
function greet(name = '') {
  const prefix = 'Hello, ';
  const suffix = '!';
  const msg = prefix.concat(name).concat(suffix);
  return msg.length;
}

// Find the word "world" in a sentence.
//@export
function findWorld() {
  const s = 'the quick brown fox jumps over the world';
  const needle = 'world';
  return s.indexOf(needle);
}

// Check prefix/suffix of a filename-like string.
//@export
function isJsFile(name = '') { return name.endsWith('.js') ? 1 : 0; }
//@export
function isAbsPath(path = '') { return path.startsWith('/') ? 1 : 0; }

// Build a decimal string and check it.
//@export
function numberToStr(n = 0) {
  const s = String.from(n);
  return s.length;
}

// Extract middle portion of a string.
//@export
function middle() {
  const s = 'abcdefghij';
  return s.slice(3, 7).length;  // 'defg' → 4
}
