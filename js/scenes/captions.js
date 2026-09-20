// Every word the 2013 game showed was live text in the embedded 04b03 face, not artwork:
// the buttons, the "Game Over" lettering, the three HUD capsule captions and the DANGER
// signs. This module draws them at runtime, so they stay sharp at any window size, and
// holds the positions that put each one exactly where the original render had it.
//
// A caption that belongs to a symbol states its offset relative to that symbol's
// registration point — the same point drawSprite puts on (x, y) — so it is drawn at the
// very coordinates the sprite is. Those numbers were measured from the 2013 renders by
// fitting the ink profile of each caption and are exact to about a tenth of a pixel; the
// renders are reference material, not art the game ships. The DANGER signs have no symbol
// left at all: they are laid out on the field itself, from the table below.
import { drawText, CAP_HEIGHT_RATIO } from '../core/text.js';

/**
 * Canvas centres the advance box of a string, while the original centred its ink. Every
 * glyph of this face carries its 1/8 em of spacing on the right, so the ink sits half of
 * that to the left of the advance box: adding it back centres the ink itself.
 */
const INK_CENTRE_SHIFT = 1 / 16;

// --- The three buttons ----------------------------------------------------------------
// measured from the 2013 render: START at 40 px, PAUSE and MENU at 30 px, white.
const BUTTONS = {
  btnStart: { text: 'START', size: 40, dx: -54.95, dy: 9.75 },
  btnPause: { text: 'PAUSE', size: 30, dx: -42.50, dy: 8.05 },
  btnMenu: { text: 'MENU', size: 30, dx: -34.95, dy: 8.00 },
};

/** The caption of one of the three button symbols, drawn on the symbol's own position. */
export function drawButtonCaption(ctx, name, x, y, color = '#fff') {
  const b = BUTTONS[name];
  if (!b) return;
  drawText(ctx, b.text, x + b.dx, y + b.dy, { size: b.size, color });
}

/** The size of a button symbol, for the scenes that lay one out by hand. */
export const buttonCaptionSize = (name) => (BUTTONS[name] ? BUTTONS[name].size : 0);

// --- The HUD capsules -----------------------------------------------------------------
// measured from the 2013 render: 11 px white, set 0.845 as wide as the face's own advances
// (the original text field is squeezed horizontally; the glyphs keep their full height).
const CAPSULE_SIZE = 11;
const CAPSULE_SCALE_X = 0.845;
const CAPSULES = {
  fuelBar: { text: 'sugar fuel', dx: -23.95, dy: -19.62 },
  scoreBar: { text: 'adventure score', dx: -40.15, dy: -19.70 },
  comboBar: { text: 'combo bar', dx: -23.24, dy: -19.90 },
};

/** The small caption above the ring of one of the three HUD capsules. */
export function drawCapsuleCaption(ctx, name, x, y, color = '#fff') {
  const c = CAPSULES[name];
  if (!c) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(CAPSULE_SCALE_X, 1);
  drawText(ctx, c.text, c.dx / CAPSULE_SCALE_X, c.dy, { size: CAPSULE_SIZE, color });
  ctx.restore();
}

// --- Game Over ------------------------------------------------------------------------
// measured from the 2013 render: 60 px white, over the two black letterbox bars the
// `gameOver` symbol still supplies.
const GAME_OVER = { text: 'Game Over', size: 60, dx: -162.60, dy: -43.00 };

export function drawGameOverTitle(ctx, x, y, color = '#fff') {
  drawText(ctx, GAME_OVER.text, x + GAME_OVER.dx, y + GAME_OVER.dy, { size: GAME_OVER.size, color });
}

// --- The DANGER signs -----------------------------------------------------------------
// A warning is the descriptor the director publishes — `{kind: 'side', side}` or
// `{kind: 'corner', corner}` — and the scene decides everything else: a straight strip
// along the side an attack comes from, or an L-shaped sign wrapped around its corner.
export const DANGER_COLOR = '#ff0000';
export const DANGER_SIZE = 24;
/** The straight strips: the 2013 lettering, marks and word in one line. */
export const DANGER_TEXT = '*******  DANGER  *******';
/** The corner signs: eight glyphs an arm, read through the corner. */
export const DANGER_CORNER_TEXT = '**** DANGER ****';

/** One glyph's cap box — the band every sign is laid out on. */
const CAP = DANGER_SIZE * CAP_HEIGHT_RATIO;
/** The baseline that puts that cap box on the centre line `y`. */
const baselineFor = (y) => y + CAP / 2;

/**
 * The sign fades instead of flashing: one cosine cycle of 100 frames, so three of them
 * fit into the 300-frame warning phase and each starts fully lit on its own frame 0.
 * Never fully out — the dimmest the lettering gets is a tenth.
 */
export const DANGER_FADE_PERIOD = 100;
export function dangerAlpha(age) {
  const t = Number.isFinite(age) ? age : 0;
  return 0.55 + 0.45 * Math.cos((2 * Math.PI * t) / DANGER_FADE_PERIOD);
}

/**
 * Where every sign sits on the 600 x 450 field — the one table of positions.
 * `side` holds the centre of a straight strip, `corner` the point the two arms of an L
 * meet at; both are symmetric about the centre of the field, and both keep clear of the
 * HUD capsules along the top and of the two buttons along the bottom.
 */
export const DANGER_LAYOUT = {
  side: {
    left: { x: 20, y: 225 },
    right: { x: 580, y: 225 },
    top: { x: 300, y: 72 },
    bottom: { x: 300, y: 390 },
  },
  corner: {
    tl: { x: 45, y: 85 },
    tr: { x: 555, y: 85 },
    bl: { x: 45, y: 365 },
    br: { x: 555, y: 365 },
  },
  // The stacked strips, measured from the 2013 render: one character a line, the marks
  // 14 px apart and the six letters 19 px, with the word set off from the marks. The
  // original's two gaps differed by 5 px; here they are one value, so the strip is
  // symmetric about its own middle.
  markPitch: 14,
  letterPitch: 19,
  stackGap: 30.5,
  // The horizontal strips keep the 2013 box and its 4 % stretch: the lettering is wider
  // than the sign, which clips it to six visible marks a side.
  barWidth: 288.90,
  barHeight: 31.75,
  barScaleX: 1.0401,
  // The corner signs are new, so nothing is stretched and both arms share one pitch —
  // the only way an L of proportional glyphs reads as even on both arms.
  armPitch: 15,
};

const STACK_TEXT = 'DANGER';
const STACK_MARKS = 5;

/**
 * The stacked strip of the left or the right side, character by character: what to draw
 * and the centre of its cap box. Centred on the middle of the field.
 */
export function dangerStackGlyphs(side) {
  const at = DANGER_LAYOUT.side[side];
  if (!at) return [];
  const { markPitch, letterPitch, stackGap } = DANGER_LAYOUT;
  const half = (STACK_TEXT.length - 1) / 2;
  const letterY = (i) => at.y + (i - half) * letterPitch;
  const first = letterY(0);
  const last = letterY(STACK_TEXT.length - 1);
  const out = [];
  for (let k = STACK_MARKS; k >= 1; k--) out.push({ ch: '*', x: at.x, y: first - stackGap - (k - 1) * markPitch });
  for (let i = 0; i < STACK_TEXT.length; i++) out.push({ ch: STACK_TEXT[i], x: at.x, y: letterY(i) });
  for (let k = 1; k <= STACK_MARKS; k++) out.push({ ch: '*', x: at.x, y: last + stackGap + (k - 1) * markPitch });
  return out;
}

/** The box the top or the bottom strip is clipped to, centred on the field's axis. */
export function dangerBarBox(side) {
  const at = DANGER_LAYOUT.side[side];
  if (!at) return null;
  const { barWidth, barHeight } = DANGER_LAYOUT;
  return { x: at.x - barWidth / 2, y: at.y - barHeight / 2, w: barWidth, h: barHeight };
}

/**
 * The L-shaped sign of a corner attack, in reading order: `**** DAN` on the arm that runs
 * into the corner and `GER ****` on the arm that leaves it, so the word reads through the
 * corner itself. At a left corner the word arrives along the vertical arm and leaves along
 * the horizontal one; at a right corner it is the other way round, because a horizontal arm
 * always reads left to right. The corner cell stays empty, so the arms never collide.
 */
export function dangerCornerGlyphs(corner) {
  const at = DANGER_LAYOUT.corner[corner];
  if (!at) return [];
  const pitch = DANGER_LAYOUT.armPitch;
  const arm = DANGER_CORNER_TEXT.length / 2;            // eight cells an arm
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  const awayX = left ? 1 : -1;                          // towards the middle of the side
  const awayY = top ? 1 : -1;
  const cell = (vertical, distance) => (vertical
    ? { x: at.x, y: at.y + awayY * distance }
    : { x: at.x + awayX * distance, y: at.y });
  const out = [];
  // The arm reading into the corner: its last glyph, the N, is the cell next to it.
  for (let i = 0; i < arm; i++) {
    out.push({ ch: DANGER_CORNER_TEXT[i], ...cell(left, (arm - i) * pitch) });
  }
  // And the arm leaving it, starting one cell out on the other side of the corner.
  for (let i = 0; i < arm; i++) {
    out.push({ ch: DANGER_CORNER_TEXT[arm + i], ...cell(!left, (i + 1) * pitch) });
  }
  return out;
}

/** One glyph of a sign, centred on its cell: the ink, not the advance box. */
function drawDangerGlyph(ctx, ch, x, y) {
  if (ch === ' ') return;
  drawText(ctx, ch, x + DANGER_SIZE * INK_CENTRE_SHIFT, baselineFor(y), {
    size: DANGER_SIZE, align: 'center', color: DANGER_COLOR,
  });
}

/** The straight strip of the top or the bottom side, stretched and clipped as in 2013. */
function drawDangerBar(ctx, side) {
  const at = DANGER_LAYOUT.side[side];
  const box = dangerBarBox(side);
  if (!at || !box) return;
  const { barScaleX } = DANGER_LAYOUT;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.scale(barScaleX, 1);
  drawText(ctx, DANGER_TEXT, (at.x + DANGER_SIZE * INK_CENTRE_SHIFT) / barScaleX, baselineFor(at.y), {
    size: DANGER_SIZE, align: 'center', color: DANGER_COLOR,
  });
  ctx.restore();
}

/**
 * Draws one DANGER sign for the descriptor the world published, at the given opacity.
 * Everything is runtime text: there is no sign artwork any more.
 */
export function drawDangerSign(ctx, warning, alpha = 1) {
  if (!warning || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  if (warning.kind === 'corner') {
    for (const g of dangerCornerGlyphs(warning.corner)) drawDangerGlyph(ctx, g.ch, g.x, g.y);
  } else if (warning.side === 'left' || warning.side === 'right') {
    for (const g of dangerStackGlyphs(warning.side)) drawDangerGlyph(ctx, g.ch, g.x, g.y);
  } else {
    drawDangerBar(ctx, warning.side);
  }
  ctx.restore();
}
