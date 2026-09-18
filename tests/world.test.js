import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, stepWorld } from '../js/game/world.js';
test('world is deterministic and does not leak entities', () => {
  const a = createWorld(11), b = createWorld(11);
  for (let f = 0; f < 6000; f++) { stepWorld(a); stepWorld(b); assert.ok(a.enemies.length < 200); }
  assert.deepEqual(a.enemies.map((e) => [e.x, e.y]), b.enemies.map((e) => [e.x, e.y]));
  assert.equal(a.frame, 6000);
});
