// js/game/events.js — mini-events that replace a regular attack phase.
// Pure logic: every random decision goes through the injected rng, nothing is stored
// on screen — each step only reports what should be spawned on that frame.
import { W, ENEMY, SUGAR } from '../config.js';

const COLS = 9;
const colX = (c) => ((c + 0.5) * W) / COLS;
const clampCol = (c) => (c < 0 ? 0 : c > COLS - 1 ? COLS - 1 : c);
const empty = () => ({ enemies: [], sugars: [], telegraphs: [] });

// The three bands a boss can fly along (2 lanes tall, 120 px).
export const BOSS_LANES = [90, 225, 360];

const BERRY_INTERVAL = 20;
const BERRY_SPEED = 3;
const MUFFIN_INTERVAL = 15;
const MUFFIN_SPEED = 3;
const BOSS_PASS_FRAMES = 180;
const BOSS_TELEGRAPH_FRAMES = 90;
const BOSS_PASSES = 3;
const BOSS_SIZE = 120;

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Berry rain: slow berries from above. One column stays free, it drifts by at most
 * one column per wave and its two neighbours are kept empty as well, so the player
 * can always follow the hole without a sudden lane jump.
 */
function berryRain(rng) {
  const size = 2 * ENEMY.BERRY_R;
  const ev = {
    gap: 4,
    step(frame) {
      const out = empty();
      if (frame % BERRY_INTERVAL !== 0) return out;
      ev.gap = clampCol(ev.gap + rng.int(-1, 1));
      const free = new Set([ev.gap - 1, ev.gap, ev.gap + 1]);
      const candidates = [];
      for (let c = 0; c < COLS; c++) if (!free.has(c)) candidates.push(c);
      shuffle(candidates, rng);
      const count = rng.int(2, 3);
      for (const c of candidates.slice(0, count)) {
        out.enemies.push({
          x: colX(c), y: -size, vx: 0, vy: BERRY_SPEED,
          r: ENEMY.BERRY_R, size, sprite: 'berry', animOffset: rng.int(0, 59),
        });
      }
      return out;
    },
  };
  return ev;
}

/**
 * Boss flyby: three passes of one huge fruit from the right, each announced by a
 * full-width band 90 frames before the boss enters. The band never sits on the same
 * row twice in a row.
 */
function bossFlyby(rng, difficulty) {
  let cy = BOSS_LANES[1];
  let prevCy = null;
  const ev = {
    cy: null,
    step(frame) {
      const out = empty();
      const pass = Math.floor((frame - 1) / BOSS_PASS_FRAMES);
      if (pass < 0 || pass >= BOSS_PASSES) return out;
      const local = frame - pass * BOSS_PASS_FRAMES; // 1 .. BOSS_PASS_FRAMES
      if (local === 1) {
        cy = rng.pick(BOSS_LANES.filter((y) => y !== prevCy));
        prevCy = cy;
        ev.cy = cy;
      }
      if (local <= BOSS_TELEGRAPH_FRAMES) {
        out.telegraphs.push({ x: 0, y: cy - BOSS_SIZE / 2, w: W, h: BOSS_SIZE });
      } else if (local === BOSS_TELEGRAPH_FRAMES + 1) {
        out.enemies.push({
          x: W + BOSS_SIZE, y: cy, vx: -(5 + difficulty), vy: 0,
          r: ENEMY.BOSS_R, size: BOSS_SIZE, sprite: 'boss', animOffset: rng.int(0, 59),
        });
      }
      return out;
    },
  };
  return ev;
}

/** Muffin shower: fuel from above and no enemies at all. */
function muffinShower(rng) {
  return {
    step(frame) {
      const out = empty();
      if (frame % MUFFIN_INTERVAL !== 0) return out;
      out.sugars.push({
        x: colX(rng.int(0, COLS - 1)), y: -SUGAR.SIZE, vx: 0, vy: MUFFIN_SPEED,
        r: SUGAR.HIT_R, size: SUGAR.SIZE,
      });
      return out;
    },
  };
}

/**
 * createEvent(name, rng, difficulty) -> { step(frame) -> {enemies, sugars, telegraphs} }
 * `frame` is 1-based and counted from the first frame of the event phase.
 */
export function createEvent(name, rng, difficulty = 0) {
  switch (name) {
    case 'berryRain': return berryRain(rng);
    case 'bossFlyby': return bossFlyby(rng, difficulty);
    case 'muffinShower': return muffinShower(rng);
    default: throw new Error(`unknown event: ${name}`);
  }
}

export const EVENT_NAMES = ['berryRain', 'bossFlyby', 'muffinShower'];
