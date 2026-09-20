import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSpriteEntry, spriteSource, rasterFrameSize, isCacheable, layeredEntry,
  retryUrl, frameOutcome,
} from '../js/core/assets.js';

test('string form: a single frame, no timing, centre anchor', () => {
  assert.deepEqual(normalizeSpriteEntry('assets/sprites/star.svg'),
    { frames: ['assets/sprites/star.svg'], timing: null, anchor: null, size: null, notext: null, textOnly: false });
});

test('{file, anchor} form: a single frame with an explicit registration point', () => {
  assert.deepEqual(normalizeSpriteEntry({ file: 'assets/sprites/fuelBar.svg', anchor: [51.5, 30] }),
    { frames: ['assets/sprites/fuelBar.svg'], timing: null, anchor: [51.5, 30], size: null, notext: null, textOnly: false });
});

test('{frames, fps} form: uniform timing', () => {
  assert.deepEqual(normalizeSpriteEntry({ frames: ['a.svg', 'b.svg'], fps: 12 }),
    { frames: ['a.svg', 'b.svg'], timing: 12, anchor: null, size: null, notext: null, textOnly: false });
});

test('{frames, durations, anchor} form: per-frame ticks plus an anchor', () => {
  assert.deepEqual(normalizeSpriteEntry({ frames: ['c0.svg', 'c1.svg'], durations: [8, 14], anchor: [23, 23] }),
    { frames: ['c0.svg', 'c1.svg'], timing: [8, 14], anchor: [23, 23], size: null, notext: null, textOnly: false });
});

test('a durations array of the wrong length is rejected', () => {
  assert.throws(() => normalizeSpriteEntry({ frames: ['a.svg', 'b.svg'], durations: [8] }), /duration/i);
});

test('a sprite entry keeps its logical viewport and its text-free variant', () => {
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
      textOnly: false,
    });
});

test('an animated entry carries the size alongside its timing', () => {
  assert.deepEqual(normalizeSpriteEntry({ frames: ['u0.svg', 'u1.svg'], fps: 12, anchor: [35.5, 34.5], size: [71.1, 69.1] }),
    { frames: ['u0.svg', 'u1.svg'], timing: 12, anchor: [35.5, 34.5], size: [71.1, 69.1], notext: null, textOnly: false });
});

test('a symbol that is nothing but its caption says so', () => {
  assert.equal(normalizeSpriteEntry({ file: 'btnStart.svg', anchor: [63.7, 22.25], size: [128.6, 50.75], textOnly: true }).textOnly, true);
  assert.equal(normalizeSpriteEntry({ file: 'btnStart.svg', textOnly: 'yes' }).textOnly, false);
});

// --- which files a sprite is really drawn from ---------------------------------------

test('a plain symbol is drawn from its own frames', () => {
  const spec = normalizeSpriteEntry({ frames: ['cherry_0.svg', 'cherry_1.svg'], fps: 12, anchor: [23, 23], size: [48, 48] });
  assert.deepEqual(spriteSource(spec),
    { kind: 'vector', frames: ['cherry_0.svg', 'cherry_1.svg'], timing: 12, anchor: [23, 23], size: [48, 48] });
});

test('art with a baked-in caption is drawn from the variant without it', () => {
  const withCaption = normalizeSpriteEntry({ file: 'scoreBar.svg', notext: 'scoreBar.notext.svg', anchor: [51.45, 30], size: [103, 47.2] });
  const source = spriteSource(withCaption);
  assert.equal(source.kind, 'vector');
  assert.deepEqual(source.frames, ['scoreBar.notext.svg']);
  assert.deepEqual(source.anchor, [51.45, 30]);
});

test('a symbol that is nothing but its caption loads no file at all, but keeps its box', () => {
  const allCaption = normalizeSpriteEntry({ file: 'btnStart.svg', anchor: [63.7, 22.25], size: [128.6, 50.75], textOnly: true });
  const source = spriteSource(allCaption);
  assert.equal(source.kind, 'none');
  assert.deepEqual(source.frames, []);
  assert.deepEqual(source.size, [128.6, 50.75]);
  assert.deepEqual(source.anchor, [63.7, 22.25]);
});

test('an entry without a usable size is rejected, not guessed at', () => {
  // There is no second set of art to fall back on: an entry that cannot say how big its
  // drawing is could only be placed by guesswork, so the loader refuses it and says which.
  assert.throws(() => spriteSource(normalizeSpriteEntry({ file: 'star.svg', anchor: [2.5, 2.5] })), /size/);
  assert.throws(() => spriteSource(normalizeSpriteEntry({ file: 'star.svg', anchor: [0, 0], size: [0, 5] })), /size/);
  assert.throws(() => spriteSource(null), /size/);
});

// --- when a drawing does not arrive ---------------------------------------------------

test('a frame that failed is asked for once more, past any cached failure', () => {
  assert.equal(retryUrl('assets/sprites/cherry_0.svg', 7), 'assets/sprites/cherry_0.svg?retry=7');
  assert.equal(retryUrl('a.svg?v=2', 7), 'a.svg?v=2&retry=7', 'a query string is extended, not replaced');
  assert.notEqual(retryUrl('a.svg'), 'a.svg?retry=', 'the token defaults to something that changes');
});

test('a sprite that lost a frame keeps the rest and is reported exactly once', () => {
  const outcome = frameOutcome('cherry', ['img0', null], [8, 14]);
  assert.deepEqual(outcome.images, ['img0']);
  assert.equal(outcome.drop, false, 'what did arrive is still drawn');
  assert.equal(outcome.timing, null, 'the recorded holds no longer describe the frames left');
  assert.match(outcome.warning, /cherry/, 'the one warning names the key');
});

test('a sprite whose every frame failed is skipped, named once, and nothing else', () => {
  const outcome = frameOutcome('cherry', [null, null], [8, 14]);
  assert.deepEqual(outcome.images, []);
  assert.equal(outcome.drop, true, 'the sprite is simply not drawn');
  assert.match(outcome.warning, /cherry/);
});

test('a sprite whose frames all arrived is reported not at all', () => {
  const outcome = frameOutcome('cherry', ['img0', 'img1'], [8, 14]);
  assert.deepEqual(outcome.images, ['img0', 'img1']);
  assert.equal(outcome.drop, false);
  assert.deepEqual(outcome.timing, [8, 14], 'the timing survives');
  assert.equal(outcome.warning, null, 'a healthy load says nothing');
});

test('the raster cache rounds a frame up to whole device pixels', () => {
  assert.deepEqual(rasterFrameSize([71.1, 69.1], 1), [72, 70]);
  assert.deepEqual(rasterFrameSize([71.1, 69.1], 2), [143, 139]);
  assert.deepEqual(rasterFrameSize([48, 48], 3), [144, 144]);
  assert.deepEqual(rasterFrameSize([5, 5], 0), [5, 5]);
  assert.deepEqual(rasterFrameSize([0.2, 0.2], 1), [1, 1]);
});

test('only the symbols small enough to be worth it are cached', () => {
  assert.equal(isCacheable([71.1, 69.1]), true);
  assert.equal(isCacheable([288.9, 31.75]), true);
  assert.equal(isCacheable([600, 450]), false);     // the full-stage Game Over frame
  assert.equal(isCacheable(null), false);
});

test('the cache of every sprite frame stays a few megabytes', async () => {
  const manifest = await readManifest();
  const bytesAt = (scale) => {
    let total = 0;
    for (const entry of Object.values(manifest.sprites)) {
      if (layeredEntry(entry)) continue;   // never cached whole; see title-frames.test.js
      const v = normalizeSpriteEntry(entry);
      if (!isCacheable(v.size)) continue;
      const [w, h] = rasterFrameSize(v.size, scale);
      total += w * h * 4 * v.frames.length;
    }
    return total;
  };
  // Single-digit megabytes even with every drawing cached at the maximum render scale.
  assert.ok(bytesAt(1) < 1024 * 1024 * 2, `scale 1 cache ${bytesAt(1)} bytes`);
  assert.ok(bytesAt(3) < 1024 * 1024 * 10, `scale 3 cache ${bytesAt(3)} bytes`);
});

const readManifest = async () => {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(new URL('../assets/manifest.json', import.meta.url), 'utf8'));
};

// --- the layered form: one file, every frame -----------------------------------------
test('a layered entry states its file, its frame count and its timing', () => {
  assert.deepEqual(
    layeredEntry({
      file: 'assets/sprites/titleBg.svg',
      layered: true,
      frameCount: 3,
      durations: [3, 1, 2],
      anchor: [0, 0],
      size: [600, 450],
    }),
    { file: 'assets/sprites/titleBg.svg', frameCount: 3, durations: [3, 1, 2], size: [600, 450], anchor: [0, 0] });
});

test('only an entry that says so is layered', () => {
  assert.equal(layeredEntry({ file: 'a.svg', size: [1, 1], anchor: [0, 0] }), null);
  assert.equal(layeredEntry('a.svg'), null);
  assert.equal(layeredEntry(null), null);
});

test('a layered entry that cannot be trusted is rejected, not guessed at', () => {
  const good = { file: 'a.svg', layered: true, frameCount: 2, durations: [1, 1], size: [600, 450] };
  assert.equal(layeredEntry(good).anchor.join(), '0,0', 'the anchor defaults to the top-left');
  assert.throws(() => layeredEntry({ ...good, file: '' }), /file/);
  assert.throws(() => layeredEntry({ ...good, frameCount: 0 }), /frameCount/);
  assert.throws(() => layeredEntry({ ...good, frameCount: 2.5 }), /frameCount/);
  assert.throws(() => layeredEntry({ ...good, durations: [1] }), /durations/);
  assert.throws(() => layeredEntry({ ...good, size: [0, 450] }), /size/);
  assert.throws(() => layeredEntry({ ...good, size: undefined }), /size/);
});

test('the real manifest normalizes: one set of art, with a size and an anchor on every entry', async () => {
  const manifest = await readManifest();
  assert.ok(manifest.sprites && Object.keys(manifest.sprites).length > 0, 'the manifest declares no sprites');
  assert.equal(manifest.vectors, undefined, 'there is one art map, not two');
  for (const [name, entry] of Object.entries(manifest.sprites)) {
    if (layeredEntry(entry)) continue;     // a form of its own, checked above
    const s = normalizeSpriteEntry(entry);
    assert.ok(s.frames.length >= 1, `${name} has no frames`);
    assert.ok(Array.isArray(s.size) && s.size.every((n) => n > 0), `${name} has no size`);
    assert.ok(Array.isArray(s.anchor), `${name} has no anchor`);
    if (Array.isArray(s.timing)) assert.equal(s.timing.length, s.frames.length, `${name} timing length`);
  }
  const cherry = normalizeSpriteEntry(manifest.sprites.cherry);
  assert.deepEqual(cherry.timing, [8, 14]);
  assert.deepEqual(cherry.anchor, [23, 23]);
  assert.equal(normalizeSpriteEntry(manifest.sprites.ufo).timing, 12);
  assert.deepEqual(normalizeSpriteEntry(manifest.sprites.panda).anchor, [13.5, 12.5]);
  assert.deepEqual(normalizeSpriteEntry(manifest.sprites.ufo).anchor, [35.5, 34.5]);
  assert.deepEqual(normalizeSpriteEntry(manifest.sprites.ufo).size, [71.1, 69.1]);
  assert.equal(normalizeSpriteEntry(manifest.sprites.scoreBar).notext, 'assets/sprites/scoreBar.notext.svg');
  assert.equal(normalizeSpriteEntry(manifest.sprites.star).notext, null);
});
