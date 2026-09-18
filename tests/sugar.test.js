import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../js/core/rng.js';
import { spawnSugarWave } from '../js/game/sugar.js';
import { collectSugars, hitsAny } from '../js/game/collision.js';
test('0..4 muffins per wave, speeds 3..4, 2/3 slope', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const wave = spawnSugarWave(createRng(seed));
    assert.ok(wave.length <= 4);
    for (const s of wave) {
      assert.ok([3, 4].includes(Math.abs(s.vx)));
      assert.ok(Math.abs(Math.abs(s.vy) - Math.abs(s.vx) * 2 / 3) < 1e-9);
    }
  }
});
test('fuel balance: expected muffins per 100 frames >= 0.5 (drain is 5 fuel, muffin gives 10)', () => {
  let total = 0; for (let seed = 1; seed <= 2000; seed++) total += spawnSugarWave(createRng(seed)).length;
  assert.ok(total / 2000 >= 0.5, `avg ${total / 2000}`);
});
test('collect removes touched muffins; hitsAny detects overlap', () => {
  const sugars = [{ x: 100, y: 100, r: 12 }, { x: 400, y: 400, r: 12 }];
  assert.equal(collectSugars({ x: 105, y: 100 }, sugars), 1); assert.equal(sugars.length, 1);
  assert.equal(hitsAny({ x: 0, y: 0 }, [{ x: 20, y: 0, r: 13 }]), true);
  assert.equal(hitsAny({ x: 0, y: 0 }, [{ x: 40, y: 0, r: 13 }]), false);
});
