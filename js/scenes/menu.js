// The title screen: the original illustrated 600x450 `titleBg` animation, drawn from the
// vector artwork of the 2013 source document and played at its recorded per-frame
// durations slowed by `TITLE_SLOWDOWN`, with the original START button caption and two
// added controls (LEADERBOARD, SOUND ON/OFF) laid out over the parts of the artwork that
// are pure background in all 31 frames.
//
// Part of every `titleBg` frame: the "FRUIT" logo, the rainbow "madness" banner and the
// whole cast. The two labels are not — like every other caption in the game they are text
// fields in the original, so they are drawn here in the game's own font, centred on the
// positions the source document gives them.
// "START" is not part of the artwork either: it is the caption of the `btnStart` symbol.
import { W, H } from '../config.js';
import { createTitleFrames, titleKeyframeAt } from '../core/title-frames.js';
import { drawText } from '../core/text.js';
import { drawButtonCaption } from './captions.js';
import { createButtons, drawButton, drawMarker } from './ui.js';

// The flat navy the title art is painted over (sampled from the artwork). It stands in
// for the first frame during the moment it takes to rasterise it.
const TITLE_BG_COLOR = '#141443';

// The two labels of the title, as their text fields place them: centred on these points,
// 13 px, white, on the alphabetic baseline.
const LABELS = [
  { text: 'v.1.0 (remastered)', x: 75.85, y: 11 },
  { text: 'Fenion & Niruin, 2014', x: 528.45, y: 11 },
];
const LABEL_SIZE = 13;

// Free rectangles of the artwork (pure background in every frame):
// y 248..282 -> x 228..376, y 288..320 -> x 212..390, y 22..42 -> x 502..600.
const BTN_START = { id: 'start', x: 240, y: 250, w: 124, h: 32 };
const BTN_BOARD = { id: 'board', x: 216, y: 290, w: 172, h: 28, label: 'LEADERBOARD', size: 22 };
const BTN_SOUND = { id: 'sound', x: 504, y: 24, w: 92, h: 18, size: 12, marker: 'inline' };

const MUTED_KEY = 'fm.muted';

// Which scenes count as "coming back from a run": arriving from one of them plays the theme
// from its beginning again, as the original did. Booting, or stepping back from the
// leaderboard — a sub-screen of this menu — leaves the music exactly where it is.
const RUN_SCENES = ['game', 'gameover'];

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
  // The title animation and its timing. `title` is null when the manifest has no layered
  // entry for it.
  let title = null;
  let frames = 1;
  let timing = null;

  /**
   * Draws the title frame for this tick. The artwork rasterises in the background and
   * never holds the loop up, so this falls back — first to the most recent frame the cache
   * has (inside `title.draw`), and then to the flat colour the art is painted over. That
   * last state is also the one the menu keeps for good if the file cannot be used at all:
   * the labels and all three buttons are runtime text and never depended on the drawing.
   */
  function drawTitle(c, frame) {
    if (title && title.draw(c, frame, app.renderScale)) return;
    c.fillStyle = TITLE_BG_COLOR;
    c.fillRect(0, 0, W, H);
  }

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
    drawTitle(c, titleKeyframeAt(timing, frames, tick));

    for (const label of LABELS) {
      drawText(c, label.text, label.x, label.y, { size: LABEL_SIZE, align: 'center' });
    }

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
    enter(theApp, params = {}) {
      app = theApp;
      tick = 0;
      muted = app.audio ? app.audio.muted : readMuted();
      buttons.select('start');
      // Built once and kept across visits, so coming back from the game does not
      // re-download the file or throw the rasterised frames away.
      const layered = app.assets.layered ? app.assets.layered('titleBg') : null;
      if (layered && !title) title = createTitleFrames({ url: layered.file, size: layered.size });
      frames = layered ? layered.frameCount : 1;
      timing = layered ? layered.durations : null;
      // There is only one music track, and adding another is not allowed, so the title
      // screen plays the same theme the game does; entering the game does not restart it.
      // Leaving a run for the title screen does, which is where `from` comes in.
      if (app.audio) app.audio.music('mainTheme', { restart: RUN_SCENES.includes(params.from) });
    },
    update,
    render,
  };
}
