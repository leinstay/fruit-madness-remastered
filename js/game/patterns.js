// js/game/patterns.js — lane formations with a bounded, always reachable safe gap.
// Pure logic: every random decision goes through the injected rng.

const LANES = 5;
const ALL = [0, 1, 2, 3, 4];

const clampLane = (l) => (l < 0 ? 0 : l > LANES - 1 ? LANES - 1 : l);

/**
 * How many lanes the player can move across between two waves.
 * t = frames actually usable for the manoeuvre; from a standing start the ship
 * accelerates 0.5 px/frame^2 up to 6 px/frame (12 frames = 39 px), then cruises.
 */
export function maxGapShift(intervalFrames, lanePx) {
  const t = Math.floor(intervalFrames * 0.7);
  const reach = t <= 12 ? 0.25 * t * (t + 1) : 39 + (t - 12) * 6;
  return Math.max(1, Math.floor(reach / lanePx));
}

export const FORMATIONS = ['random', 'wallGap', 'stairs', 'zigzag', 'wedge', 'snake'];

/**
 * Pick the gap lane closest to `prevGap` that is not in `blocked` and lies within
 * `maxShift` lanes of it. If every candidate is blocked, free `prevGap` itself:
 * solvability matters more than the visual shape. Mutates `blocked`.
 */
export function nearestFree(prevGap, blocked, maxShift) {
  for (let d = 0; d <= maxShift; d++) {
    for (const c of d === 0 ? [prevGap] : [prevGap - d, prevGap + d]) {
      if (c < 0 || c > LANES - 1) continue;
      if (!blocked.has(c)) return c;
    }
  }
  blocked.delete(prevGap);
  return prevGap;
}

// Keep at most `maxEnemies` lanes, preferring the ones closest to the gap so the
// wall stays solid around the hole.
function trim(lanes, gap, maxEnemies) {
  const kept = lanes.filter((l) => l !== gap);
  if (kept.length <= maxEnemies) return kept.sort((a, b) => a - b);
  return kept
    .slice()
    .sort((a, b) => Math.abs(a - gap) - Math.abs(b - gap) || a - b)
    .slice(0, maxEnemies)
    .sort((a, b) => a - b);
}

export function createFormation(kind, rng, { maxShift, maxEnemies, startGap } = {}) {
  const shift = Math.max(1, maxShift ?? 1);
  const cap = Math.max(1, Math.min(4, maxEnemies ?? 4));
  let gap = clampLane(startGap ?? 2);

  // stairs: one lane per wave sweeping 0 -> 4 -> 0
  let stairLane = 0;
  let stairDir = 1;
  // snake: the gap walks one lane at a time, bouncing off the edges
  let snakeDir = 1;
  // zigzag / wedge cycle position
  let phase = 0;

  const drift = () => clampLane(gap + rng.int(-shift, shift));

  const fromSet = (set) => {
    const blocked = new Set(set);
    gap = nearestFree(gap, blocked, shift);
    return { lanes: trim([...blocked], gap, cap), gap };
  };

  function next() {
    switch (kind) {
      case 'random': {
        gap = drift();
        const rest = ALL.filter((l) => l !== gap);
        const count = cap >= 2 ? rng.int(2, cap) : 1;
        for (let i = rest.length - 1; i > 0; i--) {
          const j = rng.int(0, i);
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        return { lanes: rest.slice(0, count).sort((a, b) => a - b), gap };
      }
      case 'wallGap': {
        gap = drift();
        return { lanes: trim(ALL, gap, cap), gap };
      }
      case 'snake': {
        let nextGap = gap + snakeDir;
        if (nextGap < 0 || nextGap > LANES - 1) {
          snakeDir = -snakeDir;
          nextGap = gap + snakeDir;
        }
        gap = clampLane(nextGap);
        return { lanes: trim(ALL, gap, cap), gap };
      }
      case 'stairs': {
        const lane = stairLane;
        stairLane += stairDir;
        if (stairLane < 0 || stairLane > LANES - 1) {
          stairDir = -stairDir;
          stairLane = lane + stairDir;
        }
        // The gap goes as far from the enemy lane as `shift` allows.
        let best = null;
        for (let c = gap - shift; c <= gap + shift; c++) {
          if (c < 0 || c > LANES - 1 || c === lane) continue;
          if (best === null || Math.abs(c - lane) > Math.abs(best - lane)) best = c;
        }
        gap = best === null ? nearestFree(gap, new Set([lane]), shift) : best;
        return { lanes: trim([lane], gap, cap), gap };
      }
      case 'zigzag': {
        const set = phase % 2 === 0 ? [0, 2, 4] : [1, 3];
        phase++;
        return fromSet(set);
      }
      case 'wedge': {
        const set = [[2], [1, 3], [0, 4], [1, 3]][phase % 4];
        phase++;
        return fromSet(set);
      }
      default:
        throw new Error(`unknown formation: ${kind}`);
    }
  }

  return { next };
}
