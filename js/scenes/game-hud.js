// HUD and overlay drawing for the game scene: the three capsules along the top, the
// PAUSE/MENU buttons along the bottom and the DANGER signs.
// Kept out of game.js so that scene stays about the game loop.
import { W, H, FUEL, COMBO, SCORE_MAX } from '../config.js';
import { drawSprite } from '../core/assets.js';
import { deviceScale, snapToDevice } from '../core/canvas.js';
import { frameAt } from '../core/anim.js';
import { drawText } from '../core/text.js';
import { comboDrain, drainSplitY } from '../game/combo.js';
import {
  drawButtonCaption, drawCapsuleCaption, drawDangerStrip, drawDangerMark, dangerAlpha,
} from './captions.js';
import { expandRect, MIN_TOUCH_SIZE } from './ui.js';

// Positions of the original HUD (GameLoop.as); all three capsules sit on the same row.
export const FUEL_BAR = { x: 57, y: 32 };
export const SCORE_BAR = { x: 300, y: 32 };
export const COMBO_BAR = { x: 543, y: 32 };
export const BTN_PAUSE = { x: 57, y: 425 };
export const BTN_MENU = { x: 546, y: 425 };

const BLINK_TICKS = 15;                 // 2 Hz at 60 fps: 15 on, 15 off

/** True on the "lit" half of a 2 Hz blink. */
export const blinkOn = (frame) => Math.floor(frame / BLINK_TICKS) % 2 === 0;

/**
 * The on-screen rectangle a sprite would occupy when drawn at (x, y). The size comes from
 * `assets.size`, never from the image: a vector frame is cached at the device resolution
 * and its `<img>` reports a rounded viewport, neither of which is the logical size.
 */
export function spriteRect(assets, name, x, y) {
  const wh = assets && assets.size ? assets.size(name) : null;
  if (!wh) return { x, y, w: 0, h: 0 };
  const a = assets.anchor(name) || [wh[0] / 2, wh[1] / 2];
  return { x: x - a[0], y: y - a[1], w: wh[0], h: wh[1] };
}

export const rectHit = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/**
 * The tap target of one of the two HUD buttons: the sprite rectangle grown to the minimum
 * comfortable finger size. The same rectangle is handed to the touch joystick as an
 * exclusion, so a thumb on PAUSE always presses PAUSE and never starts steering.
 */
export function buttonRect(assets, name, pos) {
  return expandRect(spriteRect(assets, name, pos.x, pos.y), MIN_TOUCH_SIZE, MIN_TOUCH_SIZE);
}

/** Blits one frame of a sprite scaled about its own registration point. */
function drawScaled(ctx, assets, name, index, x, y, scaleX, scaleY = scaleX) {
  const f = assets.frame ? assets.frame(name, index) : null;
  if (!f || scaleX <= 0 || scaleY <= 0) return;
  const a = f.anchor || [f.w / 2, f.h / 2];
  const s = deviceScale(ctx);
  ctx.save();
  ctx.imageSmoothingEnabled = f.smooth;
  ctx.drawImage(
    f.source,
    snapToDevice(x - a[0] * scaleX, s), snapToDevice(y - a[1] * scaleY, s),
    f.w * scaleX, f.h * scaleY,
  );
  ctx.restore();
}

function drawFuel(ctx, assets, fuelValue) {
  drawSprite(ctx, assets, 'fuelBar', 0, FUEL_BAR.x, FUEL_BAR.y);
  drawCapsuleCaption(ctx, 'fuelBar', FUEL_BAR.x, FUEL_BAR.y);
  const ratio = Math.max(0, Math.min(1, fuelValue / FUEL.MAX));
  if (assets.has('fuelFill')) {
    // As in the 2013 original (`fuelCount.scaleX = fuel / 100`), the fill shrinks about its
    // registration point, so the capsule contracts towards the middle of the bar.
    drawScaled(ctx, assets, 'fuelFill', 0, FUEL_BAR.x, FUEL_BAR.y, ratio, 1);
  } else {
    const w = Math.round(100 * ratio);
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(FUEL_BAR.x - w / 2), FUEL_BAR.y - 15, w, 30);
  }
}

// The digits belong on the inner centre of the capsule ring, not of the whole sprite:
// scoreBar.png is 103x48 and carries the small "adventure score" caption on rows 3-9.
// Measured from the PNG: the white ring spans rows 14..46 and its opening rows 17..43, so
// the inner centre lies on the middle of row 30 — half a pixel below the manifest anchor
// [51.5, 30]. comboBar.png is the very same capsule (identical rows), while fuelBar.png is
// one row shorter (ring 14..45, opening 16..43) and centres on the anchor itself.
const SCORE_TEXT_DY = 0.5;

function drawScore(ctx, assets, score) {
  drawSprite(ctx, assets, 'scoreBar', 0, SCORE_BAR.x, SCORE_BAR.y);
  drawCapsuleCaption(ctx, 'scoreBar', SCORE_BAR.x, SCORE_BAR.y);
  const shown = Math.min(SCORE_MAX, Math.max(0, Math.floor(score)));
  drawText(ctx, String(shown).padStart(7, '0'), SCORE_BAR.x, SCORE_BAR.y + SCORE_TEXT_DY, {
    size: 16, align: 'center', color: '#fff', valign: 'center',
  });
}

// The combo capsule: the same capsule shape as the fuel and score bars, with four muffin
// icons inside it. A filled cell is drawn solid, an empty one dimmed. The rightmost filled
// cell is the running timer: it burns down from the top, so it fades into an empty cell
// just as it goes out. The icon is the `muffin` sprite at half size, which is exactly what
// the original cell art was cut down from.
const COMBO_CELL_PITCH = 21;
const COMBO_CELL_SCALE = 0.5;
const COMBO_DIM_ALPHA = 0.22;

/** The rectangle one combo cell covers, from the muffin's own logical size. */
function cellRect(assets, x) {
  const wh = assets.size ? assets.size('muffin') : null;
  if (!wh) return { x, y: COMBO_BAR.y, w: 0, h: 0 };
  const a = assets.anchor('muffin') || [wh[0] / 2, wh[1] / 2];
  return {
    x: x - a[0] * COMBO_CELL_SCALE,
    y: COMBO_BAR.y - a[1] * COMBO_CELL_SCALE,
    w: wh[0] * COMBO_CELL_SCALE,
    h: wh[1] * COMBO_CELL_SCALE,
  };
}

const drawCell = (ctx, assets, x) =>
  drawScaled(ctx, assets, 'muffin', 0, x, COMBO_BAR.y, COMBO_CELL_SCALE);

/** Draws the muffin icon clipped to the rows [top, top + height) of its own rectangle. */
function drawCellBand(ctx, assets, x, rect, top, height, alpha) {
  if (height <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, top, rect.w, height);
  ctx.clip();
  ctx.globalAlpha = alpha;
  drawCell(ctx, assets, x);
  ctx.restore();
}

function drawCombo(ctx, assets, combo) {
  // The 2013 combo symbol has its four muffins and its "not working yet :(" line baked in,
  // so the capsule is the score bar's — they are the same shape — and the caption is drawn.
  drawSprite(ctx, assets, 'scoreBar', 0, COMBO_BAR.x, COMBO_BAR.y);
  drawCapsuleCaption(ctx, 'comboBar', COMBO_BAR.x, COMBO_BAR.y);
  const x0 = COMBO_BAR.x - ((COMBO.CELLS - 1) * COMBO_CELL_PITCH) / 2;
  for (let i = 0; i < COMBO.CELLS; i++) {
    const x = x0 + i * COMBO_CELL_PITCH;
    const filled = i < combo.cells;
    if (filled && i === combo.cells - 1) {
      // The draining cell: lit below the split line, dimmed above it.
      const rect = cellRect(assets, x);
      const split = drainSplitY(rect.y, rect.h, comboDrain(combo));
      drawCellBand(ctx, assets, x, rect, rect.y, split - rect.y, COMBO_DIM_ALPHA);
      drawCellBand(ctx, assets, x, rect, split, rect.y + rect.h - split, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = filled ? 1 : COMBO_DIM_ALPHA;
    drawCell(ctx, assets, x);
    ctx.restore();
  }
}

/**
 * The live contents of the field — the muffins and the enemies — without the player, the
 * HUD or the buttons. Shared by the game scene and by the game-over screen, which keeps
 * the same world stepping and drawing behind its UI, as the original does.
 * An enemy whose sprite is somehow absent from the manifest still falls back to the
 * cherry rather than vanishing.
 */
export function drawWorldSprites(ctx, assets, world) {
  const muffinFrame = frameAt(assets.timing('muffin'), assets.frameCount('muffin'), world.frame);
  for (const s of world.sugars) drawSprite(ctx, assets, 'muffin', muffinFrame, s.x, s.y);
  for (const e of world.enemies) {
    const name = assets.has(e.sprite) ? e.sprite : 'cherry';
    if (!assets.has(name)) continue;
    // The per-enemy animOffset was drawn from the world's rng at spawn time, so the wave
    // does not animate in lockstep and drawing consumes no randomness of its own.
    const f = frameAt(assets.timing(name), assets.frameCount(name), world.frame + (e.animOffset | 0));
    drawSprite(ctx, assets, name, f, e.x, e.y);
  }
}

export function drawHud(ctx, assets, { fuel, score, combo, frame }) {
  drawFuel(ctx, assets, fuel.value);
  drawScore(ctx, assets, score);
  drawCombo(ctx, assets, combo);
}

export function drawButtons(ctx, assets) {
  drawButtonCaption(ctx, 'btnPause', BTN_PAUSE.x, BTN_PAUSE.y);
  drawButtonCaption(ctx, 'btnMenu', BTN_MENU.x, BTN_MENU.y);
}

/**
 * The DANGER signs announcing the next attack side, blinking at 2 Hz. The two strips are
 * their lettering and nothing else, and their own flash is the alpha ramp of the original
 * timeline; the diagonal sign is a red ring with an exclamation mark inside it.
 */
export function drawWarnings(ctx, assets, warnings, frame) {
  if (!warnings || warnings.length === 0 || !blinkOn(frame)) return;
  for (const wn of warnings) {
    if (wn.sprite === 'dangerDiag') {
      drawSprite(ctx, assets, wn.sprite, 0, wn.x, wn.y);
      drawDangerMark(ctx, wn.x, wn.y);
      continue;
    }
    drawDangerStrip(ctx, wn.sprite, assets.size(wn.sprite), assets.anchor(wn.sprite), wn.x, wn.y, dangerAlpha(frame));
  }
}

export function drawPaused(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  drawText(ctx, 'PAUSED', W / 2, H / 2, { size: 40, align: 'center' });
  drawText(ctx, 'PRESS P TO RESUME', W / 2, H / 2 + 34, { size: 16, align: 'center' });
}
