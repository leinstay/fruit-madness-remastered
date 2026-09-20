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
/**
 * The corner signs: the same run, shorter, split over the two arms of an L — and set off
 * with the very same two spaces, so the gap between the word and the marks is the strip's.
 */
export const DANGER_CORNER_TEXT = '****  DANGER  ****';

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
 * Where every sign sits on the 600 x 450 field — the one table of positions. `side` holds
 * the centre line of each straight strip: the left and right strips are columns, the top
 * and bottom ones rows. They are symmetric about the centre of the field left to right,
 * and they keep clear of the HUD capsules along the top and of the two buttons along the
 * bottom — which is why the top and bottom rows are not a mirror pair, the two bands they
 * dodge are not either.
 *
 * There is no separate table for the corner signs: an L simply sits on the crossing of two
 * of those lines (`dangerElbow`), so its arms lie exactly where the strips' lettering does.
 */
export const DANGER_LAYOUT = {
  side: {
    left: { x: 20, y: 225 },
    right: { x: 580, y: 225 },
    top: { x: 300, y: 72 },
    bottom: { x: 300, y: 390 },
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
  // The elbow of a corner sign is left empty: this is how far from it the *ink* of the
  // first glyph starts, the same distance along both arms.
  cornerInset: 19,
};

// Which strip lines cross at each elbow: a column and a row.
const ELBOW_SIDES = { tl: ['left', 'top'], tr: ['right', 'top'], bl: ['left', 'bottom'], br: ['right', 'bottom'] };

/** Where the two arms of a corner sign meet: the crossing of its two strip lines. */
export function dangerElbow(corner) {
  const pair = ELBOW_SIDES[corner];
  if (!pair) return null;
  return { x: DANGER_LAYOUT.side[pair[0]].x, y: DANGER_LAYOUT.side[pair[1]].y };
}

/**
 * The widest advance this face has at this size (0.625 em; the marks and most letters are
 * that or narrower). Used only to bound what a sign can cover — for clearances and for the
 * tests — never to place a glyph: horizontal layout stays the font's job.
 */
export const DANGER_MAX_ADVANCE = DANGER_SIZE * 0.625;

/** The left/right strip's own run: five marks, the word, five marks, one glyph a line. */
const STACK_TEXT = '*****  DANGER  *****';

/**
 * One stacked run, glyph by glyph: the centre of each cap box, walking out from `first` in
 * the direction `away`. Letters sit `letterPitch` apart, marks `markPitch`, and the spaces
 * between them become the one `stackGap` that sets the word off. Every stacked lettering in
 * the game — the two side strips and the stacked arm of every corner sign — comes from
 * here, so they cannot drift apart.
 */
function stackedRun(chars, first, away) {
  const { letterPitch, markPitch, stackGap } = DANGER_LAYOUT;
  const out = [];
  let d = 0;
  let prev = null;
  let afterGap = false;
  for (const ch of chars) {
    if (ch === ' ') { afterGap = true; continue; }
    if (prev !== null) {
      if (afterGap) d += stackGap;
      else d += (ch === '*' && prev === '*') ? markPitch : letterPitch;
    }
    out.push({ ch, y: first + away * d });
    prev = ch;
    afterGap = false;
  }
  return out;
}

/**
 * The stacked strip of the left or the right side, character by character: what to draw
 * and the centre of its cap box. Centred on the middle of the field.
 */
export function dangerStackGlyphs(side) {
  const at = DANGER_LAYOUT.side[side];
  if (!at) return [];
  const run = stackedRun(STACK_TEXT, 0, 1);
  const span = run[run.length - 1].y - run[0].y;
  return run.map(({ ch, y }) => ({ ch, x: at.x, y: at.y - span / 2 + y }));
}

/** The box the top or the bottom strip is clipped to, centred on the field's axis. */
export function dangerBarBox(side) {
  const at = DANGER_LAYOUT.side[side];
  if (!at) return null;
  const { barWidth, barHeight } = DANGER_LAYOUT;
  return { x: at.x - barWidth / 2, y: at.y - barHeight / 2, w: barWidth, h: barHeight };
}

/**
 * The L-shaped sign of a corner attack: `****  DAN` on the arm that runs into the elbow and
 * `GER  ****` on the arm that leaves it, in that order, so the word reads **through** the
 * elbow. At a left elbow the word arrives along the vertical arm and leaves along the
 * horizontal one; at a right elbow it is the other way round, because a horizontal arm
 * always reads left to right.
 *
 * Each arm sits on the line of the strip it runs along and is typeset exactly like it: the
 * `stack` arm glyph-per-line through `stackedRun`, the `line` arm as one string the font
 * lays out itself, stretched by the strips' own `barScaleX`. Both start one `cornerInset`
 * of ink from the elbow, so the elbow stays empty and the arms never meet.
 */
export function dangerCornerArms(corner) {
  const at = dangerElbow(corner);
  if (!at) return null;
  const half = DANGER_CORNER_TEXT.length / 2;
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';
  const awayX = left ? 1 : -1;                          // towards the middle of the side
  const awayY = top ? 1 : -1;
  const { cornerInset, barScaleX } = DANGER_LAYOUT;

  const arm = (text, intoElbow) => {
    // The stacked arm is the vertical one: into the elbow at a left sign, out of it at a
    // right sign, which is what keeps every horizontal arm reading left to right.
    const stacked = intoElbow === left;
    if (!stacked) {
      return {
        kind: 'line', text, y: at.y, size: DANGER_SIZE, scaleX: barScaleX,
        x: at.x + awayX * cornerInset,
        align: awayX > 0 ? 'left' : 'right',
      };
    }
    const outward = intoElbow ? [...text].reverse().join('') : text;
    // A stacked glyph is centred on its cap box, so its ink starts half a cap box earlier:
    // the first one is pushed out by that much and both arms begin on the same ink line.
    const first = at.y + awayY * (cornerInset + CAP / 2);
    const glyphs = stackedRun(outward, first, awayY).map(({ ch, y }) => ({ ch, x: at.x, y }));
    // Listed in reading order: an arm that runs into the elbow is read from its far end.
    return { kind: 'stack', text, glyphs: intoElbow ? glyphs.reverse() : glyphs };
  };

  return {
    point: { x: at.x, y: at.y },
    arms: [arm(DANGER_CORNER_TEXT.slice(0, half), true), arm(DANGER_CORNER_TEXT.slice(half), false)],
  };
}

/** The box one glyph can cover, centred on its cell. */
const glyphBox = (g) => ({
  x: g.x - DANGER_MAX_ADVANCE / 2, y: g.y - CAP / 2, w: DANGER_MAX_ADVANCE, h: CAP,
});

/** The box a drawn line can cover: the font sets it no wider than this, stretch included. */
function lineBox(arm) {
  const w = arm.text.length * DANGER_MAX_ADVANCE * (arm.scaleX || 1);
  return { x: arm.align === 'right' ? arm.x - w : arm.x, y: arm.y - CAP / 2, w, h: CAP };
}

/**
 * Everything a sign can cover, as boxes on the field. Deliberately generous — a drawn
 * string is measured as if every glyph were the widest one — so a clearance that holds
 * here holds on screen.
 */
export function dangerBoxes(warning) {
  if (!warning) return [];
  if (warning.kind === 'corner') {
    const sign = dangerCornerArms(warning.corner);
    if (!sign) return [];
    return sign.arms.flatMap((a) => (a.kind === 'stack' ? a.glyphs.map(glyphBox) : [lineBox(a)]));
  }
  if (warning.side === 'left' || warning.side === 'right') {
    return dangerStackGlyphs(warning.side).map(glyphBox);
  }
  const at = DANGER_LAYOUT.side[warning.side];
  const box = dangerBarBox(warning.side);
  if (!at || !box) return [];
  // The lettering is wider than the sign and is clipped to it, so the sign's own box is
  // the bound; vertically it is the cap band the strip is centred on.
  return [{ x: box.x, y: at.y - CAP / 2, w: box.w, h: CAP }];
}

/** One glyph of a sign, centred on its cell: the ink, not the advance box. */
function drawDangerGlyph(ctx, ch, x, y) {
  if (ch === ' ') return;
  drawText(ctx, ch, x + DANGER_SIZE * INK_CENTRE_SHIFT, baselineFor(y), {
    size: DANGER_SIZE, align: 'center', color: DANGER_COLOR,
  });
}

/**
 * One line of a corner sign, laid out and stretched exactly as the strip whose row it sits
 * on: same size, same `barScaleX`, same baseline, so its marks land on the strip's own
 * rows and columns. A right-aligned line is nudged by the trailing 1/8 em of spacing every
 * glyph of this face carries, so that its ink, not its advance box, ends on the anchor.
 */
function drawDangerLine(ctx, arm) {
  const s = arm.scaleX || 1;
  const dx = arm.align === 'right' ? DANGER_SIZE * INK_CENTRE_SHIFT * 2 : 0;
  ctx.save();
  ctx.scale(s, 1);
  drawText(ctx, arm.text, arm.x / s + dx, baselineFor(arm.y), {
    size: arm.size || DANGER_SIZE, align: arm.align, color: DANGER_COLOR,
  });
  ctx.restore();
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
    const sign = dangerCornerArms(warning.corner);
    for (const arm of sign ? sign.arms : []) {
      if (arm.kind === 'stack') for (const g of arm.glyphs) drawDangerGlyph(ctx, g.ch, g.x, g.y);
      else drawDangerLine(ctx, arm);
    }
  } else if (warning.side === 'left' || warning.side === 'right') {
    for (const g of dangerStackGlyphs(warning.side)) drawDangerGlyph(ctx, g.ch, g.x, g.y);
  } else {
    drawDangerBar(ctx, warning.side);
  }
  ctx.restore();
}
