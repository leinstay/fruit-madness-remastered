import test from 'node:test';
import assert from 'node:assert/strict';
import { hitTest, nextIndex } from '../js/scenes/ui.js';

const items = [
  { id: 'start', x: 100, y: 100, w: 100, h: 20 },
  { id: 'board', x: 100, y: 140, w: 100, h: 20 },
  { id: 'sound', x: 500, y: 20, w: 80, h: 16 },
];

test('hitTest returns the index of the item under the point', () => {
  assert.equal(hitTest(items, 150, 110), 0);
  assert.equal(hitTest(items, 150, 150), 1);
  assert.equal(hitTest(items, 540, 28), 2);
});

test('hitTest includes the edges and rejects everything outside', () => {
  assert.equal(hitTest(items, 100, 100), 0);
  assert.equal(hitTest(items, 200, 120), 0);
  assert.equal(hitTest(items, 99, 110), -1);
  assert.equal(hitTest(items, 150, 130), -1);
  assert.equal(hitTest(items, 0, 0), -1);
});

test('hitTest ignores disabled items and an empty list', () => {
  const disabled = [{ id: 'a', x: 0, y: 0, w: 10, h: 10, disabled: true }];
  assert.equal(hitTest(disabled, 5, 5), -1);
  assert.equal(hitTest([], 5, 5), -1);
  assert.equal(hitTest(null, 5, 5), -1);
});

test('nextIndex wraps in both directions', () => {
  assert.equal(nextIndex(0, 1, 3), 1);
  assert.equal(nextIndex(2, 1, 3), 0);
  assert.equal(nextIndex(0, -1, 3), 2);
  assert.equal(nextIndex(1, -1, 3), 0);
});

test('nextIndex copes with an empty list and an out-of-range start', () => {
  assert.equal(nextIndex(0, 1, 0), -1);
  assert.equal(nextIndex(-1, 1, 3), 0);
  assert.equal(nextIndex(-1, -1, 3), 2);
  assert.equal(nextIndex(9, 1, 3), 0);   // out of range: start over rather than wrap by modulo
  assert.equal(nextIndex(9, -1, 3), 2);
});
