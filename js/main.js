// Entry point: assets, input, the fixed-step loop and the scene manager.
import { W, H, SCORE_MAX } from './config.js';
import { createLoop } from './core/loop.js';
import { loadAssets, drawSprite } from './core/assets.js';
import { createInput } from './core/input.js';
import { drawText, ensurePixelFont } from './core/text.js';
import { createGameScene } from './scenes/game.js';

// The original Background symbol is a flat fill of this colour (docs/assets-inventory.md).
export const BG_COLOR = '#090011';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

// A scene is { enter(app, params), update(input), render(ctx), exit() }.
const scenes = new Map();
let current = null;

// Scenes that do not exist yet fall back to one that does, so the game stays playable
// while the plan fills them in: the real menu and game-over screens arrive in Task 11.
const SCENE_FALLBACKS = { menu: 'game', leaderboard: 'menu' };

export const app = {
  canvas,
  ctx,
  bgColor: BG_COLOR,
  scene: null,
  sceneName: null,
  assets: null,
  audio: null,
  input: null,
  go(name, params) {
    let key = name;
    const seen = new Set();
    while (!scenes.has(key) && SCENE_FALLBACKS[key] && !seen.has(key)) {
      seen.add(key);
      key = SCENE_FALLBACKS[key];
    }
    const next = scenes.get(key);
    if (!next) { console.warn(`main: unknown scene "${name}"`); return; }
    if (current && current.exit) current.exit();
    current = next;
    app.scene = next;       // handy from the console when checking the game by hand
    app.sceneName = key;
    if (current.enter) current.enter(app, params);
  },
};

export function registerScene(name, scene) { scenes.set(name, scene); }

// --- Minimal game-over fallback (replaced by the real scene in Task 11) ---------------
// The extracted `gameOver` sprite already carries the original black letterbox bars, so it
// is drawn as one full-screen overlay with the score line underneath.
function createGameOverFallback() {
  let score = 0;
  return {
    enter(theApp, params) { score = (params && params.score) | 0; },
    update(input) {
      if (!input) return;
      if (input.pressed('Enter') || input.pressed('Space') || input.pointer.clicked) app.go('game');
    },
    render(c) {
      c.fillStyle = BG_COLOR;
      c.fillRect(0, 0, W, H);
      drawSprite(c, app.assets, 'gameOver', 0, W / 2, H / 2);
      const shown = Math.min(SCORE_MAX, Math.max(0, score));
      drawText(c, `SCORE: ${String(shown).padStart(7, '0')}`, W / 2, 225, { size: 24, align: 'center' });
      drawText(c, 'PRESS ENTER TO RETRY', W / 2, 270, { size: 14, align: 'center' });
    },
  };
}

// --- Boot ---------------------------------------------------------------------------
async function boot() {
  app.assets = await loadAssets('assets/manifest.json');
  await ensurePixelFont(20);
  ctx.imageSmoothingEnabled = false;

  app.input = createInput(window, { canvas });

  registerScene('game', createGameScene());
  registerScene('gameover', createGameOverFallback());
  app.go('game');

  const loop = createLoop({
    update: () => {
      if (current && current.update) current.update(app.input);
      app.input.endFrame();
    },
    render: () => {
      ctx.imageSmoothingEnabled = false;
      if (current && current.render) current.render(ctx);
    },
  });
  loop.start();
}

boot().catch((err) => {
  console.error('main: boot failed', err);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, W, H);
  drawText(ctx, 'LOADING FAILED', W / 2, H / 2, { size: 24, align: 'center' });
});
