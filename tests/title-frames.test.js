// tests/title-frames.test.js — the pure half of js/core/title-frames.js: cutting one
// frame out of the single-file title animation by string slicing, and the little LRU
// that keeps the rasterised frames from eating the machine. No DOM, no canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sliceTitleFrames, buildFrameParts, buildFrameDocument, buildFullFrameDocument,
  referencedIds, resolveDefinitions, createFrameCache, frameCacheBytes,
  FRAME_CACHE_LIMIT, MAX_TITLE_SCALE,
} from '../js/core/title-frames.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'assets', 'sprites', 'titleBg.svg');

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
  assert.equal(parts.definitions.size, 295);
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

test('the frame cache never holds more than its limit', () => {
  const cache = createFrameCache(3);
  assert.deepEqual(cache.set('a', 1), []);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.size, 3);
  assert.deepEqual(cache.set('d', 4), [1], 'the least recently used is evicted');
  assert.deepEqual(cache.keys(), ['b', 'c', 'd']);
  assert.equal(cache.get('a'), null);
  assert.equal(cache.get('b'), 2);
  assert.deepEqual(cache.keys(), ['c', 'd', 'b'], 'a hit counts as a use');
  assert.deepEqual(cache.set('e', 5), [3], 'c was the oldest now');
  cache.set('e', 6);
  assert.equal(cache.size, 3, 'replacing a key does not grow the cache');
  assert.equal(cache.get('e'), 6);
  assert.deepEqual(cache.clear().sort(), [2, 4, 6]);
  assert.equal(cache.size, 0);
});

test('a bad limit still gives a usable cache of one', () => {
  for (const bad of [0, -3, NaN, undefined]) {
    const cache = createFrameCache(bad);
    assert.ok(cache.limit >= 1, `limit ${bad}`);
    cache.set('a', 1);
    cache.set('b', 2);
    assert.ok(cache.size <= cache.limit);
  }
});

test('a full cache of title frames stays within its memory budget', () => {
  // The title frame is the whole field, so the cap on the render scale is what keeps
  // this in hand: 6 frames of 1200x900 RGBA is about 26 MB, and three device pixels per
  // logical one would be more than twice that.
  assert.equal(FRAME_CACHE_LIMIT, 6);
  assert.equal(MAX_TITLE_SCALE, 2);
  const bytes = frameCacheBytes(FRAME_CACHE_LIMIT, [600, 450], MAX_TITLE_SCALE);
  assert.equal(bytes, 6 * 1200 * 900 * 4);
  assert.ok(bytes <= 26 * 1000 * 1000, `${bytes} bytes at the cap`);
  assert.ok(frameCacheBytes(FRAME_CACHE_LIMIT, [600, 450], 1) <= bytes / 4 + 1);
});
