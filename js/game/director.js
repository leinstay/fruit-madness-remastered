// js/game/director.js — attack/warning cycle, difficulty ramp, double sides.
// stepDirector() only reports what should be spawned on the current frame; moving and
// storing live entities is the world's job.
import { DIRECTOR } from '../config.js';
import { MODES, spawnEnemy, PERPENDICULAR_PAIRS } from './modes.js';
import { createFormation, maxGapShift, FORMATIONS } from './patterns.js';

// Every enemy is the cherry of the 2013 original.
export const FRUIT = 'cherry';

const ALL_MODES = [1, 2, 3, 4, 5, 6, 7, 8];
// Diagonal starting points are sparse, so only the two formations that read well there.
const DIAGONAL_FORMATIONS = ['random', 'stairs'];
// Lane pitch per axis, used for the "can the player still reach the gap?" bound.
const LANE_PX = { h: 90, v: 120, d: 90 };
const START_GAP = 2;

const empty = () => ({ enemies: [], sugars: [] });

/** Wave interval: 60 -> 35 frames, linearly over WAVE_INTERVAL_SHIFTS changes. */
export function waveInterval(shift) {
  const s = Math.min(Math.max(shift, 0), DIRECTOR.WAVE_INTERVAL_SHIFTS);
  const span = DIRECTOR.WAVE_INTERVAL_START - DIRECTOR.WAVE_INTERVAL_MIN;
  return Math.floor(DIRECTOR.WAVE_INTERVAL_START - (span * s) / DIRECTOR.WAVE_INTERVAL_SHIFTS);
}

/** Enemies per wave for a single stream; a double stream is always capped at 2. */
export function maxEnemiesFor(shift) {
  return Math.min(4, 3 + Math.floor(shift / 4));
}

// Build the per-phase state (one formation per stream) for the plan that is now current.
function armPlan(d) {
  d.interval = waveInterval(d.shift);
  d.offset = Math.floor(d.interval / 2);
  d.streams = [];
  const maxEnemies = d.plan.type === 'double' ? 2 : maxEnemiesFor(d.shift);
  for (const id of d.plan.modes) {
    const axis = MODES[id].axis;
    const kind = d.rng.pick(axis === 'd' ? DIAGONAL_FORMATIONS : FORMATIONS);
    const maxShift = maxGapShift(d.interval, LANE_PX[axis]);
    d.streams.push({
      id, kind,
      formation: createFormation(kind, d.rng, { maxShift, maxEnemies, startGap: START_GAP }),
    });
  }
}

function spawnWave(d, stream, out) {
  const { lanes } = stream.formation.next();
  for (const lane of lanes) {
    const e = spawnEnemy(stream.id, lane, d.difficulty, { sprite: d.plan.fruit });
    // A seeded per-enemy offset so a wave does not animate in lockstep (used by the
    // renderer; drawing must not consume randomness).
    e.animOffset = d.rng.int(0, 59);
    out.enemies.push(e);
  }
}

function chooseNextPlan(d) {
  const rng = d.rng;
  const nextShift = d.shift + 1;
  const current = d.plan.modes;

  const doubleChance = Math.min(DIRECTOR.DOUBLE_MAX_CHANCE, 0.1 * (nextShift - (DIRECTOR.DOUBLE_FROM_SHIFT - 1)));
  if (nextShift >= DIRECTOR.DOUBLE_FROM_SHIFT && rng.chance(doubleChance)) {
    const sameAsNow = (p) => p.length === current.length && p.every((m) => current.includes(m));
    const pairs = PERPENDICULAR_PAIRS.filter((p) => !sameAsNow(p));
    return { type: 'double', modes: [...rng.pick(pairs.length ? pairs : PERPENDICULAR_PAIRS)], fruit: FRUIT };
  }

  const pool = ALL_MODES.filter((m) => !current.includes(m));
  return { type: 'single', modes: [rng.pick(pool)], fruit: FRUIT };
}

function toWarning(d) {
  d.phase = 'warning';
  d.timer = 0;
  d.streams = [];
  d.nextPlan = chooseNextPlan(d);
  // One warning per stream: the descriptor of the attack it announces, plus how many
  // frames the sign has been up, which is what the scene fades it with.
  d.warnings = d.nextPlan.modes.map((m) => ({ ...MODES[m].danger, age: 0 }));
}

function toAttack(d) {
  d.shift += 1;
  d.difficulty += DIRECTOR.DIFFICULTY_STEP;
  d.plan = d.nextPlan;
  d.nextPlan = null;
  d.warnings = [];
  d.phase = 'attack';
  d.timer = 0;
  armPlan(d);
}

export function createDirector(rng, { startShift = 0 } = {}) {
  const d = {
    rng,
    phase: 'attack',
    timer: 0,
    shift: startShift,
    difficulty: DIRECTOR.START_DIFFICULTY + startShift * DIRECTOR.DIFFICULTY_STEP,
    plan: { type: 'single', modes: [1], fruit: FRUIT },
    nextPlan: null,
    warnings: [],
    streams: [],
    interval: waveInterval(startShift),
    offset: 0,
  };
  armPlan(d);
  return d;
}

/** Advance one 60 Hz frame and return what to spawn on it. */
export function stepDirector(d) {
  const out = empty();
  d.timer += 1;

  if (d.phase === 'warning') {
    if (d.timer >= DIRECTOR.WARNING_FRAMES) {
      toAttack(d);
      return out;
    }
    // The sign is as old as the phase, so every warning starts fully lit on its own frame 0.
    for (const warning of d.warnings) warning.age = d.timer;
    return out; // nothing spawns while the DANGER sign is up
  }

  // The first wave lands on frame `interval`: the first second stays empty, as in the original.
  if (d.timer % d.interval === 0) spawnWave(d, d.streams[0], out);
  // The second stream of a double runs in antiphase, half an interval later.
  if (d.streams.length > 1 && d.timer >= d.offset && (d.timer - d.offset) % d.interval === 0) {
    spawnWave(d, d.streams[1], out);
  }

  if (d.timer >= DIRECTOR.ATTACK_FRAMES) toWarning(d);
  return out;
}
