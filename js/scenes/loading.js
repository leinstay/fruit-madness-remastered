// The loading screen: the word LOADING and a segmented bar, in the game's own font on the
// game's own background. It stands over both waits a cold start has — the sprite frames and
// then the title artwork — and js/main.js paints it before it awaits anything at all, so the
// first frame the browser shows is already this and never an empty canvas.
//
// The caller fills the background: js/main.js owns BG_COLOR and the menu has it as
// `app.bgColor`, so it is never spelled out a second time here.
//
// The pixel font may still be on its way during the first phase; drawText falls back to
// monospace and both the word and the bar are centred on the field, so the swap moves
// nothing but the width of the word itself.
import { W, H } from '../config.js';
import { drawText } from '../core/text.js';
import { BAR_CELLS, filledCells } from '../core/loading.js';

const WORD = 'LOADING';
const WORD_SIZE = 30;
const WORD_Y = H / 2 - 20;

// The bar: whole cells, whole pixels, centred on the field.
const CELL_W = 12;
const CELL_H = 12;
const CELL_GAP = 2;
const BAR_W = BAR_CELLS * CELL_W + (BAR_CELLS - 1) * CELL_GAP;
const BAR_X = Math.round((W - BAR_W) / 2);
const BAR_Y = Math.round(H / 2 + 10);

const FILLED = '#ffffff';
const EMPTY = 'rgba(255, 255, 255, 0.14)';
const CURSOR = 'rgba(255, 255, 255, 0.55)';

/**
 * How long one half of the cursor's blink lasts. The cell just past the full ones blinks so
 * that the screen is visibly alive while the title is being prepared — a phase with nothing
 * to count. It marks where the bar stands; it never moves on its own.
 */
export const BLINK_MS = 250;

/** Whether the cursor cell is lit at `time` (a millisecond clock, any origin). */
export function cursorLit(time) {
  const t = Number(time);
  return Math.floor((Number.isFinite(t) ? t : 0) / BLINK_MS) % 2 === 0;
}

/** Draws the screen at `progress` (0..1). `time` is only ever used for the blink. */
export function drawLoading(ctx, { progress = 0, time = 0 } = {}) {
  drawText(ctx, WORD, W / 2, WORD_Y, { size: WORD_SIZE, align: 'center', valign: 'center' });
  const filled = filledCells(progress);
  const cursor = cursorLit(time) ? filled : -1;
  ctx.save();
  for (let i = 0; i < BAR_CELLS; i += 1) {
    ctx.fillStyle = i < filled ? FILLED : (i === cursor ? CURSOR : EMPTY);
    ctx.fillRect(BAR_X + i * (CELL_W + CELL_GAP), BAR_Y, CELL_W, CELL_H);
  }
  ctx.restore();
}
