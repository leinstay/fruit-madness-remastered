// Sprite frame playback on the fixed 60 Hz tick. Pure, no DOM.
// `fpsOrDurations`: a number is a uniform fps, an array is per-frame holds in 60 Hz ticks
// (one entry per frame), null/undefined means a static sprite.

const TICKS_PER_SECOND = 60;

function normalizeDurations(count, fpsOrDurations, what = 'createAnim') {
  if (Array.isArray(fpsOrDurations)) {
    if (fpsOrDurations.length !== count) {
      throw new Error(`${what}: durations length ${fpsOrDurations.length} does not match frameCount ${count}`);
    }
    return fpsOrDurations.map((d) => Math.max(1, Math.round(d)));
  }
  const fps = typeof fpsOrDurations === 'number' && fpsOrDurations > 0 ? fpsOrDurations : TICKS_PER_SECOND;
  const hold = Math.max(1, Math.round(TICKS_PER_SECOND / fps));
  return new Array(count).fill(hold);
}

export function createAnim(frameCount, fpsOrDurations) {
  const count = Math.max(1, Math.floor(frameCount) || 1);
  return { frame: 0, tick: 0, frameCount: count, durations: normalizeDurations(count, fpsOrDurations) };
}

export function stepAnim(anim) {
  if (!anim || anim.frameCount <= 1) return anim;
  anim.tick += 1;
  if (anim.tick >= anim.durations[anim.frame]) {
    anim.tick = 0;
    anim.frame = (anim.frame + 1) % anim.frameCount;
  }
  return anim;
}

/**
 * The stateless form of the same playback: which frame of `frameCount` is showing on the
 * absolute tick `tick`, given the manifest `timing` (a number = fps, an array = per-frame
 * holds, null = static). Lets many entities share one animation while each runs at its own
 * phase — `frameAt(timing, count, world.frame + e.animOffset)` — with no per-entity state
 * and without consuming any randomness at draw time.
 * A null timing on a multi-frame sprite means "no playback recorded", so frame 0 is held.
 */
export function frameAt(timing, frameCount, tick) {
  const count = Math.max(1, Math.floor(frameCount) || 1);
  if (count <= 1 || timing === null || timing === undefined) return 0;
  const durations = normalizeDurations(count, timing, 'frameAt');
  let total = 0;
  for (const d of durations) total += d;
  let t = Math.floor(tick) % total;
  if (t < 0) t += total;
  for (let i = 0; i < count; i++) {
    if (t < durations[i]) return i;
    t -= durations[i];
  }
  return count - 1;
}

// Total loop length in ticks — used to pick a seeded start offset so that a wave of
// enemies does not animate in lockstep.
export function animLoopTicks(anim) {
  if (!anim) return 1;
  let total = 0;
  for (const d of anim.durations) total += d;
  return Math.max(1, total);
}
