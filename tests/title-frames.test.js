// tests/title-frames.test.js — the pure half of js/core/title-frames.js: cutting one
// frame out of the single-file title animation by string slicing, and the little LRU
// that keeps the rasterised frames from eating the machine. No DOM, no canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sliceTitleFrames, buildFrameDocument, createFrameCache, frameCacheBytes,
  FRAME_CACHE_LIMIT, MAX_TITLE_SCALE,
} from '../js/core/title-frames.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'assets', 'sprites', 'titleBg.svg');

/** A miniature file in exactly the shape tools/make-title.py writes. */
const toy = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450" viewBox="200 110 600 450">',
  '<defs><g id="s0"><path d="M0 0"/></g></defs>',
  '<!--white backdrop intended by the artwork-->',
  '<rect x="200" y="110" width="600" height="450" fill="#ffffff"/>',
  '<!--frame:0--><g id="frame-0" transform="matrix(1,0,0,1,500,335)"><use href="#s0"/></g>',
  '<!--frame:1--><g id="frame-1" display="none" transform="matrix(1,0,0,1,500,335)"/>',
  '<!--frames:end--></svg>',
].join('');

test('the file is cut into a prefix, the frames and a suffix', () => {
  const parts = sliceTitleFrames(toy);
  assert.equal(parts.frames.length, 2);
  assert.ok(parts.prefix.startsWith('<svg'), 'the prefix carries the root element');
  assert.ok(parts.prefix.includes('<defs>'), 'the prefix carries the definitions');
  assert.ok(parts.prefix.includes('fill="#ffffff"'), 'the prefix carries the backdrop');
  assert.ok(!parts.prefix.includes('<!--frame:0-->'), 'the prefix stops at the first marker');
  assert.equal(parts.suffix, '<!--frames:end--></svg>');
});

test('a hidden frame is unhidden by the slice', () => {
  const parts = sliceTitleFrames(toy);
  assert.ok(!parts.frames[1].includes('display="none"'), 'frame 1 must be made visible');
  assert.ok(parts.frames[1].startsWith('<g id="frame-1"'));
  assert.ok(parts.frames[0].startsWith('<g id="frame-0"'));
});

test('a frame document is the prefix, that frame and the suffix', () => {
  const parts = sliceTitleFrames(toy);
  const doc = buildFrameDocument(parts, 1);
  assert.equal(doc, parts.prefix + parts.frames[1] + parts.suffix);
  assert.ok(doc.startsWith('<svg') && doc.endsWith('</svg>'));
  assert.ok(!doc.includes('<g id="frame-0"'), 'only the frame asked for is in the document');
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
  for (let n = 0; n < parts.frames.length; n += 1) {
    assert.ok(parts.frames[n].startsWith(`<g id="frame-${n}"`), `frame ${n}`);
    assert.ok(!parts.frames[n].includes('display="none"'), `frame ${n} is visible`);
  }
  // Every definition a frame points at has to be in the prefix, or the document the
  // browser gets would draw holes.
  const defined = new Set([...parts.prefix.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const frame of parts.frames) {
    for (const m of frame.matchAll(/(?:xlink:)?href="#([^"]+)"/g)) {
      assert.ok(defined.has(m[1]), `#${m[1]} resolves to nothing`);
    }
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
