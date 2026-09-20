// tests/canvas.test.js — the device-pixel geometry of the canvas. Pure arithmetic: the
// page decides the CSS box, this decides how many real pixels are drawn on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { W, H } from '../js/config.js';
import { computeBackingSize, snapToDevice, deviceScale, MAX_RENDER_SCALE } from '../js/core/canvas.js';

test('a 1:1 box on a non-retina display is the logical field itself', () => {
  assert.deepEqual(computeBackingSize(W, H, 1), { width: 600, height: 450, scale: 1 });
});

test('the backing store is the CSS box times the device pixel ratio', () => {
  assert.deepEqual(computeBackingSize(600, 450, 2), { width: 1200, height: 900, scale: 2 });
  assert.deepEqual(computeBackingSize(300, 225, 2), { width: 600, height: 450, scale: 1 });
  assert.deepEqual(computeBackingSize(800, 600, 1.5), { width: 1200, height: 900, scale: 2 });
});

test('the scale is capped so a big window on a dense display stays affordable', () => {
  const big = computeBackingSize(1600, 1200, 3);
  assert.equal(big.scale, MAX_RENDER_SCALE);
  assert.deepEqual([big.width, big.height], [1800, 1350]);
  assert.equal(computeBackingSize(1600, 1200, 3, 2).scale, 2);
});

test('a box that is not 4:3 is fitted inside, never stretched', () => {
  // A tall box: the width decides. A wide one: the height does.
  assert.deepEqual(computeBackingSize(600, 900, 1), { width: 600, height: 450, scale: 1 });
  assert.deepEqual(computeBackingSize(1200, 450, 1), { width: 600, height: 450, scale: 1 });
});

test('the reported scale is the one the backing store really has', () => {
  const r = computeBackingSize(533.33, 400, 1);
  assert.equal(r.scale, r.width / W);
  assert.ok(Math.abs(r.height - Math.round(H * r.scale)) <= 1);
});

test('nonsense inputs fall back to the logical field at 1:1', () => {
  assert.deepEqual(computeBackingSize(0, 0, 0), { width: 600, height: 450, scale: 1 });
  assert.deepEqual(computeBackingSize(NaN, undefined, NaN), { width: 600, height: 450, scale: 1 });
  assert.deepEqual(computeBackingSize(-10, -10, -2), { width: 600, height: 450, scale: 1 });
});

test('snapToDevice puts a logical coordinate on a whole device pixel', () => {
  assert.equal(snapToDevice(10.4, 1), 10);
  assert.equal(snapToDevice(10.6, 1), 11);
  assert.equal(snapToDevice(10.4, 2), 10.5);
  assert.equal(snapToDevice(10.3, 2), 10.5);
  assert.equal(snapToDevice(10.1, 2), 10);
  assert.equal(snapToDevice(10.4, 4), 10.5);
  assert.equal(snapToDevice(10.3, 4), 10.25);
});

test('snapToDevice is a no-op on values already on the grid, and never returns NaN', () => {
  for (const s of [1, 2, 3]) {
    for (const v of [0, 12, -7.5]) assert.equal(snapToDevice(snapToDevice(v, s), s), snapToDevice(v, s));
  }
  assert.equal(snapToDevice(NaN, 2), 0);
  assert.equal(snapToDevice(5, 0), 5);
  assert.equal(snapToDevice(5.5, NaN), 6);
});

test('deviceScale reads the scale out of the context transform', () => {
  assert.equal(deviceScale(null), 1);
  assert.equal(deviceScale({}), 1);
  assert.equal(deviceScale({ getTransform: () => ({ a: 2, b: 0 }) }), 2);
  // A rotated context still reports the length of the transformed unit vector.
  const c = Math.cos(0.3) * 3, s = Math.sin(0.3) * 3;
  assert.ok(Math.abs(deviceScale({ getTransform: () => ({ a: c, b: s }) }) - 3) < 1e-9);
  assert.equal(deviceScale({ getTransform: () => { throw new Error('no'); } }), 1);
  assert.equal(deviceScale({ getTransform: () => ({ a: 0, b: 0 }) }), 1);
});
