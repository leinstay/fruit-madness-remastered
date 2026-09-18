// Entry point: assets, the fixed-step loop and the scene manager.
import { W, H } from './config.js';
import { createLoop } from './core/loop.js';
import { loadAssets, drawSprite } from './core/assets.js';
import { createAnim, stepAnim } from './core/anim.js';
import { drawText, ensurePixelFont } from './core/text.js';
import { createStarfield } from './scenes/starfield.js';

// The original Background symbol is a flat fill of this colour (docs/assets-inventory.md).
export const BG_COLOR = '#090011';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

// A scene is { enter(app, params), update(input), render(ctx), exit() }.
const scenes = new Map();
let current = null;

export const app = {
  canvas,
  ctx,
  assets: null,
  audio: null,
  input: null,
  go(name, params) {
    const next = scenes.get(name);
    if (!next) { console.warn(`main: unknown scene "${name}"`); return; }
    if (current && current.exit) current.exit();
    current = next;
    if (current.enter) current.enter(app, params);
  },
};

export function registerScene(name, scene) { scenes.set(name, scene); }

// --- Temporary scene (replaced by the real menu/game scenes in Task 10) -------------
function createDemoScene() {
  const starfield = createStarfield(60);
  let anims = {};

  function animFor(name) {
    return createAnim(app.assets.frameCount(name) || 1, app.assets.timing(name));
  }

  return {
    enter() {
      anims = {
        ufo: animFor('ufo'),
        panda: animFor('panda'),
        cherry: animFor('cherry'),
        muffin: animFor('muffin'),
      };
    },
    update() {
      starfield.update();
      for (const a of Object.values(anims)) stepAnim(a);
    },
    render(c) {
      c.fillStyle = BG_COLOR;
      c.fillRect(0, 0, W, H);
      drawSprite(c, app.assets, 'background', 0, 0, 0);
      starfield.render(c, app.assets);

      drawText(c, 'FRUIT MADNESS', W / 2, 70, { size: 32, align: 'center' });

      // Proof that the loader, the animations and drawSprite work together.
      drawSprite(c, app.assets, 'ufo', anims.ufo.frame, 150, 225);
      drawSprite(c, app.assets, 'panda', anims.panda.frame, 150, 207);
      drawSprite(c, app.assets, 'cherry', anims.cherry.frame, 330, 200);
      drawSprite(c, app.assets, 'muffin', anims.muffin.frame, 420, 260);
    },
  };
}

// --- Boot ---------------------------------------------------------------------------
async function boot() {
  app.assets = await loadAssets('assets/manifest.json');
  await ensurePixelFont(20);
  ctx.imageSmoothingEnabled = false;

  registerScene('demo', createDemoScene());
  app.go('demo');

  const loop = createLoop({
    update: () => { if (current && current.update) current.update(app.input); },
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
