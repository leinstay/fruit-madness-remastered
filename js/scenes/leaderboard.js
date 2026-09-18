// The TOP 10 table over the shared starfield. The rows are laid out in fixed columns
// (rank / dotted name / score) so they line up whatever the font's advance widths are.
// The data comes from js/services/leaderboard.js, which is a localStorage stub until
// Task 13 puts Firestore behind the same three calls.
import { W, H } from '../config.js';
import { drawSprite } from '../core/assets.js';
import { drawText } from '../core/text.js';
import { fetchTop10 } from '../services/leaderboard.js';
import { createStarfield } from './starfield.js';
import { createButtons, drawButton } from './ui.js';

const TITLE_Y = 70;
const ROW_TOP = 118;
const ROW_PITCH = 26;
const NAME_FIELD = 12;          // characters, padded with dots so the columns read as a table
const COL_RANK = 130;
const COL_NAME = 178;
const COL_SCORE = 470;
const HIGHLIGHT = '#ffe14d';
const BTN_BACK = { id: 'back', x: 240, y: 396, w: 120, h: 30, label: 'BACK', size: 24 };

export function createLeaderboardScene() {
  const starfield = createStarfield(60);
  const buttons = createButtons([BTN_BACK]);
  let app = null;
  let rows = null;            // null while loading
  let state = 'loading';      // 'loading' | 'ready' | 'offline'
  let highlight = null;
  let request = 0;            // guards against a late answer from a previous visit

  function load() {
    const mine = ++request;
    state = 'loading';
    rows = null;
    fetchTop10().then(
      (list) => { if (mine === request) { rows = list; state = 'ready'; } },
      () => { if (mine === request) { rows = []; state = 'offline'; } },
    );
  }

  /** The run that was just submitted: the same name and, when it is known, the same score. */
  function isMine(row) {
    if (!highlight || row.name !== highlight.name) return false;
    return !Number.isFinite(highlight.score) || row.score === Math.floor(highlight.score);
  }

  function update(input) {
    starfield.update();
    const activated = buttons.update(input);
    if (activated === 'back' || (input && input.pressed('Escape'))) app.go('menu');
  }

  function drawRows(c) {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const y = ROW_TOP + i * ROW_PITCH;
      const color = isMine(row) ? HIGHLIGHT : '#fff';
      drawText(c, String(i + 1).padStart(2, '0'), COL_RANK, y, { size: 20, color });
      drawText(c, row.name.slice(0, NAME_FIELD).padEnd(NAME_FIELD, '.'), COL_NAME, y, { size: 20, color });
      drawText(c, String(Math.max(0, row.score)).padStart(7, '0'), COL_SCORE, y, { size: 20, align: 'right', color });
    }
  }

  function render(c) {
    c.fillStyle = app.bgColor;
    c.fillRect(0, 0, W, H);
    drawSprite(c, app.assets, 'background', 0, 0, 0);
    starfield.render(c, app.assets);

    drawText(c, 'TOP 10', W / 2, TITLE_Y, { size: 36, align: 'center' });

    if (state === 'loading') drawText(c, 'LOADING...', W / 2, H / 2, { size: 24, align: 'center' });
    else if (state === 'offline') drawText(c, 'OFFLINE', W / 2, H / 2, { size: 24, align: 'center' });
    else if (rows.length === 0) drawText(c, 'NO SCORES YET', W / 2, H / 2, { size: 24, align: 'center' });
    else drawRows(c);

    drawButton(c, buttons.byId('back'), buttons.isSelected('back'));
  }

  return {
    enter(theApp, params = {}) {
      app = theApp;
      highlight = params.highlight || null;
      buttons.select('back');
      load();
    },
    update,
    render,
    exit() { request += 1; },   // a pending fetch must not write into the next visit
  };
}
