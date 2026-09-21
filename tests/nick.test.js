import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNick } from '../js/game/nick.js';

// The owner's rule: 3 to 6 characters, ASCII letters and digits only (^[A-Za-z0-9]{3,6}$).
// The same expression is enforced server side in firestore.rules, which accepts either case.
// An accepted nickname comes back upper-cased, arcade style.

test('nick rules', () => {
  assert.deepEqual(validateNick('  Lein  '), { ok: true, value: 'LEIN' });
  assert.deepEqual(validateNick('Lein'), { ok: true, value: 'LEIN' });
  assert.equal(validateNick('ab').error, 'short');
  assert.equal(validateNick('abcdefg').error, 'long');
  assert.equal(validateNick('a b').error, 'chars');
  assert.equal(validateNick('Панда').error, 'chars');
  assert.equal(validateNick('a_b').error, 'chars');
  assert.equal(validateNick('<b>').error, 'chars');
});

test('nick length boundaries', () => {
  assert.deepEqual(validateNick('abc'), { ok: true, value: 'ABC' });
  assert.deepEqual(validateNick('abcdef'), { ok: true, value: 'ABCDEF' });
  assert.deepEqual(validateNick('A1b2C3'), { ok: true, value: 'A1B2C3' });
  assert.deepEqual(validateNick('007'), { ok: true, value: '007' });
});

test('an accepted nick comes back in capitals', () => {
  assert.deepEqual(validateNick('bob'), { ok: true, value: 'BOB' });
  assert.deepEqual(validateNick('PoTaTo'), { ok: true, value: 'POTATO' });
  // Already upper case: unchanged, and the length limit still counts characters, not case.
  assert.deepEqual(validateNick('LEIN'), { ok: true, value: 'LEIN' });
  assert.deepEqual(validateNick('z9'), { ok: false, error: 'short' });
  // Upper-casing never rescues an invalid nickname, and never creates a valid one out of a
  // character that grows when it is cased (German 'ss' would be six letters otherwise).
  assert.equal(validateNick('ßßß').error, 'chars');
  assert.equal(validateNick('abcdefg').error, 'long');
});

test('nick edge cases', () => {
  assert.equal(validateNick('').error, 'short');
  assert.equal(validateNick('   ').error, 'short');
  assert.equal(validateNick(null).error, 'short');
  assert.equal(validateNick(undefined).error, 'short');
  // Trimming happens first, so only the outer whitespace is forgiven.
  assert.deepEqual(validateNick('\t Lein\n'), { ok: true, value: 'LEIN' });
  // Inner whitespace is no longer collapsed: a space is simply an invalid character.
  assert.equal(validateNick('a  b').error, 'chars');
  assert.equal(validateNick('a\tb').error, 'chars');
  // Length is judged before the character class, on the trimmed value.
  assert.equal(validateNick('a b c d').error, 'long');
  assert.equal(validateNick('a_b_c_d').error, 'long');
  assert.equal(validateNick('🐼🐼🐼').error, 'chars');
  assert.equal(validateNick('a-b').error, 'chars');
});
