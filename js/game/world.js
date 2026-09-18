// js/game/world.js — everything that is not the player: the director, the live enemies
// and the live muffins. The world owns a single rng created from the seed and never reads
// the player, so a whole run can be replayed offline (see tests/helpers/solver.js).
import { SUGAR } from '../config.js';
import { createRng } from '../core/rng.js';
import { createDirector, stepDirector } from './director.js';
import { stepEnemy, isOffscreen } from './modes.js';
import { spawnSugarWave, stepSugars } from './sugar.js';

export function createWorld(seed, { startShift = 0 } = {}) {
  const rng = createRng(seed);
  return {
    frame: 0,
    rng,
    director: createDirector(rng, { startShift }),
    enemies: [],
    sugars: [],
    telegraphs: [],
    warnings: [],
  };
}

/** True while the muffin shower event is running — it supplies the muffins itself. */
function inMuffinShower(d) {
  return d.phase === 'attack' && d.plan.type === 'event' && d.plan.event === 'muffinShower';
}

/** Advance one 60 Hz frame. Returns how many muffins left the field uncollected. */
export function stepWorld(w) {
  w.frame += 1;

  const spawned = stepDirector(w.director);
  w.enemies.push(...spawned.enemies);
  w.sugars.push(...spawned.sugars);
  w.telegraphs = spawned.telegraphs;
  w.warnings = w.director.warnings;

  if (w.frame % SUGAR.INTERVAL === 0 && !inMuffinShower(w.director)) {
    w.sugars.push(...spawnSugarWave(w.rng));
  }

  for (let i = w.enemies.length - 1; i >= 0; i--) {
    const e = w.enemies[i];
    stepEnemy(e);
    if (isOffscreen(e)) w.enemies.splice(i, 1);
  }

  return { missedSugars: stepSugars(w.sugars) };
}
