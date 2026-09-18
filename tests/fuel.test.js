import test from 'node:test';
import assert from 'node:assert/strict';
import { createFuel, stepFuel, addFuel } from '../js/game/fuel.js';
test('drains 0.05 per frame, clamps 0..100, muffin adds', () => {
  const f = createFuel(); assert.equal(f.value, 100);
  stepFuel(f); assert.ok(Math.abs(f.value - 99.95) < 1e-9);
  addFuel(f, 10); assert.equal(f.value, 100);
  f.value = 0.01; stepFuel(f); assert.equal(f.value, 0);
});
