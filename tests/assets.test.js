import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpriteEntry } from '../js/core/assets.js';

test('string form: a single frame, no timing, centre anchor', () => {
  assert.deepEqual(normalizeSpriteEntry('assets/sprites/star.png'),
    { frames: ['assets/sprites/star.png'], timing: null, anchor: null });
});

test('{file, anchor} form: a single frame with an explicit registration point', () => {
  assert.deepEqual(normalizeSpriteEntry({ file: 'assets/sprites/fuelBar.png', anchor: [51.5, 30] }),
    { frames: ['assets/sprites/fuelBar.png'], timing: null, anchor: [51.5, 30] });
});

test('{frames, fps} form: uniform timing', () => {
  assert.deepEqual(normalizeSpriteEntry({ frames: ['a.png', 'b.png'], fps: 12 }),
    { frames: ['a.png', 'b.png'], timing: 12, anchor: null });
});

test('{frames, durations, anchor} form: per-frame ticks plus an anchor', () => {
  assert.deepEqual(normalizeSpriteEntry({ frames: ['c0.png', 'c1.png'], durations: [8, 14], anchor: [23, 23] }),
    { frames: ['c0.png', 'c1.png'], timing: [8, 14], anchor: [23, 23] });
});

test('a durations array of the wrong length is rejected', () => {
  assert.throws(() => normalizeSpriteEntry({ frames: ['a.png', 'b.png'], durations: [8] }), /duration/i);
});

test('the real manifest normalizes: every entry has at least one frame', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
  for (const [name, entry] of Object.entries(manifest.sprites)) {
    const s = normalizeSpriteEntry(entry);
    assert.ok(s.frames.length >= 1, `${name} has no frames`);
    if (Array.isArray(s.timing)) assert.equal(s.timing.length, s.frames.length, `${name} timing length`);
  }
  const cherry = normalizeSpriteEntry(manifest.sprites.cherry);
  assert.deepEqual(cherry.timing, [8, 14]);
  assert.deepEqual(cherry.anchor, [23, 23]);
  assert.deepEqual(normalizeSpriteEntry(manifest.sprites.background).anchor, [0, 0]);
  assert.equal(normalizeSpriteEntry(manifest.sprites.ufo).timing, 12);
});
