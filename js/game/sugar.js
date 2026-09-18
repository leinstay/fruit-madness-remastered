// js/game/sugar.js — muffins (the original's "sugar"): fuel pickups that cross the field
// diagonally from the four corners. A faithful port of GameLoop.as:456-592 + Sugar.as.
import { W, H, SUGAR } from '../config.js';

const SIZE = SUGAR.SIZE;

// The five spawn points of each corner, exactly as in the original switch blocks.
// Corner order and sign conventions follow Sugar.moveSugarIn*Diagonal():
//   corner 1 (top-left, major diagonal, speed negated)   -> vx = +s, vy = +2/3 s
//   corner 2 (bottom-right, major diagonal)              -> vx = -s, vy = -2/3 s
//   corner 3 (top-right, minor diagonal)                 -> vx = -s, vy = +2/3 s
//   corner 4 (bottom-left, minor diagonal, speed negated)-> vx = +s, vy = -2/3 s
const CORNERS = [
  {
    dx: 1, dy: 1,
    points: [
      [W / 2, -SIZE], [W / 4, -SIZE], [-SIZE, -SIZE], [-SIZE, H / 4], [-SIZE, H / 2],
    ],
  },
  {
    dx: -1, dy: -1,
    points: [
      [W / 2, H + SIZE], [(3 * W) / 4, H + SIZE], [W + SIZE, H + SIZE],
      [W + SIZE, (3 * H) / 4], [W + SIZE, H / 2],
    ],
  },
  {
    dx: -1, dy: 1,
    points: [
      [W / 2, -SIZE], [(3 * W) / 4, -SIZE], [W + SIZE, -SIZE],
      [W + SIZE, H / 4], [W + SIZE, H / 2],
    ],
  },
  {
    dx: 1, dy: -1,
    points: [
      [W / 2, H + SIZE], [W / 4, H + SIZE], [-SIZE, H + SIZE],
      [-SIZE, (3 * H) / 4], [-SIZE, H / 2],
    ],
  },
];

/**
 * One muffin wave. For each corner the original draws `n = randomRange(0,2)` and then
 * loops `for (amount = 1; amount < n; amount++)` — an off-by-one that spawns
 * `max(0, n - 1)` muffins, i.e. 0 or 1 per corner, never 2. The behaviour (and with it
 * the fuel economy: 4 corners x P(n = 2) = 1/3 ~= 1.33 muffins per wave) is kept as is.
 */
export function spawnSugarWave(rng) {
  const out = [];
  for (const corner of CORNERS) {
    const n = rng.int(0, 2);
    for (let amount = 1; amount < n; amount++) {
      const s = rng.int(SUGAR.SPEED_MIN, SUGAR.SPEED_MAX);
      const [x, y] = corner.points[rng.int(1, 5) - 1];
      out.push({
        x, y,
        vx: corner.dx * s,
        vy: corner.dy * (2 / 3) * s,
        r: SUGAR.HIT_R,
        size: SIZE,
      });
    }
  }
  return out;
}

/** A muffin that has left the field and is still heading away from it. */
export function isSugarOffscreen(s) {
  const out = s.x < -2 * s.size || s.x > W + 2 * s.size || s.y < -2 * s.size || s.y > H + 2 * s.size;
  const leaving = (s.x < 0 && s.vx <= 0) || (s.x > W && s.vx >= 0)
    || (s.y < 0 && s.vy <= 0) || (s.y > H && s.vy >= 0);
  return out && leaving;
}

/** Move every muffin, drop the ones that left the field, return how many were dropped. */
export function stepSugars(sugars) {
  let missed = 0;
  for (let i = sugars.length - 1; i >= 0; i--) {
    const s = sugars[i];
    s.x += s.vx;
    s.y += s.vy;
    if (isSugarOffscreen(s)) {
      sugars.splice(i, 1);
      missed += 1;
    }
  }
  return missed;
}
