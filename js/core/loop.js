// Fixed-step game loop with an accumulator.
// Pure of DOM at import time: `now` and `raf` are injected, so this module loads under Node.
import { STEP_MS } from '../config.js';

const MAX_UPDATES = 5; // spiral-of-death guard after the tab has been minimised

export function createLoop({
  update,
  render,
  now = () => performance.now(),
  raf = (cb) => requestAnimationFrame(cb),
  step = STEP_MS,
  maxUpdates = MAX_UPDATES,
} = {}) {
  let accumulator = 0;
  let last = null;
  let running = false;

  function tick(timestamp) {
    const t = typeof timestamp === 'number' ? timestamp : now();
    if (last === null) last = t; // the first tick only establishes the time base
    let dt = t - last;
    last = t;
    if (!(dt > 0)) dt = 0;
    accumulator += dt;

    let updates = 0;
    while (accumulator >= step && updates < maxUpdates) {
      update(step);
      accumulator -= step;
      updates += 1;
    }
    if (accumulator >= step) accumulator = 0; // we hit the cap: drop the backlog

    render(accumulator / step);
  }

  function frame(timestamp) {
    if (!running) return;
    tick(timestamp);
    if (running) raf(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = null;
    accumulator = 0;
    raf(frame);
  }

  function stop() {
    running = false;
  }

  return { start, stop, tick, get running() { return running; } };
}
