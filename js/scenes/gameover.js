// The score screen. The world handed over by the game scene keeps stepping and rendering
// behind the UI — enemies and muffins fly past the Game Over lettering, as in the original.
// The nickname field is real HTML (`#nick-form` in index.html) so mobile keyboards work;
// everything else is drawn on the canvas.
import { W, H, SCORE_MAX } from '../config.js';
import { drawSprite } from '../core/assets.js';
import { drawText } from '../core/text.js';
import { createWorld, stepWorld } from '../game/world.js';
import { validateNick } from '../game/nick.js';
import { submitScore } from '../services/leaderboard.js';
import { createStarfield } from './starfield.js';
import { drawWorldSprites } from './game-hud.js';
import { createButtons, drawButton } from './ui.js';

const NICK_KEY = 'fm.nick';
const SCORE_Y = 215;
const BTN_RETRY = { id: 'retry', x: 168, y: 340, w: 120, h: 30, label: 'RETRY', size: 24 };
const BTN_MENU = { id: 'menu', x: 312, y: 340, w: 120, h: 30, label: 'MENU', size: 24 };

// Keyed by validateNick's error and by the Error message submitScore rejects with.
const ERROR_TEXT = {
  short: '3-6 SYMBOLS',
  long: '3-6 SYMBOLS',
  chars: 'LATIN LETTERS AND DIGITS ONLY',
  invalid: '3-6 SYMBOLS',
  cooldown: 'WAIT A MOMENT',
  denied: 'REJECTED',
  offline: 'OFFLINE - NOT SAVED',
};

function readNick() {
  try {
    return (globalThis.localStorage && globalThis.localStorage.getItem(NICK_KEY)) || '';
  } catch {
    return '';
  }
}

function writeNick(value) {
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(NICK_KEY, value);
  } catch { /* the nickname simply will not be remembered */ }
}

export function createGameOverScene() {
  const buttons = createButtons([BTN_RETRY, BTN_MENU]);
  let app = null;
  let score = 0;
  let world = null;
  let starfield = null;
  let explosion = null;
  let submitted = false;
  let busy = false;

  const form = typeof document !== 'undefined' ? document.getElementById('nick-form') : null;
  const input = form ? form.querySelector('#nick') : null;
  const errorBox = form ? form.querySelector('#nick-error') : null;
  const submitBtn = form ? form.querySelector('button') : null;

  function showError(key) {
    if (errorBox) errorBox.textContent = key ? (ERROR_TEXT[key] || String(key)) : '';
  }

  function setEnabled(on) {
    if (input) input.disabled = !on;
    if (submitBtn) submitBtn.disabled = !on;
  }

  async function onSubmit(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (submitted || busy) return;
    const result = validateNick(input ? input.value : '');
    if (!result.ok) { showError(result.error); return; }
    busy = true;
    setEnabled(false);
    showError('');
    writeNick(result.value);
    try {
      await submitScore(result.value, score);
      submitted = true;
      app.go('leaderboard', { highlight: { name: result.value, score } });
    } catch (err) {
      // A failed send must be retryable: the field comes back to life and the caption says
      // why ('cooldown' | 'invalid' | 'denied' | 'offline', see js/services/leaderboard.js).
      busy = false;
      setEnabled(true);
      showError(ERROR_TEXT[err && err.message] ? err.message : 'offline');
    }
  }

  function showForm() {
    if (!form) return;
    form.hidden = false;
    if (input) input.value = readNick();
    setEnabled(true);
    showError('');
    form.addEventListener('submit', onSubmit);
  }

  function hideForm() {
    if (!form) return;
    form.hidden = true;
    form.removeEventListener('submit', onSubmit);
    if (input) input.blur();
  }

  function update(inputState) {
    // The world keeps running whether or not the player is typing.
    stepWorld(world);
    starfield.update();
    if (explosion) {
      explosion.update();
      if (explosion.done) explosion = null;
    }

    // While the nickname field has focus, js/core/input.js ignores the keyboard entirely,
    // so typing never moves the selection or activates a button.
    const activated = buttons.update(inputState);
    if (activated === 'retry') app.go('game');
    else if (activated === 'menu') app.go('menu');
  }

  function render(c) {
    const assets = app.assets;
    c.fillStyle = app.bgColor;
    c.fillRect(0, 0, W, H);
    drawSprite(c, assets, 'background', 0, 0, 0);
    starfield.render(c, assets);
    drawWorldSprites(c, assets, world);
    if (explosion) explosion.render(c);

    // The extracted sprite carries the letterbox bars and the "Game Over" lettering.
    drawSprite(c, assets, 'gameOver', 0, W / 2, H / 2);
    const shown = Math.min(SCORE_MAX, Math.max(0, Math.floor(score)));
    drawText(c, `SCORE: ${String(shown).padStart(7, '0')}`, W / 2, SCORE_Y, { size: 24, align: 'center' });
    const caption = submitted ? 'SCORE SENT' : 'ENTER YOUR NAME';
    drawText(c, caption, W / 2, 246, { size: 14, align: 'center', color: submitted ? '#ffe14d' : '#fff' });

    drawButton(c, buttons.byId('retry'), buttons.isSelected('retry'));
    drawButton(c, buttons.byId('menu'), buttons.isSelected('menu'));
  }

  return {
    enter(theApp, params = {}) {
      app = theApp;
      score = Math.max(0, params.score | 0);
      // The live world from the game scene; a fresh one only if something went wrong.
      world = params.world || createWorld(Date.now() >>> 0);
      starfield = params.starfield || createStarfield(60);
      explosion = params.explosion || null;
      submitted = false;
      busy = false;
      buttons.select('retry');
      showForm();
    },
    update,
    render,
    // Leaving the score screen silences it: the game-over jingle (or a boom still finishing)
    // must not bleed into the menu or into the next run.
    exit() {
      hideForm();
      if (app && app.audio) { app.audio.stopSfx(); app.audio.stopMusic(); }
    },
  };
}
