// tests/director.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENEMY } from '../js/config.js';
import { createRng } from '../js/core/rng.js';
import { createDirector, stepDirector, waveInterval } from '../js/game/director.js';

test('waveInterval goes 60 -> 35 over 12 shifts and stays', () => {
  assert.equal(waveInterval(0), 60); assert.equal(waveInterval(12), 35); assert.equal(waveInterval(40), 35);
  assert.ok(waveInterval(6) < 60 && waveInterval(6) > 35);
});
test('first second is empty, first wave at frame 60 has 2-4 enemies from the right', () => {
  const d = createDirector(createRng(1)); let first = null;
  for (let f = 1; f <= 60 && !first; f++) { const s = stepDirector(d); if (s.enemies.length) first = { f, s }; }
  assert.equal(first.f, 60);
  assert.ok(first.s.enemies.length >= 1 && first.s.enemies.length <= 4);
  assert.ok(first.s.enemies.every((e) => e.vx < 0 && e.vy === 0));
});
test('15s attack -> 5s warning without spawns -> new mode, difficulty +0.05', () => {
  const d = createDirector(createRng(5));
  for (let f = 0; f < 900; f++) stepDirector(d);
  assert.equal(d.phase, 'warning'); assert.ok(d.warnings.length >= 1);
  for (let f = 0; f < 299; f++) assert.equal(stepDirector(d).enemies.length, 0);
  stepDirector(d);
  assert.equal(d.phase, 'attack'); assert.equal(d.shift, 1);
  assert.ok(Math.abs(d.difficulty - 0.25) < 1e-9);
});
test('a warning carries the descriptor of the attack it announces and its own age', () => {
  const d = createDirector(createRng(5));
  for (let f = 0; f < 900; f++) stepDirector(d);
  assert.equal(d.phase, 'warning');
  assert.ok(d.warnings.length >= 1);
  for (const w of d.warnings) {
    assert.ok(w.kind === 'side' || w.kind === 'corner', 'a warning names a side or a corner');
    assert.equal(w.age, 0, 'a warning starts at age 0, so the fade starts lit');
  }
  for (let f = 1; f <= 299; f++) {
    stepDirector(d);
    assert.ok(d.warnings.every((w) => w.age === f), `age at frame ${f}`);
  }
  stepDirector(d);
  assert.equal(d.phase, 'attack');
  assert.deepEqual(d.warnings, [], 'the signs go with the warning phase');
});

test('a double side warns twice, one descriptor per stream', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const d = createDirector(createRng(seed));
    for (let f = 0; f < 1200 * 10; f++) {
      stepDirector(d);
      if (d.phase === 'warning' && d.nextPlan) {
        assert.equal(d.warnings.length, d.nextPlan.modes.length, `seed ${seed}, shift ${d.shift}`);
      }
    }
  }
});

test('single plans never repeat the previous mode; doubles are perpendicular; no doubles before shift 4', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const d = createDirector(createRng(seed)); let prev = d.plan;
    for (let f = 0; f < 1200 * 15; f++) {
      stepDirector(d);
      if (d.plan !== prev) {
        if (d.plan.type === 'single' && prev.modes) assert.ok(!prev.modes.includes(d.plan.modes[0]));
        if (d.plan.type === 'double') {
          assert.ok(d.shift >= 4);
          const [a, b] = d.plan.modes; assert.ok(a <= 2 && b >= 3 && b <= 4);
        }
        prev = d.plan;
      }
    }
  }
});
test('every plan is a plain attack with the original cherry', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const d = createDirector(createRng(seed)); let prev = null;
    for (let f = 0; f < 1200 * 15; f++) {
      stepDirector(d);
      if (d.plan !== prev) {
        assert.notEqual(d.plan.type, 'event', `seed ${seed}: an event plan at shift ${d.shift}`);
        assert.equal(d.plan.fruit, 'cherry', `seed ${seed}: fruit at shift ${d.shift}`);
        assert.ok(Array.isArray(d.plan.modes) && d.plan.modes.length >= 1);
        prev = d.plan;
      }
    }
  }
});
test('every spawned enemy is a cherry of the standard size', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const d = createDirector(createRng(seed));
    for (let f = 0; f < 1200 * 15; f++) {
      for (const e of stepDirector(d).enemies) {
        assert.equal(e.sprite, 'cherry');
        assert.equal(e.size, ENEMY.SIZE);
        assert.equal(e.r, ENEMY.HIT_R);
      }
    }
  }
});
test('deterministic for a given seed', () => {
  const run = (seed) => { const d = createDirector(createRng(seed)); const log = [];
    for (let f = 0; f < 3000; f++) { const s = stepDirector(d); if (s.enemies.length) log.push(f, s.enemies.length, s.enemies[0].y); }
    return log; };
  assert.deepEqual(run(9), run(9));
});
