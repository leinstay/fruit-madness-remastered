import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoop } from '../js/core/loop.js';

test('fixed step: 100ms -> 6 updates capped at 5, 1 render; 16.67ms -> 1 update', () => {
  let u = 0, r = 0;
  const loop = createLoop({ update: () => u++, render: () => r++, now: () => 0, raf: () => {} });
  loop.tick(0); loop.tick(1000 / 60 + 0.01); assert.equal(u, 1); assert.equal(r, 2);
  loop.tick(1000 / 60 + 100); assert.equal(u, 1 + 5);
});

test('start/stop drive the injected raf and stop halts further updates', () => {
  let u = 0, t = 0;
  const queue = [];
  const loop = createLoop({
    update: () => u++,
    render: () => {},
    now: () => t,
    raf: (cb) => { queue.push(cb); return queue.length; },
  });
  loop.start();
  assert.equal(queue.length, 1);
  t = 1000 / 60; queue.shift()(t);
  assert.equal(u, 0); // the first frame only establishes the time base
  t = 2 * (1000 / 60); queue.shift()(t);
  assert.equal(u, 1);
  loop.stop();
  const pending = queue.shift();
  if (pending) { t = 10 * (1000 / 60); pending(t); }
  assert.equal(u, 1);
});
