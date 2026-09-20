// Entry point: assets, input, the fixed-step loop and the scene manager.
import { W, H, AUDIO_BASE_URL } from './config.js';
import { createLoop } from './core/loop.js';
import { computeBackingSize } from './core/canvas.js';
import { loadAssets } from './core/assets.js';
import { createAudio } from './core/audio.js';
import { createInput, attachTouch } from './core/input.js';
import { drawText, ensurePixelFont } from './core/text.js';
import { loadingState } from './core/loading.js';
import { drawLoading } from './scenes/loading.js';
import { createGameScene } from './scenes/game.js';
import { createMenuScene } from './scenes/menu.js';
import { createGameOverScene } from './scenes/gameover.js';
import { createLeaderboardScene } from './scenes/leaderboard.js';

// The original Background symbol is a flat fill of this colour (docs/assets-inventory.md).
export const BG_COLOR = '#090011';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

// How many device pixels one logical pixel covers right now. The scenes never see it:
// render() installs it as the base transform and everything keeps drawing in 600x450 units.
let renderScale = 1;

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
  renderScale: 1,
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

// --- The backing store ----------------------------------------------------------------
// The canvas is drawn at the resolution the display really has: its CSS box times the
// device pixel ratio, capped by MAX_RENDER_SCALE. Resizing the window, dragging the window
// onto a second monitor and a browser zoom all change that number, so all three are
// watched and coalesced into one debounced update.
const RESIZE_DEBOUNCE_MS = 100;
let resizeTimer = 0;
let dprQuery = null;

function applyCanvasSize() {
  const rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const size = computeBackingSize(rect ? rect.width : W, rect ? rect.height : H, dpr);
  if (canvas.width !== size.width || canvas.height !== size.height) {
    // Resizing the backing store clears it and resets the context state; render() puts the
    // base transform back before anything is drawn again.
    canvas.width = size.width;
    canvas.height = size.height;
  }
  renderScale = size.scale;
  app.renderScale = size.scale;
  // The vector art is cached as bitmaps of whole device pixels, so a new scale means a new
  // cache. Asking for the scale it already holds costs nothing.
  if (app.assets && app.assets.rasterise) app.assets.rasterise(size.scale);
}

// `(resolution: Xdppx)` only matches the ratio it was created with, so the query has to be
// built again after every change to keep watching for the next one.
function watchDevicePixelRatio() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  if (dprQuery && typeof dprQuery.removeEventListener === 'function') {
    dprQuery.removeEventListener('change', scheduleCanvasSize);
  }
  const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  try {
    dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
    if (typeof dprQuery.addEventListener === 'function') dprQuery.addEventListener('change', scheduleCanvasSize);
  } catch {
    dprQuery = null;   // a browser without `resolution` queries simply relies on resize
  }
}

function scheduleCanvasSize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    applyCanvasSize();
    watchDevicePixelRatio();
  }, RESIZE_DEBOUNCE_MS);
}

function watchCanvasSize() {
  applyCanvasSize();
  watchDevicePixelRatio();
  window.addEventListener('resize', scheduleCanvasSize);
  window.addEventListener('orientationchange', scheduleCanvasSize);
  if (typeof ResizeObserver === 'function') {
    // The stage is laid out from dvh and safe-area insets, which can change without a
    // window resize event (the mobile URL bar sliding away).
    new ResizeObserver(scheduleCanvasSize).observe(canvas);
  }
}

// --- Boot ---------------------------------------------------------------------------
// Everything below the first paint is a wait the player can see, so it happens behind the
// loading screen: the sprite frames are counted onto its bar, and the menu scene keeps the
// same screen up afterwards until the title artwork has its first keyframe.

const nowMs = () => (typeof performance === 'object' && performance && typeof performance.now === 'function'
  ? performance.now() : Date.now());

function paintLoading(state) {
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, W, H);
  drawLoading(ctx, { progress: state.progress, time: nowMs() });
}

async function boot() {
  watchCanvasSize();

  let loaded = 0;
  let expected = 0;
  let booting = true;
  // Painted before a single thing is awaited, so the first frame the browser puts up is
  // this and never the empty canvas. The rest of the phase is repainted per frame, both to
  // follow the bar and because a resize clears the backing store.
  paintLoading(loadingState({}));
  const repaint = () => {
    if (!booting) return;
    paintLoading(loadingState({ assetsDone: loaded, assetsTotal: expected }));
    requestAnimationFrame(repaint);
  };
  requestAnimationFrame(repaint);

  app.assets = await loadAssets('assets/manifest.json', {
    onProgress: (done, total) => { loaded = done; expected = total; },
  });
  app.assets.rasterise(renderScale);
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
  // From here on the loop paints, and the menu scene decides for itself how much longer the
  // loading screen stays up while the title artwork is prepared.
  booting = false;
  app.go('menu');

  const loop = createLoop({
    update: () => {
      if (current && current.update) current.update(app.input);
      app.input.endFrame();
    },
    render: () => {
      // One logical pixel = `renderScale` device pixels, for every scene and every frame.
      ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
      ctx.imageSmoothingEnabled = false;
      if (current && current.render) current.render(ctx);
    },
  });
  loop.start();
}

boot().catch((err) => {
  console.error('main: boot failed', err);
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, W, H);
  drawText(ctx, 'LOADING FAILED', W / 2, H / 2, { size: 24, align: 'center' });
});
