import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnim, stepAnim, frameAt } from '../js/core/anim.js';

test('4 frames at 12 fps: one frame every 5 ticks, loops', () => {
  const a = createAnim(4, 12);
  assert.equal(a.frame, 0);
  for (let i = 0; i < 5; i++) stepAnim(a);
  assert.equal(a.frame, 1);
  for (let i = 0; i < 5; i++) stepAnim(a);
  assert.equal(a.frame, 2);
  for (let i = 0; i < 10; i++) stepAnim(a);
  assert.equal(a.frame, 0);
});

test('a single frame never moves', () => {
  const a = createAnim(1, 12);
  for (let i = 0; i < 100; i++) stepAnim(a);
  assert.equal(a.frame, 0);
});

test('per-frame durations [8,14]: frame at ticks 0,7,8,21,22 = 0,0,1,1,0', () => {
  const a = createAnim(2, [8, 14]); const seen = {};
  for (let t = 0; t <= 22; t++) { seen[t] = a.frame; stepAnim(a); }
  assert.deepEqual([seen[0], seen[7], seen[8], seen[21], seen[22]], [0, 0, 1, 1, 0]);
});

test('a static sprite (timing null) stays on frame 0', () => {
  const a = createAnim(1, null);
  for (let i = 0; i < 60; i++) stepAnim(a);
  assert.equal(a.frame, 0);
});

test('durations must have one entry per frame', () => {
  assert.throws(() => createAnim(3, [8, 14]), /duration/i);
});

// frameAt() is the stateless form of the same playback: it answers "which frame is
// showing on tick N" without an anim object, so a whole wave of enemies can be animated
// from (world.frame + animOffset) without storing state or consuming randomness.
test('frameAt matches stepAnim tick for tick, for both fps and durations', () => {
  for (const [count, timing] of [[2, [8, 14]], [4, 12], [3, [35, 11, 24]], [8, 30]]) {
    const a = createAnim(count, timing);
    for (let t = 0; t < 200; t++) {
      assert.equal(frameAt(timing, count, t), a.frame, `count=${count} tick=${t}`);
      stepAnim(a);
    }
  }
});

test('frameAt loops and handles negative and static input', () => {
  assert.equal(frameAt([8, 14], 2, 22), 0);      // one full loop later -> back to frame 0
  assert.equal(frameAt([8, 14], 2, -1), 1);      // negative ticks wrap into range
  assert.equal(frameAt(null, 1, 999), 0);        // a static sprite never leaves frame 0
  assert.equal(frameAt(null, 5, 999), 0);        // no timing -> no playback
});
