// js/game/modes.js — attack modes and enemy spawning (ported from GameLoop.as)
import { W, H, SPEED, ENEMY } from '../config.js';

const LANES = 5;
export const laneCount = LANES;

// Lane centre along an axis: (lane + 0.5) * span / 5.
const laneY = (lane) => (lane + 0.5) * (H / LANES);
const laneX = (lane) => (lane + 0.5) * (W / LANES);

// Diagonal modes: horizontal speed 4 + d, vertical 2/3 of it.
const diag = (sx, sy) => (d) => [sx * (SPEED.d + d), sy * (2 / 3) * (SPEED.d + d)];

export const MODES = {
  1: { // from the right
    axis: 'h', lanePx: H / LANES,
    danger: { sprite: 'dangerVt', x: W - 30, y: H / 2 },
    vel: (d) => [-(SPEED.h + d), 0],
    spawn: (lane, s) => [W + s, laneY(lane)],
  },
  2: { // from the left
    axis: 'h', lanePx: H / LANES,
    danger: { sprite: 'dangerVt', x: 30, y: H / 2 },
    vel: (d) => [SPEED.h + d, 0],
    spawn: (lane, s) => [-s, laneY(lane)],
  },
  3: { // from the top
    axis: 'v', lanePx: W / LANES,
    danger: { sprite: 'dangerHz', x: W / 2, y: 55 },
    vel: (d) => [0, SPEED.v + d],
    spawn: (lane, s) => [laneX(lane), -s],
  },
  4: { // from the bottom
    axis: 'v', lanePx: W / LANES,
    danger: { sprite: 'dangerHz', x: W / 2, y: H - 40 },
    vel: (d) => [0, -(SPEED.v + d)],
    spawn: (lane, s) => [laneX(lane), H + s],
  },
  5: { // from the top-left, heading down-right
    axis: 'd', lanePx: H / LANES,
    danger: { sprite: 'dangerDiag', x: 100, y: 100 },
    vel: diag(1, 1),
    spawn: (lane, s) => [
      [0.75 * W, 0.25 * W, -s, -s, -s][lane],
      [-s, -s, -s, 0.25 * H, 0.75 * H][lane],
    ],
  },
  6: { // from the bottom-right, heading up-left
    axis: 'd', lanePx: H / LANES,
    danger: { sprite: 'dangerDiag', x: W - 100, y: H - 100 },
    vel: diag(-1, -1),
    spawn: (lane, s) => [
      [0.25 * W, 0.75 * W, W + s, W + s, W + s][lane],
      [H + s, H + s, H + s, 0.75 * H, 0.25 * H][lane],
    ],
  },
  7: { // from the top-right, heading down-left
    axis: 'd', lanePx: H / LANES,
    danger: { sprite: 'dangerDiag', x: W - 100, y: 100 },
    vel: diag(-1, 1),
    spawn: (lane, s) => [
      [0.25 * W, 0.75 * W, W + s, W + s, W + s][lane],
      [-s, -s, -s, 0.25 * H, 0.75 * H][lane],
    ],
  },
  8: { // from the bottom-left, heading up-right
    axis: 'd', lanePx: H / LANES,
    danger: { sprite: 'dangerDiag', x: 100, y: H - 100 },
    vel: diag(1, -1),
    spawn: (lane, s) => [
      [0.75 * W, 0.25 * W, -s, -s, -s][lane],
      [H + s, H + s, H + s, 0.75 * H, 0.25 * H][lane],
    ],
  },
};

// Modes whose attack directions are perpendicular, safe to run as a double side.
export const PERPENDICULAR_PAIRS = [[1, 3], [1, 4], [2, 3], [2, 4]];

export function spawnEnemy(modeId, lane, difficulty, opts = {}) {
  const mode = MODES[modeId];
  const sprite = opts.sprite ?? 'cherry';
  const r = opts.r ?? ENEMY.HIT_R;
  const size = opts.size ?? ENEMY.SIZE;
  const [x, y] = mode.spawn(lane, size);
  const [vx, vy] = mode.vel(difficulty);
  return { x, y, vx, vy, r, size, sprite };
}

export function stepEnemy(e) {
  e.x += e.vx;
  e.y += e.vy;
}

export function isOffscreen(e) {
  const out = e.x < -2 * e.size || e.x > W + 2 * e.size || e.y < -2 * e.size || e.y > H + 2 * e.size;
  // Only cull an enemy that is also moving away from the field: a freshly spawned
  // diagonal enemy sits outside a corner while heading into the field.
  const leaving = (e.x < 0 && e.vx <= 0) || (e.x > W && e.vx >= 0)
    || (e.y < 0 && e.vy <= 0) || (e.y > H && e.vy >= 0);
  return out && leaving;
}
