// Entry point: assets, input, the fixed-step loop and the scene manager.
import { W, H, AUDIO_BASE_URL } from './config.js';
import { createLoop } from './core/loop.js';
import { loadAssets } from './core/assets.js';
import { createAudio } from './core/audio.js';
import { createInput, attachTouch } from './core/input.js';
import { drawText, ensurePixelFont } from './core/text.js';
import { createGameScene } from './scenes/game.js';
import { createMenuScene } from './scenes/menu.js';
import { createGameOverScene } from './scenes/gameover.js';
import { createLeaderboardScene } from './scenes/leaderboard.js';

// The original Background symbol is a flat fill of this colour (docs/assets-inventory.md).
export const BG_COLOR = '#090011';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

// A scene is { enter(app, params), update(input), render(ctx), exit() }.
const scenes = new Map();
let current = null;

// A scene that does not exist yet falls back to one that does, so the game stays playable
// while the plan fills the rest in. All four scenes exist since Task 11, so the map is empty.
const SCENE_FALLBACKS = {};

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

// --- Boot ---------------------------------------------------------------------------
async function boot() {
  app.assets = await loadAssets('assets/manifest.json');
  await ensurePixelFont(20);
  ctx.imageSmoothingEnabled = false;

  app.input = createInput(window, { canvas });
  // The floating touch joystick writes the same four booleans the keyboard does, so both
  // can be used at once and the ship's physics does not know the difference.
  attachTouch(app.input, canvas);
  // The manifest is already in memory from loadAssets(); the file names in its `audio` map
  // are re-based onto AUDIO_BASE_URL, so moving the clips is a one-constant change.
  app.audio = createAudio(AUDIO_BASE_URL, (app.assets.manifest || {}).audio || {});

  registerScene('menu', createMenuScene());
  registerScene('game', createGameScene());
  registerScene('gameover', createGameOverScene());
  registerScene('leaderboard', createLeaderboardScene());
  app.go('menu');

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
