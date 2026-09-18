import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../js/core/rng.js';

test('same seed gives same sequence', () => {
  const a = createRng(42), b = createRng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});
test('different seeds differ', () => {
  assert.notEqual(createRng(1).next(), createRng(2).next());
});
test('int is inclusive and in range', () => {
  const r = createRng(7); const seen = new Set();
  for (let i = 0; i < 2000; i++) { const v = r.int(2, 4); assert.ok(v >= 2 && v <= 4); seen.add(v); }
  assert.deepEqual([...seen].sort(), [2, 3, 4]);
});
test('pick returns an element, chance respects bounds', () => {
  const r = createRng(3);
  assert.ok(['a', 'b'].includes(r.pick(['a', 'b'])));
  assert.equal(r.chance(0), false); assert.equal(r.chance(1), true);
});
