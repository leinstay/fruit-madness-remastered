// The playable scene: it owns the player, the fuel, the combo and the score, and drives
// the deterministic world from js/game/*. All of the drawing helpers live in game-hud.js
// and explosion.js; this file is the frame order and nothing else.
import { W, H, FUEL, SCORE_MAX } from '../config.js';
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
  drawHud, drawButtons, drawWarnings, drawPaused, drawWorldSprites,
  buttonRect, rectHit, BTN_PAUSE, BTN_MENU,
} from './game-hud.js';
import { drawJoystick } from './joystick-view.js';

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

  /** The pause button and the P/Escape key share this, so the music follows either one. */
  function setPaused(value) {
    paused = value;
    if (!app.audio) return;
    if (paused) app.audio.pauseMusic(); else app.audio.resumeMusic();
  }

  function startDeath() {
    dying = true;
    deathFrames = 0;
    explosion = createExplosion(player.x, player.y);
    // As in the original: the theme cuts out, the wreck explodes, and the game-over jingle
    // follows the blast. It plays once and is stopped when the score screen is left.
    if (app.audio) {
      app.audio.stopMusic();
      app.audio.sfx('boom', { onEnded: () => app.audio.music('gameOver', { loop: false }) });
    }
  }

  /** Returns true when the click left this scene, so update() must stop immediately. */
  function handleButtons(input) {
    if (!input || !input.pointer.clicked || !app || !app.assets) return false;
    const p = input.pointer;
    if (rectHit(buttonRect(app.assets, 'btnPause', BTN_PAUSE), p)) {
      if (!dying) setPaused(!paused);
    } else if (rectHit(buttonRect(app.assets, 'btnMenu', BTN_MENU), p)) {
      app.go('menu');
      return true;
    }
    return false;
  }

  function update(input) {
    if (handleButtons(input)) return;
    if (input && (input.pressed('KeyP') || input.pressed('Escape')) && !dying) setPaused(!paused);
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
      // The score screen keeps this very world (and the dying blast) running behind its UI.
      if (deathFrames >= DEATH_FRAMES) app.go('gameover', { score, world, starfield, explosion });
      return;
    }

    // 3. a muffin that left the field uncollected breaks the combo
    if (missedSugars > 0) comboMiss(combo);

    // 4. muffins collected this frame: fuel, then the combo bonus
    const taken = collectSugars(player, world.sugars);
    for (let i = 0; i < taken; i++) {
      addFuel(fuel, FUEL.MUFFIN);
      score = Math.min(SCORE_MAX, score + comboCollect(combo));
      // The original has no pickup sound, and no sound may be added that it did not have.
    }

    // 5. the per-frame score, multiplied by the combo
    score = Math.min(SCORE_MAX, score + comboMultiplier(combo));

    // 6. death
    if (hitsAny(player, world.enemies)) startDeath();
  }

  function render(c) {
    const assets = app.assets;
    c.fillStyle = app.bgColor;
    c.fillRect(0, 0, W, H);
    drawSprite(c, assets, 'background', 0, 0, 0);
    starfield.render(c, assets);

    drawWorldSprites(c, assets, world);

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
    // The floating stick, only ever visible while a finger is actually holding it.
    if (app.input) drawJoystick(c, app.input.joystick);
    if (paused) drawPaused(c);
  }

  return {
    enter(theApp) {
      app = theApp;
      reset();
      // A thumb landing on PAUSE or MENU presses the button instead of starting to steer.
      if (app.input && app.assets) {
        app.input.setTouchExclusions([
          buttonRect(app.assets, 'btnPause', BTN_PAUSE),
          buttonRect(app.assets, 'btnMenu', BTN_MENU),
        ]);
      }
      // Same track as the menu: coming from the title screen this is a no-op, while after
      // RETRY (the theme was stopped on death) it starts again from the beginning.
      if (app.audio) { app.audio.resumeMusic(); app.audio.music('mainTheme'); }
    },
    update,
    render,
    // The HUD buttons only exist in this scene, so the exclusions leave with it.
    exit() {
      if (app && app.input) app.input.setTouchExclusions([]);
    },
    // Exposed for debugging from the console and for the browser check.
    get state() { return { world, player, fuel, combo, score, paused, dying }; },
  };
}
