// Sprite frame playback on the fixed 60 Hz tick. Pure, no DOM.
// `fpsOrDurations`: a number is a uniform fps, an array is per-frame holds in 60 Hz ticks
// (one entry per frame), null/undefined means a static sprite.

const TICKS_PER_SECOND = 60;

export function createAnim(frameCount, fpsOrDurations) {
  const count = Math.max(1, Math.floor(frameCount) || 1);
  let durations;
  if (Array.isArray(fpsOrDurations)) {
    if (fpsOrDurations.length !== count) {
      throw new Error(`createAnim: durations length ${fpsOrDurations.length} does not match frameCount ${count}`);
    }
    durations = fpsOrDurations.map((d) => Math.max(1, Math.round(d)));
  } else {
    const fps = typeof fpsOrDurations === 'number' && fpsOrDurations > 0 ? fpsOrDurations : TICKS_PER_SECOND;
    const hold = Math.max(1, Math.round(TICKS_PER_SECOND / fps));
    durations = new Array(count).fill(hold);
  }
  return { frame: 0, tick: 0, frameCount: count, durations };
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

// Total loop length in ticks — used to pick a seeded start offset so that a wave of
// enemies does not animate in lockstep.
export function animLoopTicks(anim) {
  if (!anim) return 1;
  let total = 0;
  for (const d of anim.durations) total += d;
  return Math.max(1, total);
}
