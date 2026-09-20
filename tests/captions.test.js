// tests/captions.test.js — the pure parts of the runtime captions: the DANGER flash and
// the layout of the vertical sign. The drawing itself needs a canvas and is not tested here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dangerAlpha, dangerVtGlyphs, DANGER_TEXT, DANGER_SIZE } from '../js/scenes/captions.js';

test('the DANGER flash is the eight-step alpha ramp of the original, two ticks a step', () => {
  const ramp = [255, 186, 127, 63, 0, 63, 127, 186].map((a) => a / 255);
  for (let step = 0; step < ramp.length; step++) {
    assert.equal(dangerAlpha(step * 2), ramp[step], `step ${step}`);
    assert.equal(dangerAlpha(step * 2 + 1), ramp[step], `step ${step}, second tick`);
  }
});

test('the ramp repeats every 16 ticks and survives a negative tick', () => {
  for (const t of [0, 3, 7, 12, 15]) assert.equal(dangerAlpha(t + 16), dangerAlpha(t));
  assert.equal(dangerAlpha(160), dangerAlpha(0));
  assert.ok(Number.isFinite(dangerAlpha(-1)));
  assert.ok(dangerAlpha(NaN) >= 0);
});

test('the ramp goes fully out exactly once per cycle', () => {
  const seen = [];
  for (let t = 0; t < 16; t++) seen.push(dangerAlpha(t));
  assert.equal(seen.filter((a) => a === 0).length, 2);   // one step, two ticks
  assert.equal(Math.max(...seen), 1);
});

test('the horizontal sign is seven marks, DANGER, seven marks', () => {
  assert.equal(DANGER_TEXT, '*******  DANGER  *******');
  assert.equal(DANGER_SIZE, 24);
});

test('the vertical sign stacks one character a line, marks closer than letters', () => {
  const glyphs = dangerVtGlyphs();
  assert.equal(glyphs.length, 16);
  assert.equal(glyphs.map((g) => g.ch).join(''), '*****DANGER*****');
  // measured from dangerVt_0.png: marks every 14 px, letters every 19 px.
  assert.deepEqual(glyphs.slice(0, 5).map((g) => g.top), [18, 32, 46, 60, 74]);
  assert.deepEqual(glyphs.slice(5, 11).map((g) => g.top), [102, 121, 140, 159, 178, 197]);
  assert.deepEqual(glyphs.slice(11).map((g) => g.top), [230, 244, 258, 272, 286]);
});

test('every line of the vertical sign fits inside the 307 px strip', () => {
  for (const g of dangerVtGlyphs()) {
    assert.ok(g.top >= 0 && g.top + DANGER_SIZE * 0.625 <= 307, `line at ${g.top}`);
  }
});
