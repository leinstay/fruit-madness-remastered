// js/game/collision.js — circle hit tests. The original used pixel-perfect detection;
// circles are close enough and keep the simulator fast and deterministic.
import { PLAYER } from '../config.js';

/** Collecting is more forgiving than dying. */
export const PICKUP_R = PLAYER.HIT_R + 8;

export function circlesHit(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const r = a.r + b.r;
  return dx * dx + dy * dy < r * r;
}

/** Does the player (radius PLAYER.HIT_R) touch any enemy? */
export function hitsAny(player, enemies) {
  for (const e of enemies) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const r = PLAYER.HIT_R + e.r;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

/** Remove every muffin the player touches from `sugars` and return how many. */
export function collectSugars(player, sugars) {
  let taken = 0;
  for (let i = sugars.length - 1; i >= 0; i--) {
    const s = sugars[i];
    const dx = player.x - s.x;
    const dy = player.y - s.y;
    const r = PICKUP_R + s.r;
    if (dx * dx + dy * dy < r * r) {
      sugars.splice(i, 1);
      taken += 1;
    }
  }
  return taken;
}
