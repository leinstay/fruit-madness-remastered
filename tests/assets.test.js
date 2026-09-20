import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpriteEntry } from '../js/core/assets.js';

test('string form: a single frame, no timing, centre anchor', () => {
  assert.deepEqual(normalizeSpriteEntry('assets/sprites/star.png'),
    { frames: ['assets/sprites/star.png'], timing: null, anchor: null, size: null, notext: null });
});

test('{file, anchor} form: a single frame with an explicit registration point', () => {
  assert.deepEqual(normalizeSpriteEntry({ file: 'assets/sprites/fuelBar.png', anchor: [51.5, 30] }),
    { frames: ['assets/sprites/fuelBar.png'], timing: null, anchor: [51.5, 30], size: null, notext: null });
});

test('{frames, fps} form: uniform timing', () => {
  assert.deepEqual(normalizeSpriteEntry({ frames: ['a.png', 'b.png'], fps: 12 }),
    { frames: ['a.png', 'b.png'], timing: 12, anchor: null, size: null, notext: null });
});

test('{frames, durations, anchor} form: per-frame ticks plus an anchor', () => {
  assert.deepEqual(normalizeSpriteEntry({ frames: ['c0.png', 'c1.png'], durations: [8, 14], anchor: [23, 23] }),
    { frames: ['c0.png', 'c1.png'], timing: [8, 14], anchor: [23, 23], size: null, notext: null });
});

test('a durations array of the wrong length is rejected', () => {
  assert.throws(() => normalizeSpriteEntry({ frames: ['a.png', 'b.png'], durations: [8] }), /duration/i);
});

test('a vector entry keeps its logical viewport and its text-free variant', () => {
  assert.deepEqual(
    normalizeSpriteEntry({
      file: 'assets/sprites/fuelBar.svg',
      anchor: [51.5, 30],
      size: [103, 46.5],
      notext: 'assets/sprites/fuelBar.notext.svg',
    }),
    {
      frames: ['assets/sprites/fuelBar.svg'],
      timing: null,
      anchor: [51.5, 30],
      size: [103, 46.5],
      notext: 'assets/sprites/fuelBar.notext.svg',
    });
});

test('an animated vector entry carries the size alongside its timing', () => {
  assert.deepEqual(normalizeSpriteEntry({ frames: ['u0.svg', 'u1.svg'], fps: 12, anchor: [35.5, 34.5], size: [71.1, 69.1] }),
    { frames: ['u0.svg', 'u1.svg'], timing: 12, anchor: [35.5, 34.5], size: [71.1, 69.1], notext: null });
});

const readManifest = async () => {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
};

test('the real manifest normalizes: every entry has at least one frame', async () => {
  const manifest = await readManifest();
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

test('the vectors map normalizes: a size and an anchor on every entry', async () => {
  const manifest = await readManifest();
  assert.ok(manifest.vectors && Object.keys(manifest.vectors).length > 0, 'the manifest declares no vectors');
  for (const [name, entry] of Object.entries(manifest.vectors)) {
    const v = normalizeSpriteEntry(entry);
    assert.ok(v.frames.length >= 1, `vectors.${name} has no frames`);
    assert.ok(Array.isArray(v.size) && v.size.every((n) => n > 0), `vectors.${name} has no size`);
    assert.ok(Array.isArray(v.anchor), `vectors.${name} has no anchor`);
    if (Array.isArray(v.timing)) assert.equal(v.timing.length, v.frames.length, `vectors.${name} timing length`);
    const sprite = normalizeSpriteEntry(manifest.sprites[name]);
    assert.equal(v.frames.length, sprite.frames.length, `vectors.${name} frame count`);
    assert.deepEqual(v.timing, sprite.timing, `vectors.${name} timing`);
  }
  assert.deepEqual(normalizeSpriteEntry(manifest.vectors.panda).anchor, [13.5, 12.5]);
  assert.deepEqual(normalizeSpriteEntry(manifest.vectors.ufo).anchor, [35.5, 34.5]);
  assert.deepEqual(normalizeSpriteEntry(manifest.vectors.ufo).size, [71.1, 69.1]);
  assert.equal(normalizeSpriteEntry(manifest.vectors.scoreBar).notext, 'assets/sprites/scoreBar.notext.svg');
  assert.equal(normalizeSpriteEntry(manifest.vectors.star).notext, null);
});
