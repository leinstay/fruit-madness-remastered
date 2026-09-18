import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNick } from '../js/game/nick.js';

// The owner's rule: 3 to 6 characters, ASCII letters and digits only (^[A-Za-z0-9]{3,6}$).
// The same expression is enforced server side in firestore.rules.

test('nick rules', () => {
  assert.deepEqual(validateNick('  Lein  '), { ok: true, value: 'Lein' });
  assert.deepEqual(validateNick('Lein'), { ok: true, value: 'Lein' });
  assert.equal(validateNick('ab').error, 'short');
  assert.equal(validateNick('abcdefg').error, 'long');
  assert.equal(validateNick('a b').error, 'chars');
  assert.equal(validateNick('Панда').error, 'chars');
  assert.equal(validateNick('a_b').error, 'chars');
  assert.equal(validateNick('<b>').error, 'chars');
});

test('nick length boundaries', () => {
  assert.deepEqual(validateNick('abc'), { ok: true, value: 'abc' });
  assert.deepEqual(validateNick('abcdef'), { ok: true, value: 'abcdef' });
  assert.deepEqual(validateNick('A1b2C3'), { ok: true, value: 'A1b2C3' });
  assert.deepEqual(validateNick('007'), { ok: true, value: '007' });
});

test('nick edge cases', () => {
  assert.equal(validateNick('').error, 'short');
  assert.equal(validateNick('   ').error, 'short');
  assert.equal(validateNick(null).error, 'short');
  assert.equal(validateNick(undefined).error, 'short');
  // Trimming happens first, so only the outer whitespace is forgiven.
  assert.deepEqual(validateNick('\t Lein\n'), { ok: true, value: 'Lein' });
  // Inner whitespace is no longer collapsed: a space is simply an invalid character.
  assert.equal(validateNick('a  b').error, 'chars');
  assert.equal(validateNick('a\tb').error, 'chars');
  // Length is judged before the character class, on the trimmed value.
  assert.equal(validateNick('a b c d').error, 'long');
  assert.equal(validateNick('a_b_c_d').error, 'long');
  assert.equal(validateNick('🐼🐼🐼').error, 'chars');
  assert.equal(validateNick('a-b').error, 'chars');
});
