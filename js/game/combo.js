// js/game/combo.js — four muffin cells; each filled cell raises the score multiplier,
// a full bar pays a flat bonus for every further muffin, and missing one resets it.
import { COMBO } from '../config.js';

export const createCombo = () => ({ cells: 0 });

/** Returns the bonus score this pickup pays (0 while the bar is still filling). */
export function comboCollect(c) {
  if (c.cells >= COMBO.CELLS) return COMBO.FULL_BONUS;
  c.cells += 1;
  return 0;
}

export function comboMiss(c) {
  c.cells = 0;
}

export const comboMultiplier = (c) => 1 + c.cells;
