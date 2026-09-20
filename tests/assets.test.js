import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpriteEntry, spriteSource, rasterFrameSize, isCacheable, layeredEntry } from '../js/core/assets.js';

test('string form: a single frame, no timing, centre anchor', () => {
  assert.deepEqual(normalizeSpriteEntry('assets/sprites/star.png'),
    { frames: ['assets/sprites/star.png'], timing: null, anchor: null, size: null, notext: null, textOnly: false });
});

test('{file, anchor} form: a single frame with an explicit registration point', () => {
  assert.deepEqual(normalizeSpriteEntry({ file: 'assets/sprites/fuelBar.png', anchor: [51.5, 30] }),
    { frames: ['assets/sprites/fuelBar.png'], timing: null, anchor: [51.5, 30], size: null, notext: null, textOnly: false });
});

test('{frames, fps} form: uniform timing', () => {
  assert.deepEqual(normalizeSpriteEntry({ frames: ['a.png', 'b.png'], fps: 12 }),
    { frames: ['a.png', 'b.png'], timing: 12, anchor: null, size: null, notext: null, textOnly: false });
});

test('{frames, durations, anchor} form: per-frame ticks plus an anchor', () => {
  assert.deepEqual(normalizeSpriteEntry({ frames: ['c0.png', 'c1.png'], durations: [8, 14], anchor: [23, 23] }),
    { frames: ['c0.png', 'c1.png'], timing: [8, 14], anchor: [23, 23], size: null, notext: null, textOnly: false });
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
      textOnly: false,
    });
});

test('an animated vector entry carries the size alongside its timing', () => {
  assert.deepEqual(normalizeSpriteEntry({ frames: ['u0.svg', 'u1.svg'], fps: 12, anchor: [35.5, 34.5], size: [71.1, 69.1] }),
    { frames: ['u0.svg', 'u1.svg'], timing: 12, anchor: [35.5, 34.5], size: [71.1, 69.1], notext: null, textOnly: false });
});

test('a symbol that is nothing but its caption says so', () => {
  assert.equal(normalizeSpriteEntry({ file: 'btnStart.svg', anchor: [63.7, 22.25], size: [128.6, 50.75], textOnly: true }).textOnly, true);
  assert.equal(normalizeSpriteEntry({ file: 'btnStart.svg', textOnly: 'yes' }).textOnly, false);
});

// --- which files a sprite is really drawn from ---------------------------------------
const raster = (...frames) => normalizeSpriteEntry({ frames, fps: 12, anchor: [1, 2] });

test('a sprite with no vector of its own keeps its raster frames', () => {
  const spec = raster('a.png', 'b.png');
  assert.deepEqual(spriteSource(spec, null), { kind: 'raster', frames: ['a.png', 'b.png'], timing: 12, anchor: [1, 2], size: null });
});

test('a sprite whose vector carries no text is drawn from the vector', () => {
  const spec = raster('cherry_0.png', 'cherry_1.png');
  const vector = normalizeSpriteEntry({ frames: ['cherry_0.svg', 'cherry_1.svg'], fps: 12, anchor: [23, 23], size: [48, 48] });
  assert.deepEqual(spriteSource(spec, vector),
    { kind: 'vector', frames: ['cherry_0.svg', 'cherry_1.svg'], timing: 12, anchor: [23, 23], size: [48, 48] });
});

test('art with a baked-in caption is drawn from the variant without it', () => {
  const spec = normalizeSpriteEntry({ file: 'scoreBar.png', anchor: [51.5, 30] });
  const withCaption = normalizeSpriteEntry({ file: 'scoreBar.svg', notext: 'scoreBar.notext.svg', anchor: [51.45, 30], size: [103, 47.2] });
  const source = spriteSource(spec, withCaption);
  assert.equal(source.kind, 'vector');
  assert.deepEqual(source.frames, ['scoreBar.notext.svg']);
  assert.deepEqual(source.anchor, [51.45, 30]);
});

test('a symbol that is nothing but its caption loads no file at all, but keeps its box', () => {
  const spec = normalizeSpriteEntry({ file: 'btnStart.png', anchor: [63.7, 22.25] });
  const allCaption = normalizeSpriteEntry({ file: 'btnStart.svg', anchor: [63.7, 22.25], size: [128.6, 50.75], textOnly: true });
  const source = spriteSource(spec, allCaption);
  assert.equal(source.kind, 'none');
  assert.deepEqual(source.frames, []);
  assert.deepEqual(source.size, [128.6, 50.75]);
  assert.deepEqual(source.anchor, [63.7, 22.25]);
});

test('a vector entry without a usable size is not trusted', () => {
  const spec = raster('star.png');
  assert.equal(spriteSource(spec, normalizeSpriteEntry({ file: 'star.svg', anchor: [2.5, 2.5] })).kind, 'raster');
  assert.equal(spriteSource(spec, normalizeSpriteEntry({ file: 'star.svg', anchor: [0, 0], size: [0, 5] })).kind, 'raster');
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

test('the cache of every vector frame stays a few megabytes', async () => {
  const manifest = await readManifest();
  const bytesAt = (scale) => {
    let total = 0;
    for (const entry of Object.values(manifest.vectors)) {
      if (layeredEntry(entry)) continue;   // never cached whole; see title-frames.test.js
      const v = normalizeSpriteEntry(entry);
      if (!isCacheable(v.size)) continue;
      const [w, h] = rasterFrameSize(v.size, scale);
      total += w * h * 4 * v.frames.length;
    }
    return total;
  };
  // Single-digit megabytes even with every vector cached at the maximum render scale.
  assert.ok(bytesAt(1) < 1024 * 1024 * 2, `scale 1 cache ${bytesAt(1)} bytes`);
  assert.ok(bytesAt(3) < 1024 * 1024 * 10, `scale 3 cache ${bytesAt(3)} bytes`);
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

test('the vectors map normalizes: a size and an anchor on every entry', async () => {
  const manifest = await readManifest();
  assert.ok(manifest.vectors && Object.keys(manifest.vectors).length > 0, 'the manifest declares no vectors');
  for (const [name, entry] of Object.entries(manifest.vectors)) {
    if (layeredEntry(entry)) continue;     // a form of its own, checked above
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
