// js/game/combo.js — four muffin cells that raise the score multiplier and burn down on
// their own. Only the rightmost lit cell drains; it lives COMBO.CELL_FRAMES frames, then
// goes out and hands a full timer to the cell on its left. Any muffin refills that timer
// and, while there is room, lights one more cell. Missing a muffin costs nothing.
import { COMBO } from '../config.js';

export const createCombo = () => ({ cells: 0, timer: 0 });

export const comboMultiplier = (c) => 1 + c.cells;

/** Lights a cell when there is room and always refills the timer. Returns the points earned. */
export function comboCollect(c) {
  if (c.cells < COMBO.CELLS) c.cells += 1;
  c.timer = COMBO.CELL_FRAMES;
  return COMBO.MUFFIN_POINTS * comboMultiplier(c);
}

/** One game frame of decay. A no-op while the bar is empty. */
export function stepCombo(c) {
  if (c.cells <= 0) { c.timer = 0; return; }
  c.timer -= 1;
  if (c.timer > 0) return;
  c.cells -= 1;
  c.timer = c.cells > 0 ? COMBO.CELL_FRAMES : 0;
}

/** How much of the rightmost lit cell is left, 1 = fresh … 0 = gone (0 with no cells). */
export function comboDrain(c) {
  if (c.cells <= 0) return 0;
  return Math.max(0, Math.min(1, c.timer / COMBO.CELL_FRAMES));
}

/**
 * The split line of a draining cell drawn as a vertical timer: rows at or below the
 * returned y are lit, everything above it is dimmed. Rounded to whole logical pixels so
 * the edge does not shimmer between frames.
 */
export function drainSplitY(top, height, drain) {
  const left = Math.max(0, Math.min(1, drain));
  return Math.round(top) + Math.round(Math.round(height) * (1 - left));
}
