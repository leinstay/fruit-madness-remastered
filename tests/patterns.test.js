// tests/patterns.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../js/core/rng.js';
import { createFormation, maxGapShift, FORMATIONS } from '../js/game/patterns.js';

test('maxGapShift: 60 frames/90px -> 2, 35 frames/90px -> 1, never below 1', () => {
  assert.equal(maxGapShift(60, 90), 2);
  assert.equal(maxGapShift(35, 90), 1);
  assert.equal(maxGapShift(10, 120), 1);
});
for (const kind of FORMATIONS) {
  test(`${kind}: gap is free, shift bounded, size bounded`, () => {
    for (let seed = 1; seed <= 50; seed++) {
      const f = createFormation(kind, createRng(seed), { maxShift: 1, maxEnemies: 4 });
      let prev = null;
      for (let i = 0; i < 40; i++) {
        const w = f.next();
        assert.ok(w.gap >= 0 && w.gap <= 4);
        assert.ok(!w.lanes.includes(w.gap), `${kind} seed ${seed}: gap blocked`);
        assert.equal(new Set(w.lanes).size, w.lanes.length);
        assert.ok(w.lanes.every((l) => l >= 0 && l <= 4));
        assert.ok(w.lanes.length <= 4);
        if (prev !== null) assert.ok(Math.abs(w.gap - prev) <= 1, `${kind} seed ${seed}: gap jumped`);
        prev = w.gap;
      }
    }
  });
}
test('maxEnemies is respected', () => {
  const f = createFormation('wallGap', createRng(1), { maxShift: 1, maxEnemies: 2 });
  for (let i = 0; i < 20; i++) assert.ok(f.next().lanes.length <= 2);
});
