// tests/events.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../js/core/rng.js';
import { createEvent } from '../js/game/events.js';
import { W, ENEMY, DIRECTOR } from '../js/config.js';

const EVENTS = ['berryRain', 'bossFlyby', 'muffinShower'];
const COLS = 9;
const columnOf = (x) => Math.round((x * COLS) / W - 0.5);

const run = (name, seed) => {
  const ev = createEvent(name, createRng(seed), 0.2);
  const log = [];
  for (let f = 1; f <= DIRECTOR.EVENT_FRAMES; f++) log.push({ f, out: ev.step(f) });
  return log;
};

for (const name of EVENTS) {
  test(`${name}: deterministic for a given seed`, () => {
    assert.deepEqual(run(name, 7), run(name, 7));
  });
}

test('berryRain: waves every 20 frames, 2-3 berries, never in the gap column or its neighbours', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const ev = createEvent('berryRain', createRng(seed), 0.2);
    let prevGap = null;
    let waves = 0;
    for (let f = 1; f <= DIRECTOR.EVENT_FRAMES; f++) {
      const out = ev.step(f);
      if (f % 20 !== 0) { assert.equal(out.enemies.length, 0); continue; }
      waves++;
      assert.ok(out.enemies.length >= 2 && out.enemies.length <= 3);
      assert.ok(out.enemies.every((e) => e.vy === 3 && e.vx === 0 && e.r === ENEMY.BERRY_R && e.sprite === 'berry'));
      const cols = out.enemies.map((e) => columnOf(e.x));
      assert.ok(cols.every((c) => c >= 0 && c < COLS));
      for (const c of [ev.gap - 1, ev.gap, ev.gap + 1]) assert.ok(!cols.includes(c), `seed ${seed}: column ${c} blocked`);
      if (prevGap !== null) assert.ok(Math.abs(ev.gap - prevGap) <= 1, `seed ${seed}: gap jumped`);
      prevGap = ev.gap;
    }
    assert.equal(waves, DIRECTOR.EVENT_FRAMES / 20);
  }
});

test('bossFlyby: 3 passes, cy never repeats in a row, telegraph 90 frames before the boss', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const ev = createEvent('bossFlyby', createRng(seed), 0.2);
    const bosses = [];
    const bandStart = new Map(); // cy -> first frame the band was shown for the current pass
    let lastBandFrame = null;
    for (let f = 1; f <= DIRECTOR.EVENT_FRAMES; f++) {
      const out = ev.step(f);
      for (const t of out.telegraphs) {
        const cy = t.y + t.h / 2;
        assert.equal(t.x, 0); assert.equal(t.w, W); assert.equal(t.h, 120);
        assert.ok([90, 225, 360].includes(cy));
        if (lastBandFrame !== f - 1) bandStart.set(cy, f);
        lastBandFrame = f;
      }
      for (const e of out.enemies) {
        assert.equal(e.sprite, 'boss');
        assert.equal(e.r, ENEMY.BOSS_R);
        assert.equal(e.size, 120);
        assert.ok(e.vx < 0 && e.vy === 0);
        assert.ok(e.x > W);
        bosses.push({ f, cy: e.y });
        assert.equal(f - bandStart.get(e.y), 90, `seed ${seed}: telegraph lead time`);
      }
    }
    assert.equal(bosses.length, 3);
    for (let i = 1; i < bosses.length; i++) assert.notEqual(bosses[i].cy, bosses[i - 1].cy);
  }
});

test('muffinShower: a muffin every 15 frames in one of 9 columns and no enemies', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const ev = createEvent('muffinShower', createRng(seed), 0.2);
    let muffins = 0;
    for (let f = 1; f <= DIRECTOR.EVENT_FRAMES; f++) {
      const out = ev.step(f);
      assert.equal(out.enemies.length, 0);
      assert.equal(out.sugars.length, f % 15 === 0 ? 1 : 0);
      for (const s of out.sugars) {
        muffins++;
        assert.equal(s.vx, 0); assert.equal(s.vy, 3);
        const c = columnOf(s.x);
        assert.ok(c >= 0 && c < COLS);
      }
    }
    assert.equal(muffins, DIRECTOR.EVENT_FRAMES / 15);
  }
});
