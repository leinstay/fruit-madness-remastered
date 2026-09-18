// The playable scene: it owns the player, the fuel, the combo and the score, and drives
// the deterministic world from js/game/*. All of the drawing helpers live in game-hud.js
// and explosion.js; this file is the frame order and nothing else.
import { W, H, FUEL, ENEMY, SCORE_MAX } from '../config.js';
import { drawSprite } from '../core/assets.js';
import { frameAt } from '../core/anim.js';
import { createWorld, stepWorld } from '../game/world.js';
import { createPlayer, stepPlayer } from '../game/player.js';
import { createFuel, stepFuel, addFuel } from '../game/fuel.js';
import { createCombo, comboCollect, comboMiss, comboMultiplier } from '../game/combo.js';
import { hitsAny, collectSugars } from '../game/collision.js';
import { createStarfield } from './starfield.js';
import { createExplosion } from './explosion.js';
import {
  drawHud, drawButtons, drawWarnings, drawTelegraphs, drawPaused,
  drawScaledSprite, spriteRect, rectHit, BTN_PAUSE, BTN_MENU,
} from './game-hud.js';

// How long the wreck burns before the score screen takes over.
const DEATH_FRAMES = 90;
// The pilot sits in the dome, above the saucer's centre, and tilts with the hull.
const PILOT_OFFSET_Y = -14;

export function createGameScene() {
  const starfield = createStarfield(60);
  let app = null;
  let world, player, fuel, combo, score, paused, dying, deathFrames, explosion;

  function reset() {
    world = createWorld(Date.now() >>> 0);
    player = createPlayer();
    fuel = createFuel();
    combo = createCombo();
    score = 0;
    paused = false;
    dying = false;
    deathFrames = 0;
    explosion = null;
  }

  function startDeath() {
    dying = true;
    deathFrames = 0;
    explosion = createExplosion(player.x, player.y);
    // Task 12 adds sfx('boom') and stopMusic() here.
  }

  /** Returns true when the click left this scene, so update() must stop immediately. */
  function handleButtons(input) {
    if (!input || !input.pointer.clicked || !app || !app.assets) return false;
    const p = input.pointer;
    if (rectHit(spriteRect(app.assets, 'btnPause', BTN_PAUSE.x, BTN_PAUSE.y), p)) {
      if (!dying) paused = !paused;
    } else if (rectHit(spriteRect(app.assets, 'btnMenu', BTN_MENU.x, BTN_MENU.y), p)) {
      // Task 11 registers the real menu scene; until then app.go() falls back to 'game'.
      app.go('menu');
      return true;
    }
    return false;
  }

  function update(input) {
    if (handleButtons(input)) return;
    if (input && (input.pressed('KeyP') || input.pressed('Escape')) && !dying) paused = !paused;
    if (paused) return;

    // 1. the player and its tank (frozen once the ship is gone)
    if (!dying) {
      stepPlayer(player, input ? input.state : { up: false, down: false, left: false, right: false }, fuel.value > 0);
      stepFuel(fuel);
    }

    // 2. the world keeps running either way — the wreck drifts through live traffic
    const { missedSugars } = stepWorld(world);
    starfield.update();

    if (dying) {
      explosion.update();
      deathFrames += 1;
      if (deathFrames >= DEATH_FRAMES) app.go('gameover', { score });
      return;
    }

    // 3. a muffin that left the field uncollected breaks the combo
    if (missedSugars > 0) comboMiss(combo);

    // 4. muffins collected this frame: fuel, then the combo bonus
    const taken = collectSugars(player, world.sugars);
    for (let i = 0; i < taken; i++) {
      addFuel(fuel, FUEL.MUFFIN);
      score = Math.min(SCORE_MAX, score + comboCollect(combo));
      // Task 12 adds sfx('pickup') here if the original has one.
    }

    // 5. the per-frame score, multiplied by the combo
    score = Math.min(SCORE_MAX, score + comboMultiplier(combo));

    // 6. death
    if (hitsAny(player, world.enemies)) startDeath();
  }

  function drawEnemy(c, assets, e) {
    // Apple, pear, pomegranate, lime, banana, plum, berry and boss arrive in Task 15;
    // until their sprites exist the cherry stands in, scaled so the hit circle still reads.
    const known = assets.has(e.sprite);
    const name = known ? e.sprite : 'cherry';
    if (!assets.has(name)) return;
    // The per-enemy animOffset was drawn from the world's rng at spawn time, so the wave
    // does not animate in lockstep and drawing consumes no randomness of its own.
    const f = frameAt(assets.timing(name), assets.frameCount(name), world.frame + (e.animOffset | 0));
    if (known) drawSprite(c, assets, name, f, e.x, e.y);
    else drawScaledSprite(c, assets, name, f, e.x, e.y, (e.size || ENEMY.SIZE) / ENEMY.SIZE);
  }

  function render(c) {
    const assets = app.assets;
    c.fillStyle = app.bgColor;
    c.fillRect(0, 0, W, H);
    drawSprite(c, assets, 'background', 0, 0, 0);
    starfield.render(c, assets);

    drawTelegraphs(c, world.telegraphs, world.frame);

    const muffinFrame = frameAt(assets.timing('muffin'), assets.frameCount('muffin'), world.frame);
    for (const s of world.sugars) drawSprite(c, assets, 'muffin', muffinFrame, s.x, s.y);
    for (const e of world.enemies) drawEnemy(c, assets, e);

    if (!dying) {
      const ufoFrame = frameAt(assets.timing('ufo'), assets.frameCount('ufo'), world.frame);
      const pandaFrame = frameAt(assets.timing('panda'), assets.frameCount('panda'), world.frame);
      drawSprite(c, assets, 'ufo', ufoFrame, player.x, player.y, player.rotation);
      c.save();
      c.translate(player.x, player.y);
      c.rotate((player.rotation * Math.PI) / 180);
      drawSprite(c, assets, 'panda', pandaFrame, 0, PILOT_OFFSET_Y);
      c.restore();
    }
    if (explosion) explosion.render(c);

    drawWarnings(c, assets, world.warnings, world.frame);
    drawHud(c, assets, { fuel, score, combo, frame: world.frame });
    drawButtons(c, assets);
    if (paused) drawPaused(c);
  }

  return {
    enter(theApp) { app = theApp; reset(); },
    update,
    render,
    // Exposed for debugging from the console and for the browser check.
    get state() { return { world, player, fuel, combo, score, paused, dying }; },
  };
}
