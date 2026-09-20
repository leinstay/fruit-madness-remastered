// tests/title-frames.test.js — the pure half of js/core/title-frames.js: cutting one
// frame out of the single-file title animation by string slicing, and the arithmetic of
// the cache that holds the loop as one base frame plus the tiles that change.
// No DOM, no canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sliceTitleFrames, buildFrameParts, buildFrameDocument, buildFullFrameDocument,
  referencedIds, resolveDefinitions, createTitleFrames,
  tileGrid, changedTiles, packPatchAtlas, preparationOrder, shownKeyframe,
  projectedCacheBytes, nextTitleScale, titleCacheScale, titleKeyframeAt,
  TILE_SIZE, TILE_TOLERANCE, MAX_TITLE_SCALE, TITLE_SCALE_STEPS, TITLE_CACHE_BUDGET_BYTES,
  TITLE_SLOWDOWN,
} from '../js/core/title-frames.js';
import { frameAt } from '../js/core/anim.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'assets', 'sprites', 'titleBg.svg');
const MANIFEST = path.join(ROOT, 'assets', 'manifest.json');
const FIELD = [600, 450];

/** A miniature file in exactly the shape tools/make-title.py writes. */
const toy = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450" viewBox="200 110 600 450">',
  '<defs>',
  '<g id="s0"><path d="M0 0"/></g>',
  '<g id="s1"><use xlink:href="#s3"/></g>',
  '<g id="s2"><image xlink:href="data:image/png;base64,AAA"/></g>',
  '<g id="s3"><path d="M1 1"/></g>',
  '</defs>',
  '<!--white backdrop intended by the artwork-->',
  '<rect x="200" y="110" width="600" height="450" fill="#ffffff"/>',
  '<!--frame:0--><g id="frame-0" transform="matrix(1,0,0,1,500,335)"><use xlink:href="#s0"/><use xlink:href="#s1"/></g>',
  '<!--frame:1--><g id="frame-1" display="none" transform="matrix(1,0,0,1,500,335)"><use xlink:href="#s2"/></g>',
  '<!--frames:end-->',
  '</svg>',
  '',
].join('\n');

test('the file is cut into a prefix, the frames and a suffix', () => {
  const parts = sliceTitleFrames(toy);
  assert.equal(parts.frames.length, 2);
  assert.ok(parts.prefix.startsWith('<svg'), 'the prefix carries the root element');
  assert.ok(parts.prefix.includes('<defs>'), 'the prefix carries the definitions');
  assert.ok(parts.prefix.includes('fill="#ffffff"'), 'the prefix carries the backdrop');
  assert.ok(!parts.prefix.includes('<!--frame:0-->'), 'the prefix stops at the first marker');
  assert.equal(parts.suffix.trimEnd(), '<!--frames:end-->\n</svg>');
});

test('the definitions are indexed by id, one per line, in document order', () => {
  const parts = sliceTitleFrames(toy);
  assert.deepEqual([...parts.definitions.keys()], ['s0', 's1', 's2', 's3']);
  assert.equal(parts.definitions.get('s0'), '<g id="s0"><path d="M0 0"/></g>');
  assert.ok(parts.open.startsWith('<svg') && !parts.open.includes('<defs>'));
  assert.ok(parts.backdrop.includes('fill="#ffffff"'));
  assert.throws(() => sliceTitleFrames(toy.replace('<g id="s0">', '<g>')), /without an id/);
  assert.throws(() => sliceTitleFrames(toy.replace(/<g id="s\d"[^\n]*\n/g, '')), /empty/);
});

test('a reference list is every href once, in the order it appears', () => {
  assert.deepEqual(referencedIds('<use xlink:href="#b"/><use href="#a"/><use xlink:href="#b"/>'), ['b', 'a']);
  assert.deepEqual(referencedIds('<image xlink:href="data:image/png;base64,AAA"/>'), [],
    'an embedded image is not a reference to a definition');
  assert.deepEqual(referencedIds(''), []);
});

test('definitions resolve transitively and come back in document order', () => {
  const defs = new Map([['a', '<g id="a"><use href="#c"/></g>'], ['b', '<g id="b"/>'],
    ['c', '<g id="c"><use href="#b"/></g>']]);
  assert.deepEqual(resolveDefinitions(defs, '<use href="#a"/>'),
    ['<g id="a"><use href="#c"/></g>', '<g id="b"/>', '<g id="c"><use href="#b"/></g>']);
  assert.deepEqual(resolveDefinitions(defs, '<use href="#b"/>'), ['<g id="b"/>']);
  assert.deepEqual(resolveDefinitions(defs, '<g/>'), [], 'a frame that uses nothing needs nothing');
  // A cycle must terminate rather than hang.
  const loop = new Map([['x', '<g id="x"><use href="#y"/></g>'], ['y', '<g id="y"><use href="#x"/></g>']]);
  assert.equal(resolveDefinitions(loop, '<use href="#x"/>').length, 2);
});

test('a reference that resolves to nothing is an error, not a hole in the picture', () => {
  const defs = new Map([['a', '<g id="a"><use href="#gone"/></g>']]);
  assert.throws(() => resolveDefinitions(defs, '<use href="#a"/>'), /#gone is missing/);
  assert.throws(() => resolveDefinitions(defs, '<use href="#nope"/>'), /#nope is missing/);
});

test('a frame document carries the definitions it uses and no others', () => {
  const parts = sliceTitleFrames(toy);
  const first = buildFrameDocument(parts, 0);
  assert.ok(first.includes('id="s0"') && first.includes('id="s1"'), 'the two it uses');
  assert.ok(first.includes('id="s3"'), 's1 points at s3, so s3 comes too');
  assert.ok(!first.includes('id="s2"'), 'the drawing it does not use stays out');
  // ... and the one raster of the artwork travels exactly with the frame that shows it.
  const second = buildFrameDocument(parts, 1);
  assert.ok(second.includes('base64'), 'frame 1 uses the image');
  assert.ok(!first.includes('base64'), 'frame 0 does not');
  assert.ok(second.includes('id="s2"') && !second.includes('id="s0"'));
  assert.ok(first.length < buildFullFrameDocument(parts, 0).length, 'and it is smaller for it');
});

test('a frame document is handed over in pieces, never built as one string', () => {
  // `new Blob(pieces)` joins them itself; building the megabyte string first is the
  // single most expensive thing the module could do per frame.
  const parts = sliceTitleFrames(toy);
  const pieces = buildFrameParts(parts, 0);
  assert.ok(Array.isArray(pieces) && pieces.length > 3);
  assert.ok(pieces.every((p) => typeof p === 'string'));
  assert.equal(pieces.join(''), buildFrameDocument(parts, 0));
  assert.equal(pieces[1], '<defs>');
  assert.equal(pieces[pieces.length - 2], parts.frames[0]);
});

test('the full document is the fallback and holds every definition', () => {
  const parts = sliceTitleFrames(toy);
  const full = buildFullFrameDocument(parts, 1);
  assert.equal(full, parts.prefix + parts.frames[1] + parts.suffix);
  for (const id of parts.definitions.keys()) assert.ok(full.includes(`id="${id}"`), id);
});

test('a hidden frame is unhidden by the slice', () => {
  const parts = sliceTitleFrames(toy);
  assert.ok(!parts.frames[1].includes('display="none"'), 'frame 1 must be made visible');
  assert.ok(parts.frames[1].startsWith('<g id="frame-1"'));
  assert.ok(parts.frames[0].startsWith('<g id="frame-0"'));
});

test('a frame document is a complete standalone SVG of that one frame', () => {
  const parts = sliceTitleFrames(toy);
  const doc = buildFrameDocument(parts, 1);
  assert.ok(doc.startsWith('<svg') && doc.trimEnd().endsWith('</svg>'));
  assert.ok(doc.includes('<defs>') && doc.includes('</defs>'));
  assert.ok(doc.includes('fill="#ffffff"'), 'the white page the art was drawn over');
  assert.ok(doc.includes('<g id="frame-1"'), 'the frame asked for');
  assert.ok(!doc.includes('<g id="frame-0"'), 'and only that one');
  // The index wraps, so an animation tick never has to be clamped by the caller.
  assert.equal(buildFrameDocument(parts, 2), buildFrameDocument(parts, 0));
  assert.equal(buildFrameDocument(parts, -1), buildFrameDocument(parts, 1));
});

test('a file that is not in that shape is rejected rather than half-read', () => {
  assert.throws(() => sliceTitleFrames('<html></html>'), /svg/i);
  assert.throws(() => sliceTitleFrames(null), /svg/i);
  assert.throws(() => sliceTitleFrames('<svg></svg>'), /marker/i);
  assert.throws(() => sliceTitleFrames('<svg><!--frames:end--></svg>'), /frame 0/i);
});

test('the shipped title file slices into 31 usable frames', () => {
  const parts = sliceTitleFrames(fs.readFileSync(FILE, 'utf8'));
  assert.equal(parts.frames.length, 31);
  assert.equal(parts.definitions.size, 287);
  for (let n = 0; n < parts.frames.length; n += 1) {
    assert.ok(parts.frames[n].startsWith(`<g id="frame-${n}"`), `frame ${n}`);
    assert.ok(!parts.frames[n].includes('display="none"'), `frame ${n} is visible`);
  }
  // Every definition a frame points at has to be there, or the document the browser
  // gets would draw holes.
  for (const frame of parts.frames) {
    for (const id of referencedIds(frame)) {
      assert.ok(parts.definitions.has(id), `#${id} resolves to nothing`);
    }
  }
});

test('the shipped frames each carry a fraction of the drawings', () => {
  const parts = sliceTitleFrames(fs.readFileSync(FILE, 'utf8'));
  const whole = buildFullFrameDocument(parts, 0).length;
  for (let n = 0; n < parts.frames.length; n += 1) {
    const doc = buildFrameDocument(parts, n);
    assert.ok(doc.length < whole * 0.75, `frame ${n} is ${doc.length} of ${whole} bytes`);
    // Everything the frame points at is in its own document, and the document has no
    // definition that nothing points at.
    const inDoc = new Set([...doc.slice(0, doc.indexOf('</defs>')).matchAll(/\sid="([^"]+)"/g)]
      .map((m) => m[1]));
    const needed = new Set();
    const pending = referencedIds(parts.frames[n]);
    while (pending.length) {
      const id = pending.pop();
      if (needed.has(id)) continue;
      needed.add(id);
      for (const next of referencedIds(parts.definitions.get(id))) pending.push(next);
    }
    assert.deepEqual([...inDoc].sort(), [...needed].sort(), `frame ${n} definitions`);
  }
});

test('the one raster of the artwork travels with the frames that show it', () => {
  const parts = sliceTitleFrames(fs.readFileSync(FILE, 'utf8'));
  const banners = [...parts.definitions].filter(([, body]) => body.includes('<image'));
  assert.equal(banners.length, 1, 'the rainbow banner is the only embedded image');
  const [id] = banners[0];
  for (let n = 0; n < parts.frames.length; n += 1) {
    const uses = resolveDefinitions(parts.definitions, parts.frames[n]).includes(banners[0][1]);
    assert.equal(buildFrameDocument(parts, n).includes(`id="${id}"`), uses, `frame ${n}`);
  }
});

// --- The tile grid --------------------------------------------------------------------

test('the tile grid is the field cut into whole logical tiles', () => {
  assert.equal(TILE_SIZE, 50);
  const grid = tileGrid(FIELD, 1);
  assert.equal(grid.cols, 12);
  assert.equal(grid.rows, 9);
  assert.equal(grid.rects.length, 108);
  assert.equal(grid.width, 600);
  assert.equal(grid.height, 450);
  // Row-major: the second tile is the one to the right of the first.
  assert.deepEqual(grid.rects[0], { x: 0, y: 0, w: 50, h: 50 });
  assert.deepEqual(grid.rects[1], { x: 50, y: 0, w: 50, h: 50 });
  assert.deepEqual(grid.rects[12], { x: 0, y: 50, w: 50, h: 50 });
});

test('tile rects tile the canvas at fractional scales, with no gaps', () => {
  for (const scale of [1, 1.25, 1.5, 1.7, 2, 2.5, 3]) {
    const grid = tileGrid(FIELD, scale);
    assert.equal(grid.width, Math.ceil(FIELD[0] * scale), `width at ${scale}`);
    assert.equal(grid.height, Math.ceil(FIELD[1] * scale), `height at ${scale}`);
    for (const r of grid.rects) {
      assert.ok(r.w >= 1 && r.h >= 1, `empty tile at ${scale}`);
      assert.ok(r.x >= 0 && r.y >= 0, `tile before the origin at ${scale}`);
      assert.ok(r.x + r.w <= grid.width, `tile past the right edge at ${scale}`);
      assert.ok(r.y + r.h <= grid.height, `tile past the bottom edge at ${scale}`);
    }
    // Left/top floored, right/bottom ceiled: neighbours touch or overlap by one device
    // pixel, and never leave a gap between them.
    for (let row = 0; row < grid.rows; row += 1) {
      for (let col = 0; col < grid.cols; col += 1) {
        const r = grid.rects[row * grid.cols + col];
        if (col === 0) assert.equal(r.x, 0, `first column at ${scale}`);
        if (row === 0) assert.equal(r.y, 0, `first row at ${scale}`);
        if (col === grid.cols - 1) assert.equal(r.x + r.w, grid.width, `last column at ${scale}`);
        if (row === grid.rows - 1) assert.equal(r.y + r.h, grid.height, `last row at ${scale}`);
        if (col + 1 < grid.cols) {
          const next = grid.rects[row * grid.cols + col + 1];
          const overlap = r.x + r.w - next.x;
          assert.ok(overlap >= 0, `column gap at ${scale}`);
          assert.ok(overlap <= 1, `column overlap ${overlap} at ${scale}`);
        }
        if (row + 1 < grid.rows) {
          const below = grid.rects[(row + 1) * grid.cols + col];
          const overlap = r.y + r.h - below.y;
          assert.ok(overlap >= 0, `row gap at ${scale}`);
          assert.ok(overlap <= 1, `row overlap ${overlap} at ${scale}`);
        }
      }
    }
  }
});

test('every device pixel of the canvas belongs to at least one tile', () => {
  const grid = tileGrid(FIELD, 1.25);
  const seen = new Uint8Array(grid.width * grid.height);
  for (const r of grid.rects) {
    for (let y = r.y; y < r.y + r.h; y += 1) {
      for (let x = r.x; x < r.x + r.w; x += 1) seen[y * grid.width + x] += 1;
    }
  }
  for (let i = 0; i < seen.length; i += 1) {
    assert.ok(seen[i] >= 1, `pixel ${i} is in no tile`);
    assert.ok(seen[i] <= 4, `pixel ${i} is in ${seen[i]} tiles`);
  }
});

test('an odd field size still gets whole tiles that end on the canvas edge', () => {
  const grid = tileGrid([130, 60], 1, 50);
  assert.equal(grid.cols, 3);
  assert.equal(grid.rows, 2);
  assert.deepEqual(grid.rects[2], { x: 100, y: 0, w: 30, h: 50 });
  assert.deepEqual(grid.rects[5], { x: 100, y: 50, w: 30, h: 10 });
});

// --- The tile diff --------------------------------------------------------------------

/** An opaque RGBA buffer of `w` x `h` filled with one colour. */
function buffer(w, h, value = 10) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
  }
  return data;
}

test('a tile differs only when a channel differs by more than the tolerance', () => {
  assert.equal(TILE_TOLERANCE, 2);
  const grid = tileGrid([4, 2], 1, 2);          // two tiles of 2x2
  assert.equal(grid.rects.length, 2);
  const base = buffer(4, 2);
  const shot = buffer(4, 2);
  assert.deepEqual(changedTiles(shot, base, grid.width, grid.rects), [],
    'the same drawing rasterises identically');

  // Renderer noise inside the tolerance is not a change.
  shot[0] += 2;
  assert.deepEqual(changedTiles(shot, base, grid.width, grid.rects), []);
  shot[0] += 1;                                  // now 3 away
  assert.deepEqual(changedTiles(shot, base, grid.width, grid.rects), [0]);

  // A pixel in the right-hand tile, on the second row, and the alpha channel too.
  const other = buffer(4, 2);
  other[(1 * 4 + 3) * 4 + 3] = 200;              // x=3, y=1, alpha
  assert.deepEqual(changedTiles(other, base, grid.width, grid.rects), [1]);

  const both = buffer(4, 2);
  both[1] = 255;                                 // x=0, y=0, green
  both[(1 * 4 + 2) * 4 + 2] = 255;               // x=2, y=1, blue
  assert.deepEqual(changedTiles(both, base, grid.width, grid.rects), [0, 1]);
});

test('the diff only looks inside its own tile', () => {
  const grid = tileGrid([4, 2], 1, 2);
  const base = buffer(4, 2);
  const shot = buffer(4, 2);
  // Every pixel of the left tile, nothing of the right one.
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) shot[(y * 4 + x) * 4] = 255;
  assert.deepEqual(changedTiles(shot, base, grid.width, grid.rects), [0]);
  assert.deepEqual(changedTiles(shot, base, grid.width, [grid.rects[1]]), []);
});

// --- Packing the patches --------------------------------------------------------------

test('the changed tiles are packed into one row-major strip', () => {
  const grid = tileGrid(FIELD, 2);
  const atlas = packPatchAtlas(grid.rects, [0, 13, 107]);
  assert.equal(atlas.patches.length, 3);
  assert.equal(atlas.width, 300, 'three 100 px tiles side by side');
  assert.equal(atlas.height, 100);
  assert.equal(atlas.bytes, 300 * 100 * 4);
  assert.deepEqual(atlas.patches[0], { sx: 0, sy: 0, dx: 0, dy: 0, w: 100, h: 100 });
  assert.deepEqual(atlas.patches[1], { sx: 100, sy: 0, dx: 100, dy: 100, w: 100, h: 100 });
  assert.deepEqual(atlas.patches[2], { sx: 200, sy: 0, dx: 1100, dy: 800, w: 100, h: 100 });
});

test('a keyframe that changes nothing costs no atlas at all', () => {
  const grid = tileGrid(FIELD, 1);
  const atlas = packPatchAtlas(grid.rects, []);
  assert.deepEqual(atlas.patches, []);
  assert.equal(atlas.width, 0);
  assert.equal(atlas.height, 0);
  assert.equal(atlas.bytes, 0);
});

test('tiles of different sizes still pack without overlapping', () => {
  const grid = tileGrid([130, 60], 1, 50);       // the last column is 30 wide, the last row 10 high
  const atlas = packPatchAtlas(grid.rects, [2, 3, 5]);
  assert.equal(atlas.width, 30 + 50 + 30);
  assert.equal(atlas.height, 50, 'as tall as the tallest tile packed');
  assert.deepEqual(atlas.patches.map((p) => p.sx), [0, 30, 80]);
  assert.deepEqual(atlas.patches.map((p) => [p.w, p.h]), [[30, 50], [50, 10], [30, 10]]);
  // Nothing in the strip overlaps anything else.
  for (let i = 1; i < atlas.patches.length; i += 1) {
    const prev = atlas.patches[i - 1];
    assert.ok(prev.sx + prev.w <= atlas.patches[i].sx, `patch ${i} overlaps its neighbour`);
  }
});

// --- What to show, and in what order to prepare it --------------------------------------

test('the loop is prepared in timeline order from the playhead', () => {
  assert.deepEqual(preparationOrder(5, 0), [0, 1, 2, 3, 4]);
  assert.deepEqual(preparationOrder(5, 3), [3, 4, 0, 1, 2]);
  assert.deepEqual(preparationOrder(5, 7), [2, 3, 4, 0, 1], 'the playhead wraps');
  assert.deepEqual(preparationOrder(5, -1), [4, 0, 1, 2, 3]);
  assert.deepEqual(preparationOrder(1, 0), [0]);
  assert.deepEqual(preparationOrder(0, 0), []);
});

test('an unprepared keyframe shows the most recent prepared one, never a later one', () => {
  const prepared = [true, true, false, false, true];
  assert.equal(shownKeyframe(prepared, 1), 1, 'a prepared keyframe shows itself');
  assert.equal(shownKeyframe(prepared, 2), 1);
  assert.equal(shownKeyframe(prepared, 3), 1, 'not 4, which is later in the loop');
  assert.equal(shownKeyframe(prepared, 4), 4);
  // The sweep starts at the playhead, so the prepared run can straddle the wrap.
  assert.equal(shownKeyframe([false, false, true, true, true], 0), 4, 'wrapping back is fine');
  assert.equal(shownKeyframe([false, false, true, true, true], 1), 4);
  assert.equal(shownKeyframe(new Array(5).fill(false), 3), -1, 'nothing is ready yet');
  assert.equal(shownKeyframe([], 0), -1);
  assert.equal(shownKeyframe([true, false], 5), 0, 'the wanted index wraps too');
});

// --- The memory budget ------------------------------------------------------------------

test('the scale steps down when the whole loop would not fit the budget', () => {
  assert.equal(TITLE_CACHE_BUDGET_BYTES, 64 * 1024 * 1024);
  assert.equal(MAX_TITLE_SCALE, 2);
  assert.deepEqual(TITLE_SCALE_STEPS, [2, 1.5, 1]);

  assert.equal(titleCacheScale(3), 2, 'the cap holds');
  assert.equal(titleCacheScale(1.25), 1.25, 'below the cap the display scale is used as it is');
  assert.equal(titleCacheScale(0), 1);
  assert.equal(titleCacheScale(NaN), 1);

  assert.equal(nextTitleScale(2), 1.5);
  assert.equal(nextTitleScale(1.75), 1.5, 'an in-between scale drops to the step below it');
  assert.equal(nextTitleScale(1.5), 1);
  assert.equal(nextTitleScale(1), null, 'scale 1 is the floor');
  assert.equal(nextTitleScale(0.5), null);
});

test('the cache size is projected from the keyframes prepared so far', () => {
  const base = 4 * 1024 * 1024;
  assert.equal(projectedCacheBytes(base, 0, 0, 30), base, 'nothing measured yet');
  assert.equal(projectedCacheBytes(base, 300, 3, 30), base + 3000);
  assert.equal(projectedCacheBytes(base, 0, 30, 30), base, 'a loop that never changes costs the base');
  // The canvas the shown keyframe is composed on is the same size as the base frame and is
  // held for as long as the cache is, so it counts against the budget too.
  assert.equal(projectedCacheBytes(base, 300, 3, 30, base), 2 * base + 3000);
  assert.equal(projectedCacheBytes(base, 0, 0, 30, base), 2 * base);
  // The whole loop as full frames is what this replaces: 134 MB at scale 2 is over the
  // budget, 33.5 MB at scale 1 is not — and the patches have to bring 2 under it.
  const full = (scale) => 31 * Math.ceil(600 * scale) * Math.ceil(450 * scale) * 4;
  assert.ok(full(2) > TITLE_CACHE_BUDGET_BYTES, `${full(2)} bytes of full frames at scale 2`);
  assert.ok(full(1) < TITLE_CACHE_BUDGET_BYTES, `${full(1)} bytes of full frames at scale 1`);
  // Even the pathological loop in which every tile of every keyframe changes fits at
  // scale 1, so dropping to the floor always succeeds.
  const grid = tileGrid(FIELD, 1);
  const worst = packPatchAtlas(grid.rects, grid.rects.map((_, i) => i)).bytes;
  assert.ok(projectedCacheBytes(grid.width * grid.height * 4, worst * 30, 30, 30)
    <= TITLE_CACHE_BUDGET_BYTES, 'the worst case at scale 1 must fit');
});

test('the keyframes follow the manifest durations, 31 of them per 40 ticks', () => {
  const entry = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).sprites.titleBg;
  const { durations, frameCount } = entry;
  assert.equal(frameCount, 31);
  assert.equal(durations.length, 31);
  const loop = durations.reduce((a, b) => a + b, 0);
  assert.equal(loop, 40, 'the loop is 40 ticks, i.e. 46.5 keyframe changes a second');
  // Every keyframe is shown, in order, for exactly its recorded number of ticks.
  const shown = [];
  for (let tick = 0; tick < loop; tick += 1) shown.push(frameAt(durations, frameCount, tick));
  assert.deepEqual([...new Set(shown)], durations.map((_, i) => i), 'all 31, in order');
  for (let i = 0; i < frameCount; i += 1) {
    assert.equal(shown.filter((f) => f === i).length, durations[i], `keyframe ${i} holds`);
  }
  assert.equal(frameAt(durations, frameCount, loop), 0, 'and then it starts again');
  // At the speed the game plays it, that same loop takes twice as many ticks.
  assert.equal(loop * TITLE_SLOWDOWN, 80);
  // Which is why the cache has to hold the whole loop: at 60 Hz the animation asks for a
  // different keyframe 46.5 times a second, and each one costs ~19 ms to rasterise.
  assert.equal((60 * frameCount) / loop, 46.5);
});

// --- game ticks to title keyframes --------------------------------------------------------

test('the title plays at half the speed the artwork records', () => {
  assert.equal(TITLE_SLOWDOWN, 2);
  const durations = [2, 1, 3];
  const frames = 3;
  // At slowdown 1 the mapping is the recorded playback itself.
  for (let tick = -8; tick < 20; tick += 1) {
    assert.equal(titleKeyframeAt(durations, frames, tick, 1), frameAt(durations, frames, tick), `tick ${tick}`);
  }
  // At slowdown 2 every keyframe is held for twice as many game ticks, in the same order.
  const shown = [];
  for (let tick = 0; tick < 12; tick += 1) shown.push(titleKeyframeAt(durations, frames, tick, 2));
  assert.deepEqual(shown, [0, 0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2]);
  assert.equal(titleKeyframeAt(durations, frames, 12, 2), 0, 'and then the loop starts again');
  assert.equal(titleKeyframeAt(durations, frames, 0, 0), frameAt(durations, frames, 0), 'a silly slowdown is ignored');
});

test('the shipped title loop takes 80 game ticks and skips no keyframe', () => {
  const { durations, frameCount } = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).sprites.titleBg;
  const loop = durations.reduce((a, b) => a + b, 0) * TITLE_SLOWDOWN;
  assert.equal(loop, 80);
  const shown = [];
  for (let tick = 0; tick < loop; tick += 1) shown.push(titleKeyframeAt(durations, frameCount, tick));
  assert.deepEqual([...new Set(shown)], durations.map((_, i) => i), 'all 31, in order, none skipped');
  for (let i = 0; i < frameCount; i += 1) {
    assert.equal(shown.filter((f) => f === i).length, durations[i] * TITLE_SLOWDOWN, `keyframe ${i} holds`);
  }
  assert.equal(titleKeyframeAt(durations, frameCount, loop), 0);
  // 31 keyframes per 80 ticks: 23.25 changes a second instead of 46.5.
  assert.equal((60 * frameCount) / loop, 23.25);
});

// --- the composed keyframe ---------------------------------------------------------------
// The cache is a base frame plus patches, but the screen never sees the pieces: the shown
// keyframe is composed onto one canvas in whole device pixels and blitted in a single
// drawImage. Scaling the pieces separately is what leaves seams along the patch borders
// when the window is bigger than the scale the cache was built at.

/** A miniature title file of `count` frames, in the shape tools/make-title.py writes. */
function toyFile(count) {
  const line = (i) => `<g id="s${i}"><path d="M${i} ${i}"/></g>`;
  const frame = (i) => `<!--frame:${i}--><g id="frame-${i}"${i === 0 ? '' : ' display="none"'}`
    + ` transform="matrix(1,0,0,1,500,335)"><use xlink:href="#s${i}"/></g>`;
  return ['<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450" viewBox="200 110 600 450">',
    '<defs>', ...Array.from({ length: count }, (_, i) => line(i)), '</defs>',
    '<!--white backdrop intended by the artwork-->',
    '<rect x="200" y="110" width="600" height="450" fill="#ffffff"/>',
    ...Array.from({ length: count }, (_, i) => frame(i)),
    '<!--frames:end-->', '</svg>', ''].join('\n');
}

/** Which frame a document built by `buildFrameParts` holds. */
const frameOf = (pieces) => Number(/<g id="frame-(\d+)"/.exec(pieces.join(''))[1]);

/** The pixels of keyframe `n`: one marked pixel, in a tile of its own per keyframe. */
function pixelsOf(image, w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  const mark = ((image ? image.frame : 0) % 5) * 20;
  data[mark * 4] = 255;
  return data;
}

/** Canvases that record their size and what was last painted on them. No DOM. */
function fakeCanvases() {
  const made = [];
  const create = (w, h) => {
    const canvas = { width: w, height: h, painted: null, draws: 0 };
    canvas.getContext = () => ({
      canvas,
      imageSmoothingEnabled: true,
      setTransform() {},
      clearRect() {},
      drawImage(source) { canvas.draws += 1; canvas.painted = source; },
      getImageData: (x, y, gw, gh) => ({ data: pixelsOf(canvas.painted, gw, gh) }),
    });
    made.push(canvas);
    return canvas;
  };
  return { made, create };
}

/** A title cache over `count` toy keyframes, driven until the whole loop is prepared. */
async function preparedTitle(count = 4) {
  const canvases = fakeCanvases();
  const title = createTitleFrames({
    url: 'titleBg.svg',
    size: [100, 60],
    tile: 20,
    loadText: () => Promise.resolve(toyFile(count)),
    decodeFrame: (pieces) => Promise.resolve({ image: { frame: frameOf(pieces) }, release() {} }),
    yieldToLoop: () => Promise.resolve(),
    createCanvas: canvases.create,
  });
  const ctx = stubContext();
  for (let i = 0; i < 200 && !title.stats().complete; i += 1) {
    title.draw(ctx, 0, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(title.stats().complete, true, 'the toy loop never finished preparing');
  return { title, canvases, ctx };
}

test('a keyframe is composed once and only when the shown keyframe changes', async () => {
  const { title } = await preparedTitle();
  const ctx = stubContext();
  title.draw(ctx, 0, 1);
  assert.equal(title.stats().composes, 1, 'the first keyframe is composed');
  for (let i = 0; i < 5; i += 1) title.draw(ctx, 0, 1);
  assert.equal(title.stats().composes, 1, 'standing still costs no composition at all');
  title.draw(ctx, 1, 1);
  assert.equal(title.stats().composes, 2);
  title.draw(ctx, 2, 1);
  title.draw(ctx, 2, 1);
  assert.equal(title.stats().composes, 3);
  title.draw(ctx, 0, 1);
  assert.equal(title.stats().composes, 4, 'coming back to a keyframe composes it again');
});

test('the screen gets one blit of the composed canvas, whatever the scale', async () => {
  const { title } = await preparedTitle();
  for (const index of [0, 1, 2, 3]) {
    const ctx = stubContext();
    assert.equal(title.draw(ctx, index, 1), true);
    assert.equal(ctx.calls.filter((c) => c === 'drawImage').length, 1,
      `keyframe ${index} must reach the screen in one piece`);
  }
  // Above the cache's own scale the composed canvas is stretched — still once, as a whole,
  // so no patch border is ever resampled on its own.
  const ctx = stubContext();
  title.draw(ctx, 1, 3);
  assert.equal(ctx.calls.filter((c) => c === 'drawImage').length, 1);
});

test('the composed canvas is the size of the base frame and counts against the budget', async () => {
  const { title } = await preparedTitle();
  const stats = title.stats();
  assert.equal(stats.baseBytes, 100 * 60 * 4);
  assert.equal(stats.composedBytes, stats.baseBytes, 'one more frame-sized canvas');
  assert.equal(stats.bytes, stats.baseBytes + stats.composedBytes + stats.patchBytes);
});

// --- when the artwork does not arrive ---------------------------------------------------

/** A canvas context that records nothing but the fact that it was drawn on. */
function stubContext() {
  const calls = [];
  return {
    calls,
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    drawImage() { calls.push('drawImage'); },
    setTransform() { calls.push('setTransform'); },
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
}

/** Runs `body` with console.warn captured, and gives back what it said. */
async function withWarnings(body) {
  const said = [];
  const real = console.warn;
  console.warn = (...args) => said.push(args.map(String).join(' '));
  try {
    await body();
  } finally {
    console.warn = real;
  }
  return said;
}

test('a title file that cannot be fetched paints nothing and complains once', async () => {
  // There is no second copy of the artwork: when the file is unusable the title simply is
  // not painted, and the menu keeps the flat backdrop it drew before calling in — with its
  // labels and its three buttons, which are runtime text and never depended on the art.
  const ctx = stubContext();
  const warnings = await withWarnings(async () => {
    const title = createTitleFrames({ url: 'titleBg.svg', loadText: () => Promise.reject(new Error('HTTP 500')) });
    assert.equal(title.draw(ctx, 0, 1), false, 'nothing is ready on the first frame');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(title.failed(), true, 'and the file is given up on');
    for (let frame = 0; frame < 5; frame += 1) {
      assert.equal(title.draw(ctx, frame, 1), false, `frame ${frame} paints nothing`);
    }
  });
  assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}`);
  assert.match(warnings[0], /title/i);
  assert.ok(!ctx.calls.includes('drawImage'), 'nothing was ever blitted');
});

test('a title file in the wrong shape is given up on just as quietly', async () => {
  const ctx = stubContext();
  const warnings = await withWarnings(async () => {
    const title = createTitleFrames({ url: 'titleBg.svg', loadText: () => Promise.resolve('<html>nope</html>') });
    title.draw(ctx, 0, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(title.failed(), true);
    assert.equal(title.draw(ctx, 1, 1), false);
  });
  assert.equal(warnings.length, 1);
});
