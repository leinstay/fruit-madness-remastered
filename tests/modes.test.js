// tests/modes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, spawnEnemy, stepEnemy, isOffscreen } from '../js/game/modes.js';
import { W, H } from '../js/config.js';

test('mode 1: from right, lane centers, speed 7+d', () => {
  const e = spawnEnemy(1, 0, 0.2);
  assert.equal(e.x, W + e.size); assert.equal(e.y, 45); assert.equal(e.vx, -7.2); assert.equal(e.vy, 0);
  assert.equal(spawnEnemy(1, 4, 0).y, 405);
});
test('mode 3: from top, moves down at 5+d', () => {
  const e = spawnEnemy(3, 2, 0); assert.equal(e.x, 300); assert.equal(e.vy, 5);
});
test('mode 5: diagonal down-right with 2/3 slope', () => {
  const e = spawnEnemy(5, 2, 0); assert.equal(e.vx, 4); assert.ok(Math.abs(e.vy - 8 / 3) < 1e-9);
  assert.ok(e.x < 0 && e.y < 0);
});
test('every mode eventually crosses the field and leaves', () => {
  for (const id of Object.keys(MODES)) for (let lane = 0; lane < 5; lane++) {
    const e = spawnEnemy(+id, lane, 0); let entered = false;
    for (let i = 0; i < 600 && !(entered && isOffscreen(e)); i++) {
      stepEnemy(e); if (e.x > 0 && e.x < W && e.y > 0 && e.y < H) entered = true;
    }
    assert.ok(entered, `mode ${id} lane ${lane} never entered`);
    assert.ok(isOffscreen(e), `mode ${id} lane ${lane} never left`);
  }
});
