import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNick } from '../js/game/nick.js';

test('nick rules', () => {
  assert.deepEqual(validateNick('  Lein  '), { ok: true, value: 'Lein' });
  assert.deepEqual(validateNick('Панда_1'), { ok: true, value: 'Панда_1' });
  assert.deepEqual(validateNick('a  b'), { ok: true, value: 'a b' });
  assert.equal(validateNick('ab').error, 'short');
  assert.equal(validateNick('abcdefghijklm').error, 'long');
  assert.equal(validateNick('<script>').error, 'chars');
});

test('nick edge cases', () => {
  assert.equal(validateNick('').error, 'short');
  assert.equal(validateNick('   ').error, 'short');
  assert.equal(validateNick(null).error, 'short');
  assert.equal(validateNick(undefined).error, 'short');
  // Tabs and newlines collapse like spaces, and the length is judged after collapsing.
  assert.deepEqual(validateNick('a\t\tb'), { ok: true, value: 'a b' });
  assert.deepEqual(validateNick('abcdefghijkl'), { ok: true, value: 'abcdefghijkl' });
  // 13 characters only because of the repeated spaces -> valid once collapsed.
  assert.deepEqual(validateNick('panda    pilot'), { ok: true, value: 'panda pilot' });
  assert.equal(validateNick('emoji 🐼').error, 'chars');
  assert.deepEqual(validateNick('a-b_c'), { ok: true, value: 'a-b_c' });
});
