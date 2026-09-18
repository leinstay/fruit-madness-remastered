// tests/helpers/solver.js — the offline survivability simulator.
//
// The world (director + enemies) steps without ever reading the player, so a run can be
// recorded once as a per-frame snapshot of enemies and then replayed against a bot that
// searches for a safe path. The bot uses the REAL stepPlayer and the REAL hit test from
// collision.js, so a green run is a statement about the actual game rules.
import { PLAYER } from '../../js/config.js';
import { createPlayer, stepPlayer } from '../../js/game/player.js';
import { hitsAny } from '../../js/game/collision.js';
import { createWorld, stepWorld } from '../../js/game/world.js';

// Neutral + the 8 directions; stepPlayer only reads these four flags.
const ACTIONS = [
  {},
  { left: true }, { right: true }, { up: true }, { down: true },
  { left: true, up: true }, { right: true, up: true },
  { left: true, down: true }, { right: true, down: true },
];

/** Sort one frame's flat [x,y,r,...] array by x so the broad phase can scan a window. */
function prepareFrame(flat) {
  const n = (flat.length / 3) | 0;
  const order = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => flat[a * 3] - flat[b * 3]);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const rs = new Float64Array(n);
  let maxR = 0;
  for (let k = 0; k < n; k++) {
    const i = order[k];
    xs[k] = flat[i * 3];
    ys[k] = flat[i * 3 + 1];
    rs[k] = flat[i * 3 + 2];
    if (rs[k] > maxR) maxR = rs[k];
  }
  return { n, xs, ys, rs, window: PLAYER.HIT_R + maxR };
}

// Narrow phase scratch: one probe player and one single-enemy array, so the decision is
// literally hitsAny() from the game and nothing is allocated per test.
const probe = { x: 0, y: 0 };
const one = [{ x: 0, y: 0, r: 0 }];

function hitsFrame(fr, px, py) {
  const { n, xs, ys, rs, window } = fr;
  if (n === 0) return false;
  let k = 0;
  if (n > 8) { // binary search for the first enemy that can still reach px
    let lo = 0, hi = n;
    const min = px - window;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] < min) lo = mid + 1; else hi = mid;
    }
    k = lo;
  }
  const max = px + window;
  probe.x = px; probe.y = py;
  for (; k < n && xs[k] <= max; k++) {
    one[0].x = xs[k]; one[0].y = ys[k]; one[0].r = rs[k];
    if (hitsAny(probe, one)) return true;
  }
  return false;
}

/** Distance from the player to the nearest enemy surface — the beam's ranking score. */
function clearance(fr, px, py) {
  let best = Infinity;
  for (let k = 0; k < fr.n; k++) {
    const dx = px - fr.xs[k];
    const dy = py - fr.ys[k];
    const d = Math.sqrt(dx * dx + dy * dy) - fr.rs[k];
    if (d < best) best = d;
  }
  return best;
}

// Coarse state key: round(x/15) | round(y/15) | round(vx/2) | round(vy/2).
const keyOf = (x, y, vx, vy) => (((Math.round(x / 15) * 64 + Math.round(y / 15)) * 16
  + (Math.round(vx / 2) + 8)) * 16 + (Math.round(vy / 2) + 8));

/**
 * solveAgainst(framesOfEnemies, opts) -> { ok, diedAtFrame? }
 * `framesOfEnemies[f]` is a flat [x, y, r, ...] list of the enemies on frame f.
 */
export function solveAgainst(framesOfEnemies, { beam = 600, chunk = 6, start } = {}) {
  const total = framesOfEnemies.length;
  const frames = new Array(total);
  for (let f = 0; f < total; f++) frames[f] = prepareFrame(framesOfEnemies[f]);

  const cap = beam * ACTIONS.length + 16;
  let cur = new Float64Array(cap * 4);
  let nxt = new Float64Array(cap * 4);
  const p0 = start ?? createPlayer();
  cur[0] = p0.x; cur[1] = p0.y; cur[2] = p0.vx; cur[3] = p0.vy;
  let curN = 1;

  const seen = new Map();
  const scratch = { x: 0, y: 0, vx: 0, vy: 0, rotation: 0 };
  let lastDeath = 0;

  for (let f = 0; f < total;) {
    const len = Math.min(chunk, total - f);
    seen.clear();
    let nxtN = 0;

    for (let s = 0; s < curN; s++) {
      const b = s * 4;
      for (let a = 0; a < ACTIONS.length; a++) {
        scratch.x = cur[b]; scratch.y = cur[b + 1];
        scratch.vx = cur[b + 2]; scratch.vy = cur[b + 3];
        const action = ACTIONS[a];
        let alive = true;
        for (let k = 0; k < len; k++) {
          stepPlayer(scratch, action, true);
          if (hitsFrame(frames[f + k], scratch.x, scratch.y)) {
            if (f + k > lastDeath) lastDeath = f + k;
            alive = false;
            break;
          }
        }
        if (!alive) continue;
        const key = keyOf(scratch.x, scratch.y, scratch.vx, scratch.vy);
        if (seen.has(key)) continue;
        seen.set(key, nxtN);
        const o = nxtN * 4;
        nxt[o] = scratch.x; nxt[o + 1] = scratch.y;
        nxt[o + 2] = scratch.vx; nxt[o + 3] = scratch.vy;
        nxtN++;
      }
    }

    f += len;
    if (nxtN === 0) return { ok: false, diedAtFrame: lastDeath };

    if (nxtN > beam) {
      // Keep the `beam` states with the largest distance to the nearest enemy.
      const fr = frames[f - 1];
      const idx = new Array(nxtN);
      const score = new Float64Array(nxtN);
      for (let i = 0; i < nxtN; i++) {
        idx[i] = i;
        score[i] = clearance(fr, nxt[i * 4], nxt[i * 4 + 1]);
      }
      idx.sort((x, y) => score[y] - score[x]);
      for (let i = 0; i < beam; i++) {
        const o = idx[i] * 4;
        const t = i * 4;
        cur[t] = nxt[o]; cur[t + 1] = nxt[o + 1];
        cur[t + 2] = nxt[o + 2]; cur[t + 3] = nxt[o + 3];
      }
      curN = beam;
    } else {
      const tmp = cur; cur = nxt; nxt = tmp;
      curN = nxtN;
    }
  }
  return { ok: true };
}

/** Record `frames` frames of the world for `seed` and look for a safe path through them. */
export function findSafePath(seed, frames, { startShift = 0, beam = 600, chunk = 6 } = {}) {
  const w = createWorld(seed, { startShift });
  const snapshots = new Array(frames);
  for (let f = 0; f < frames; f++) {
    stepWorld(w);
    const es = w.enemies;
    const flat = new Float64Array(es.length * 3);
    for (let i = 0; i < es.length; i++) {
      flat[i * 3] = es[i].x;
      flat[i * 3 + 1] = es[i].y;
      flat[i * 3 + 2] = es[i].r;
    }
    snapshots[f] = flat;
  }
  return solveAgainst(snapshots, { beam, chunk });
}
