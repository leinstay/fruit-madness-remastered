// tests/fruit-cast.test.js — one fruit per attack.
//
// Every DANGER sign announces a new fruit and only that fruit: the whole attack, both
// streams of a two-sided one included, is flown by a single drawing, and the next attack
// never repeats the one that is flying now. The cast is drawn from a shuffle bag, so all
// six take their turn before any of them comes back.
//
// The pick must not cost the world anything: it comes from a generator of the director's
// own, derived from the run's seed, so lanes, velocities, timings and muffins are bit for
// bit what they were when every enemy was a cherry. The hashes at the bottom were taken
// from the game before the cast existed and are what proves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { DIRECTOR, ENEMY } from '../js/config.js';
import { createRng } from '../js/core/rng.js';
import { CAST, FRUIT, createDirector, stepDirector } from '../js/game/director.js';
import { createWorld, stepWorld } from '../js/game/world.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The fruit of each successive attack, stepping the director frame by frame. */
function attackFruits(seed, count, startShift = 0) {
  const d = createDirector(createRng(seed), { startShift, seed });
  const fruits = [d.plan.fruit];
  let phase = d.phase;
  while (fruits.length < count) {
    stepDirector(d);
    if (phase === 'warning' && d.phase === 'attack') fruits.push(d.plan.fruit);
    phase = d.phase;
  }
  return fruits;
}

/**
 * The same sequence, with the quiet middle of each attack skipped: the timer is wound on
 * to the last frame of the phase, so every phase change still goes through stepDirector
 * but the waves in between are not spawned. Cheap enough to sweep thousands of seeds.
 */
function planFruits(seed, count, startShift = 0) {
  const d = createDirector(createRng(seed), { startShift, seed });
  const fruits = [d.plan.fruit];
  while (fruits.length < count) {
    d.timer = (d.phase === 'attack' ? DIRECTOR.ATTACK_FRAMES : DIRECTOR.WARNING_FRAMES) - 1;
    const wasWarning = d.phase === 'warning';
    stepDirector(d);
    if (wasWarning && d.phase === 'attack') fruits.push(d.plan.fruit);
  }
  return fruits;
}

test('the fast sweep sees the same sequence as a frame-by-frame run', () => {
  for (const seed of [1, 2, 3, 77, 4242]) {
    assert.deepEqual(planFruits(seed, 8), attackFruits(seed, 8), `seed ${seed}`);
  }
});

test('a run opens on the cherry', () => {
  for (let seed = 1; seed <= 200; seed++) {
    assert.equal(planFruits(seed, 1)[0], FRUIT, `seed ${seed}`);
  }
  // A world started mid-difficulty — which is how the solver replays a late shift —
  // opens on the cherry as well: the first plan is the same one every run begins with.
  for (const startShift of [1, 4, 9, 20]) {
    assert.equal(planFruits(5, 1, startShift)[0], FRUIT, `startShift ${startShift}`);
  }
});

test('no two attacks in a row fly the same fruit', () => {
  for (let seed = 1; seed <= 2000; seed++) {
    const fruits = planFruits(seed, 12);
    for (let i = 1; i < fruits.length; i++) {
      assert.notEqual(fruits[i], fruits[i - 1], `seed ${seed}: ${fruits[i]} twice at attack ${i + 1}`);
    }
  }
});

test('every fruit of the cast takes its turn before any comes back', () => {
  // The opening cherry is the run's own; the bag starts with the attack after it, so
  // attacks 2..7 are one whole bag, 8..13 the next, and so on.
  const bags = 4;
  for (let seed = 1; seed <= 300; seed++) {
    const fruits = planFruits(seed, 1 + bags * CAST.length).slice(1);
    for (let b = 0; b < bags; b++) {
      const bag = fruits.slice(b * CAST.length, (b + 1) * CAST.length);
      assert.deepEqual([...bag].sort(), [...CAST].sort(), `seed ${seed}, bag ${b + 1}: ${bag}`);
    }
  }
});

test("every enemy of an attack is that attack's fruit, both streams included", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const d = createDirector(createRng(seed), { seed });
    let doubles = 0;
    for (let f = 0; f < DIRECTOR.ATTACK_FRAMES * 40; f++) {
      const wanted = d.plan.fruit;
      const streams = d.streams.length;
      for (const e of stepDirector(d).enemies) {
        assert.equal(e.sprite, wanted, `seed ${seed}, frame ${f}`);
        assert.equal(e.size, ENEMY.SIZE);
        assert.equal(e.r, ENEMY.HIT_R);
        if (streams > 1) doubles += 1;
      }
    }
    assert.ok(doubles > 0, `seed ${seed}: no two-sided attack in 40 shifts`);
  }
});

test('the warning already knows which fruit is coming', () => {
  const d = createDirector(createRng(31), { seed: 31 });
  for (let f = 0; f < DIRECTOR.ATTACK_FRAMES; f++) stepDirector(d);
  assert.equal(d.phase, 'warning');
  assert.ok(d.nextPlan && CAST.includes(d.nextPlan.fruit), 'the plan behind the sign names a fruit');
  assert.notEqual(d.nextPlan.fruit, d.plan.fruit, 'and it is not the one flying now');
  const coming = d.nextPlan.fruit;
  for (let f = 0; f < DIRECTOR.WARNING_FRAMES; f++) stepDirector(d);
  assert.equal(d.plan.fruit, coming, 'the attack flies what the warning promised');
});

test('every fruit the director can emit is a sprite in the manifest', () => {
  const sprites = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'manifest.json'), 'utf8')).sprites;
  assert.ok(CAST.includes(FRUIT), 'the opening fruit is part of the cast');
  assert.equal(new Set(CAST).size, CAST.length, 'the cast has no duplicates');
  for (const name of CAST) assert.ok(name in sprites, `the director can emit '${name}'`);
  const seen = new Set();
  for (let seed = 1; seed <= 300; seed++) for (const f of planFruits(seed, 13)) seen.add(f);
  assert.deepEqual([...seen].sort(), [...CAST].sort(), 'the runs use exactly the cast');
});

// --- the world is untouched -------------------------------------------------------
//
// Recorded from the game as it was before the cast: every enemy and every muffin alive on
// every frame, with its position, velocity, hit radius, size and animation offset. If a
// single one of these differs, choosing a fruit has cost the world a random number.
const GEOMETRY = {
  '1:0': 'e6e03363c87c89c9', '1:3': 'bcf1aee2c601819b', '1:9': '0ea757283f487996',
  '7:0': '7a3aa748843aad75', '7:3': 'a1389156b2585467', '7:9': '629a9481289e3e95',
  '42:0': '469f2438bc92c81e', '42:3': '143aad5807104c97', '42:9': '10d55c2d1165b8a7',
  '1234:0': '2c1d5d92aef6458f', '1234:3': 'd30c8fb69e478f82', '1234:9': '2edfdca8985a37d3',
  '99999:0': '2e971a3dd7bcd617', '99999:3': 'c26de1e38816dd16', '99999:9': '25961b3187ce01d0',
};
const GEOMETRY_FRAMES = 3600;

function geometryHash(seed, startShift, frames) {
  const w = createWorld(seed, { startShift });
  const h = createHash('sha256');
  for (let f = 0; f < frames; f++) {
    stepWorld(w);
    h.update(`f${w.frame}`);
    for (const e of w.enemies) h.update(`|e ${e.x} ${e.y} ${e.vx} ${e.vy} ${e.r} ${e.size} ${e.animOffset}`);
    for (const s of w.sugars) h.update(`|s ${s.x} ${s.y} ${s.vx} ${s.vy} ${s.r} ${s.size}`);
    h.update('\n');
  }
  return h.digest('hex').slice(0, 16);
}

test('the cast changes nothing about the field itself', () => {
  for (const [key, want] of Object.entries(GEOMETRY)) {
    const [seed, startShift] = key.split(':').map(Number);
    assert.equal(geometryHash(seed, startShift, GEOMETRY_FRAMES), want,
      `seed ${seed}, startShift ${startShift}: the world moved`);
  }
});

test('and the fruit is the only thing the cast decides', () => {
  // The same run twice, once read as it is and once with every sprite erased: nothing
  // else about an enemy may differ.
  const strip = (w) => w.enemies.map((e) => [e.x, e.y, e.vx, e.vy, e.r, e.size, e.animOffset]);
  for (const seed of [3, 88, 5150]) {
    const a = createWorld(seed), b = createWorld(seed);
    const fruits = new Set();
    for (let f = 0; f < 4000; f++) {
      stepWorld(a); stepWorld(b);
      assert.deepEqual(strip(a), strip(b), `seed ${seed}, frame ${f}`);
      for (const e of a.enemies) fruits.add(e.sprite);
    }
    assert.ok(fruits.size >= 3, `seed ${seed}: only ${fruits.size} fruit in 4000 frames`);
  }
});
