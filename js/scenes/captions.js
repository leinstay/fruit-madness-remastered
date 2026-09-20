// Every word the 2013 game showed was live text in the embedded 04b03 face, not artwork:
// the buttons, the "Game Over" lettering, the three HUD capsule captions and the DANGER
// signs. This module draws them at runtime, so they stay sharp at any window size, and
// holds the positions that put each one exactly where the original render had it.
//
// Every offset is stated relative to its symbol's registration point — the same point
// drawSprite puts on (x, y) — so a caption is drawn at the very coordinates the sprite is.
// The numbers were measured from the 2013 renders of the symbols (named below as the files
// they were then) by fitting the ink profile of each caption, and are exact to about a
// tenth of a pixel. Those renders are reference material, not art the game ships.
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
export const DANGER_COLOR = '#ff0000';
export const DANGER_SIZE = 24;
export const DANGER_TEXT = '*******  DANGER  *******';

/**
 * The flash of the two DANGER strips is an alpha ramp on one static text, not a set of
 * drawn frames: eight steps of two ticks each, as the 2013 timeline holds them.
 */
const DANGER_RAMP = [255, 186, 127, 63, 0, 63, 127, 186].map((a) => a / 255);
const DANGER_RAMP_TICKS = 2;

export function dangerAlpha(tick) {
  const step = Math.floor((Number.isFinite(tick) ? tick : 0) / DANGER_RAMP_TICKS);
  return DANGER_RAMP[((step % DANGER_RAMP.length) + DANGER_RAMP.length) % DANGER_RAMP.length];
}

// measured from the 2013 render (dangerHz_0.png): the string starts 155.45 px left of the
// registration point on a baseline 6.02 px below it, and the whole field is stretched 4 %
// horizontally — a stretch that belongs to the sign, not to the font. The text is longer
// than the sign is wide, exactly as in the original, where the field clips it.
const DANGER_HZ = { dx: -155.45, dy: 6.02, scaleX: 1.0401 };

// measured from the 2013 render (dangerVt_0.png): one character per line, every glyph
// centred on the strip; the marks are set 14 px apart and the six letters 19 px.
const DANGER_VT = {
  centreX: 10.5,
  markTop: 18,
  markPitch: 14,
  marks: 5,
  textTop: 102,
  textPitch: 19,
  text: 'DANGER',
  tailTop: 230,
};

/** The vertical sign, character by character: what to draw and where its cap box starts. */
export function dangerVtGlyphs() {
  const out = [];
  for (let i = 0; i < DANGER_VT.marks; i++) out.push({ ch: '*', top: DANGER_VT.markTop + i * DANGER_VT.markPitch });
  for (let i = 0; i < DANGER_VT.text.length; i++) {
    out.push({ ch: DANGER_VT.text[i], top: DANGER_VT.textTop + i * DANGER_VT.textPitch });
  }
  for (let i = 0; i < DANGER_VT.marks; i++) out.push({ ch: '*', top: DANGER_VT.tailTop + i * DANGER_VT.markPitch });
  return out;
}

// measured from the 2013 render (dangerDiag.png): a 24 px "!" stretched to 1.73 x 1.65,
// as the original places it inside the red ring.
const DANGER_MARK = { dx: 1.13, dy: 11.79, scaleX: 1.7318, scaleY: 1.6534 };

/**
 * Draws one of the two DANGER strips so that the symbol's registration point lands on
 * (x, y), clipped to the symbol's own box just as the original text field clips it.
 * `size` and `anchor` come from the manifest, so nothing here hardcodes a sprite box.
 */
export function drawDangerStrip(ctx, name, size, anchor, x, y, alpha = 1) {
  if (!size || !anchor || alpha <= 0) return;
  const left = x - anchor[0];
  const top = y - anchor[1];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.rect(left, top, size[0], size[1]);
  ctx.clip();
  if (name === 'dangerVt') {
    const cx = left + DANGER_VT.centreX + DANGER_SIZE * INK_CENTRE_SHIFT;
    for (const glyph of dangerVtGlyphs()) {
      drawText(ctx, glyph.ch, cx, top + glyph.top + DANGER_SIZE * CAP_HEIGHT_RATIO, {
        size: DANGER_SIZE, align: 'center', color: DANGER_COLOR,
      });
    }
  } else {
    ctx.translate(left, top);
    ctx.scale(DANGER_HZ.scaleX, 1);
    drawText(ctx, DANGER_TEXT, (anchor[0] + DANGER_HZ.dx) / DANGER_HZ.scaleX, anchor[1] + DANGER_HZ.dy, {
      size: DANGER_SIZE, color: DANGER_COLOR,
    });
  }
  ctx.restore();
}

/** The "!" inside the diagonal sign's red ring. */
export function drawDangerMark(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(DANGER_MARK.scaleX, DANGER_MARK.scaleY);
  drawText(ctx, '!', DANGER_MARK.dx / DANGER_MARK.scaleX, DANGER_MARK.dy / DANGER_MARK.scaleY, {
    size: DANGER_SIZE, color: DANGER_COLOR,
  });
  ctx.restore();
}
