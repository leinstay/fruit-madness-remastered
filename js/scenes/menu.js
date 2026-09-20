// The title screen: the original illustrated 600x450 `titleBg` animation from the SWF,
// played at its recorded per-frame durations, with the original START button sprite and
// two added controls (LEADERBOARD, SOUND ON/OFF) laid out over the parts of the artwork
// that are pure background in all 31 frames.
//
// Baked into every `titleBg` frame: the "FRUIT" logo, the rainbow "madness" banner, the
// whole cast, the version label `v.0.5 (giveMeTheSuga)` in the top left and the credit
// `Fenion & Niruin, 2014` in the top right. The credit is kept as it is; the version label
// is painted over with the surrounding background colour and redrawn as `v.1.0 (remastered)`.
// "START" is NOT baked in — it is the separate `btnStart` sprite, drawn here.
import { W, H } from '../config.js';
import { drawSprite } from '../core/assets.js';
import { frameAt } from '../core/anim.js';
import { drawText } from '../core/text.js';
import { drawButtonCaption } from './captions.js';
import { createButtons, drawButton, drawMarker } from './ui.js';

// The flat navy the title art uses behind the labels (sampled from titleBg_0.png).
const TITLE_BG_COLOR = '#141443';
// The baked-in version label, measured across all 31 frames: nothing but the text and the
// flat background lives in this rectangle, so it can be covered cleanly.
const VERSION_BOX = { x: 0, y: 0, w: 162, h: 20 };
const VERSION_TEXT = 'v.1.0 (remastered)';

// Free rectangles of the artwork (pure background in every frame):
// y 248..282 -> x 228..376, y 288..320 -> x 212..390, y 22..42 -> x 502..600.
const BTN_START = { id: 'start', x: 240, y: 250, w: 124, h: 32 };
const BTN_BOARD = { id: 'board', x: 216, y: 290, w: 172, h: 28, label: 'LEADERBOARD', size: 22 };
const BTN_SOUND = { id: 'sound', x: 504, y: 24, w: 92, h: 18, size: 12, marker: 'inline' };

const MUTED_KEY = 'fm.muted';

/**
 * localStorage is read lazily and defensively: it throws when site data is blocked.
 * js/core/audio.js owns the same key; these two helpers are the fallback used when the
 * audio service is missing (a scene rendered outside the normal boot).
 */
export function readMuted() {
  try {
    return globalThis.localStorage && globalThis.localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMuted(muted) {
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch { /* nothing we can do; the flag simply will not survive the reload */ }
}

export function createMenuScene() {
  const buttons = createButtons([BTN_START, BTN_BOARD, BTN_SOUND]);
  let app = null;
  let tick = 0;
  let muted = false;

  function update(input) {
    tick += 1;
    const activated = buttons.update(input);
    if (activated === 'start') app.go('game');
    else if (activated === 'board') app.go('leaderboard');
    else if (activated === 'sound') {
      muted = !muted;
      if (app.audio) {
        app.audio.setMuted(muted);
        muted = app.audio.muted;   // the service is the single source of truth
      } else {
        writeMuted(muted);
      }
    }
  }

  function render(c) {
    const assets = app.assets;
    c.fillStyle = app.bgColor;
    c.fillRect(0, 0, W, H);
    const frame = frameAt(assets.timing('titleBg'), assets.frameCount('titleBg'), tick);
    drawSprite(c, assets, 'titleBg', frame, W / 2, H / 2);

    // Replace the original version label; the author credit on the right is left untouched.
    c.fillStyle = TITLE_BG_COLOR;
    c.fillRect(VERSION_BOX.x, VERSION_BOX.y, VERSION_BOX.w, VERSION_BOX.h);
    drawText(c, VERSION_TEXT, 4, 4, { size: 12, baseline: 'top' });

    // START is the original 40 px caption of the `btnStart` symbol, drawn where that symbol
    // put it; the other two are pixel-font labels in the same style.
    const start = buttons.byId('start');
    drawButtonCaption(c, 'btnStart', start.x + start.w / 2, start.y + start.h / 2 + 3);
    if (buttons.isSelected('start')) drawMarker(c, start, 22);

    drawButton(c, buttons.byId('board'), buttons.isSelected('board'));
    drawButton(c, buttons.byId('sound'), buttons.isSelected('sound'), {
      label: (app.audio ? app.audio.muted : muted) ? 'SOUND OFF' : 'SOUND ON',
    });
  }

  return {
    enter(theApp) {
      app = theApp;
      tick = 0;
      muted = app.audio ? app.audio.muted : readMuted();
      buttons.select('start');
      // There is only one music track, and adding another is not allowed, so the title
      // screen plays the same theme the game does; entering the game does not restart it.
      if (app.audio) app.audio.music('mainTheme');
    },
    update,
    render,
  };
}
