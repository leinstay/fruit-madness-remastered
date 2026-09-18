// HUD and overlay drawing for the game scene: the three capsules along the top, the
// PAUSE/MENU buttons along the bottom, the DANGER signs and the boss telegraph bands.
// Kept out of game.js so that scene stays about the game loop.
import { W, H, FUEL, COMBO, ENEMY, SCORE_MAX } from '../config.js';
import { drawSprite } from '../core/assets.js';
import { frameAt } from '../core/anim.js';
import { drawText } from '../core/text.js';
import { expandRect, MIN_TOUCH_SIZE } from './ui.js';

// Positions of the original HUD (GameLoop.as); all three capsules sit on the same row.
export const FUEL_BAR = { x: 57, y: 32 };
export const SCORE_BAR = { x: 300, y: 32 };
export const COMBO_BAR = { x: 543, y: 32 };
export const BTN_PAUSE = { x: 57, y: 425 };
export const BTN_MENU = { x: 546, y: 425 };

const BLINK_TICKS = 15;                 // 2 Hz at 60 fps: 15 on, 15 off
const TELEGRAPH_FILL = 'rgba(220, 30, 40, 0.28)';

/** True on the "lit" half of a 2 Hz blink. */
export const blinkOn = (frame) => Math.floor(frame / BLINK_TICKS) % 2 === 0;

/** The on-screen rectangle a sprite would occupy when drawn at (x, y). */
export function spriteRect(assets, name, x, y) {
  if (!assets || !assets.has(name)) return { x, y, w: 0, h: 0 };
  const img = assets.img(name, 0);
  if (!img || !img.width) return { x, y, w: 0, h: 0 };
  const a = assets.anchor(name) || [img.width / 2, img.height / 2];
  return { x: x - a[0], y: y - a[1], w: img.width, h: img.height };
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

/** Draws `name` scaled by `scale` about its anchor — used for the combo cells and for the
 *  cherry standing in for enemies whose own sprite has not been drawn yet (Task 15). */
export function drawScaledSprite(ctx, assets, name, frame, x, y, scale) {
  if (!assets || !assets.has(name) || scale <= 0) return;
  const img = assets.img(name, frame);
  if (!img || !img.width) return;
  const a = assets.anchor(name) || [img.width / 2, img.height / 2];
  ctx.drawImage(img, x - a[0] * scale, y - a[1] * scale, img.width * scale, img.height * scale);
}

function drawFuel(ctx, assets, fuelValue) {
  drawSprite(ctx, assets, 'fuelBar', 0, FUEL_BAR.x, FUEL_BAR.y);
  const ratio = Math.max(0, Math.min(1, fuelValue / FUEL.MAX));
  const img = assets.has('fuelFill') ? assets.img('fuelFill', 0) : null;
  if (img && img.width) {
    const a = assets.anchor('fuelFill') || [img.width / 2, img.height / 2];
    const top = FUEL_BAR.y - a[1];
    const w = Math.round(img.width * ratio);
    // As in the 2013 original (`fuelCount.scaleX = fuel / 100`), the fill shrinks about its
    // registration point, so the capsule contracts towards the middle of the bar.
    const left = Math.round(FUEL_BAR.x - a[0] * ratio);
    if (w > 0) ctx.drawImage(img, left, top, w, img.height);
  } else {
    const w = Math.round(100 * ratio);
    ctx.fillStyle = '#fff';
    ctx.fillRect(Math.round(FUEL_BAR.x - w / 2), FUEL_BAR.y - 15, w, 30);
  }
}

function drawScore(ctx, assets, score) {
  drawSprite(ctx, assets, 'scoreBar', 0, SCORE_BAR.x, SCORE_BAR.y);
  const shown = Math.min(SCORE_MAX, Math.max(0, Math.floor(score)));
  drawText(ctx, String(shown).padStart(7, '0'), SCORE_BAR.x, SCORE_BAR.y + 12, {
    size: 16, align: 'center', color: '#fff',
  });
}

// Until Task 15 redraws the combo capsule, the extracted `comboBar` sprite is unusable
// (it has four muffins and the caption "not working yet :(" baked in), so the cells are
// drawn as small muffins over a spare `scoreBar` frame.
function drawCombo(ctx, assets, combo, frame) {
  drawSprite(ctx, assets, 'scoreBar', 0, COMBO_BAR.x, COMBO_BAR.y);
  const cellScale = 0.5;
  const pitch = 20;
  const y = COMBO_BAR.y + 4;
  const x0 = COMBO_BAR.x - ((COMBO.CELLS - 1) * pitch) / 2 - 14;
  const muffinFrame = frameAt(assets.timing('muffin'), assets.frameCount('muffin'), frame);
  for (let i = 0; i < COMBO.CELLS; i++) {
    ctx.save();
    ctx.globalAlpha = i < combo.cells ? 1 : 0.25;
    drawScaledSprite(ctx, assets, 'muffin', muffinFrame, x0 + i * pitch, y, cellScale);
    ctx.restore();
  }
  drawText(ctx, `x${1 + combo.cells}`, COMBO_BAR.x + 40, y + 6, { size: 14, align: 'right' });
}

/**
 * The live contents of the field — the muffins and the enemies — without the player, the
 * HUD or the buttons. Shared by the game scene and by the game-over screen, which keeps
 * the same world stepping and drawing behind its UI, as the original does.
 * Enemies whose own sprite has not been drawn yet (Task 15) fall back to a scaled cherry.
 */
export function drawWorldSprites(ctx, assets, world) {
  const muffinFrame = frameAt(assets.timing('muffin'), assets.frameCount('muffin'), world.frame);
  for (const s of world.sugars) drawSprite(ctx, assets, 'muffin', muffinFrame, s.x, s.y);
  for (const e of world.enemies) {
    const known = assets.has(e.sprite);
    const name = known ? e.sprite : 'cherry';
    if (!assets.has(name)) continue;
    // The per-enemy animOffset was drawn from the world's rng at spawn time, so the wave
    // does not animate in lockstep and drawing consumes no randomness of its own.
    const f = frameAt(assets.timing(name), assets.frameCount(name), world.frame + (e.animOffset | 0));
    if (known) drawSprite(ctx, assets, name, f, e.x, e.y);
    else drawScaledSprite(ctx, assets, name, f, e.x, e.y, (e.size || ENEMY.SIZE) / ENEMY.SIZE);
  }
}

export function drawHud(ctx, assets, { fuel, score, combo, frame }) {
  drawFuel(ctx, assets, fuel.value);
  drawScore(ctx, assets, score);
  drawCombo(ctx, assets, combo, frame);
}

export function drawButtons(ctx, assets) {
  drawSprite(ctx, assets, 'btnPause', 0, BTN_PAUSE.x, BTN_PAUSE.y);
  drawSprite(ctx, assets, 'btnMenu', 0, BTN_MENU.x, BTN_MENU.y);
}

/** The DANGER signs announcing the next attack side, blinking at 2 Hz. */
export function drawWarnings(ctx, assets, warnings, frame) {
  if (!warnings || warnings.length === 0 || !blinkOn(frame)) return;
  for (const wn of warnings) {
    const f = frameAt(assets.timing(wn.sprite), assets.frameCount(wn.sprite), frame);
    drawSprite(ctx, assets, wn.sprite, f, wn.x, wn.y);
  }
}

/** The boss telegraph: a translucent red full-width band, blinking at the same 2 Hz. */
export function drawTelegraphs(ctx, telegraphs, frame) {
  if (!telegraphs || telegraphs.length === 0 || !blinkOn(frame)) return;
  ctx.save();
  ctx.fillStyle = TELEGRAPH_FILL;
  for (const t of telegraphs) ctx.fillRect(t.x, t.y, t.w, t.h);
  ctx.restore();
}

export function drawPaused(ctx) {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  drawText(ctx, 'PAUSED', W / 2, H / 2, { size: 40, align: 'center' });
  drawText(ctx, 'PRESS P TO RESUME', W / 2, H / 2 + 34, { size: 16, align: 'center' });
}
