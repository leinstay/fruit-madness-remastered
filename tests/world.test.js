import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, stepWorld } from '../js/game/world.js';
import { DIRECTOR } from '../js/config.js';

test('the world publishes the warning descriptors and how old they are', () => {
  const w = createWorld(3);
  assert.deepEqual(w.warnings, []);
  for (let f = 0; f < DIRECTOR.ATTACK_FRAMES; f++) stepWorld(w);
  assert.ok(w.warnings.length >= 1, 'the warning phase shows at least one sign');
  for (const wn of w.warnings) {
    assert.ok(wn.kind === 'side' || wn.kind === 'corner');
    assert.equal(wn.age, 0);
  }
  stepWorld(w);
  assert.ok(w.warnings.every((wn) => wn.age === 1), 'the age grows with the phase');
  for (let f = 1; f < DIRECTOR.WARNING_FRAMES; f++) stepWorld(w);
  assert.deepEqual(w.warnings, [], 'and the signs leave with it');
});

test('world is deterministic and does not leak entities', () => {
  const a = createWorld(11), b = createWorld(11);
  for (let f = 0; f < 6000; f++) { stepWorld(a); stepWorld(b); assert.ok(a.enemies.length < 200); }
  assert.deepEqual(a.enemies.map((e) => [e.x, e.y]), b.enemies.map((e) => [e.x, e.y]));
  assert.equal(a.frame, 6000);
});
