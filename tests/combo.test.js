import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombo, comboCollect, comboMiss, comboMultiplier } from '../js/game/combo.js';
test('fills 4 cells, multiplier 1..5, bonus 500 when full, miss resets', () => {
  const c = createCombo(); assert.equal(comboMultiplier(c), 1);
  for (let i = 1; i <= 4; i++) { assert.equal(comboCollect(c), 0); assert.equal(comboMultiplier(c), 1 + i); }
  assert.equal(comboCollect(c), 500); assert.equal(comboMultiplier(c), 5);
  comboMiss(c); assert.equal(comboMultiplier(c), 1);
});
