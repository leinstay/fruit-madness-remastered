// When the main theme restarts, checked through the real scenes.
//
// The rule is the original's: the theme plays on the title screen, carries on into a run,
// and starts over the moment the player comes back to the menu from a run — whether they
// died or pressed MENU. The leaderboard is a sub-screen of the menu, so stepping into it
// and back leaves the music alone.
//
// The scenes are driven exactly as the game drives them: a fake scene manager that calls
// exit()/enter() like js/main.js, a fake input carrying a click, and js/core/audio.js with
// fake <audio> elements, so the assertions are on real currentTime / paused values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../js/core/audio.js';
import { createMenuScene } from '../js/scenes/menu.js';
import { createGameScene } from '../js/scenes/game.js';
import { createGameOverScene } from '../js/scenes/gameover.js';
import { createLeaderboardScene } from '../js/scenes/leaderboard.js';
import { buttonRect, BTN_MENU as HUD_MENU } from '../js/scenes/game-hud.js';
import { __setBackendForTests } from '../js/services/leaderboard.js';

const MANIFEST = {
  mainTheme: 'assets/audio/main-theme.mp3',
  gameOver: 'assets/audio/game-over.mp3',
  boom: 'assets/audio/boom.mp3',
};

/** A fake HTMLAudioElement: only the handful of members js/core/audio.js touches. */
function fakeElements() {
  const created = [];
  const makeElement = (url) => {
    const el = {
      src: url,
      loop: false,
      muted: false,
      currentTime: 0,
      paused: true,
      onended: null,
      play() { this.paused = false; return Promise.resolve(); },
      pause() { this.paused = true; },
      /** Simulates the browser firing 'ended'. */
      finish() { this.paused = true; const h = this.onended; if (h) h.call(this); },
    };
    created.push(el);
    return el;
  };
  return { created, makeElement, find: (part) => created.find((e) => e.src.includes(part)) };
}

// Enough of the asset service for the scenes' update paths: the HUD buttons need a sprite
// size and anchor, the menu asks for the (absent) layered title.
const ASSETS = {
  layered: () => null,
  size: () => [40, 20],
  anchor: () => [20, 10],
  frame: () => null,
  frameCount: () => 1,
  timing: () => null,
};

const IDLE = {
  state: { up: false, down: false, left: false, right: false },
  pressed: () => false,
  pointer: { x: -1, y: -1, down: false, clicked: false },
};

const clickAt = (x, y) => ({ ...IDLE, pointer: { x, y, down: true, clicked: true } });
const keyPress = (code) => ({ ...IDLE, pressed: (c) => c === code });

/** Centre of a button rectangle, which is where a real click lands. */
const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];

// The three canvas buttons the flows use, as their scenes declare them.
const MENU_START = [302, 266];
const MENU_BOARD = [302, 304];
const OVER_RETRY = [228, 355];
const OVER_MENU = [372, 355];
const BOARD_BACK = [300, 411];

function harness() {
  const els = fakeElements();
  const audio = createAudio('assets/audio/', MANIFEST, {
    makeElement: els.makeElement, storage: null, target: null, doc: null,
  });
  const scenes = {
    menu: createMenuScene(),
    game: createGameScene(),
    gameover: createGameOverScene(),
    leaderboard: createLeaderboardScene(),
  };
  const app = {
    assets: ASSETS,
    audio,
    input: null,
    bgColor: '#000',
    renderScale: 1,
    scene: null,
    sceneName: null,
    go(name, params) {
      if (app.scene && app.scene.exit) app.scene.exit();
      app.scene = scenes[name];
      app.sceneName = name;
      app.scene.enter(app, params);
    },
  };
  // The click that opens the page is also the gesture that unlocks playback.
  audio.arm();
  return { app, audio, els, theme: () => els.find('main-theme') };
}

/** Runs the current scene for `n` frames of nothing happening. */
function idle(app, n) {
  for (let i = 0; i < n; i++) app.scene.update(IDLE);
}

/** Kills the ship by dropping an enemy on top of it, then lets the boom finish. */
function die(app, els) {
  const { world, player } = app.scene.state;
  world.enemies.push({ x: player.x, y: player.y, r: 13, vx: 0, vy: 0 });
  app.scene.update(IDLE);
  assert.equal(app.scene.state.dying, true, 'the ship was hit');
  els.find('boom').finish();       // the game-over jingle follows the blast
}

test('the menu starts the theme, and START does not interrupt it', () => {
  const { app, theme } = harness();
  app.go('menu');
  assert.equal(theme().paused, false, 'the title screen plays the theme');
  theme().currentTime = 8;
  app.scene.update(clickAt(...MENU_START));
  assert.equal(app.sceneName, 'game');
  assert.equal(theme().currentTime, 8, 'the run carries the theme on');
  assert.equal(theme().paused, false);
});

test('pressing MENU during a run restarts the theme', () => {
  const { app, theme } = harness();
  app.go('menu');
  app.scene.update(clickAt(...MENU_START));
  theme().currentTime = 21;
  const rect = buttonRect(ASSETS, 'btnMenu', HUD_MENU);
  app.scene.update(clickAt(...centre(rect)));
  assert.equal(app.sceneName, 'menu');
  assert.equal(theme().currentTime, 0, 'the theme starts over');
  assert.equal(theme().paused, false);
});

test('MENU from a paused run restarts the theme and lets it play', () => {
  const { app, theme } = harness();
  app.go('menu');
  app.scene.update(clickAt(...MENU_START));
  theme().currentTime = 14;
  app.scene.update(keyPress('KeyP'));
  assert.equal(app.scene.state.paused, true);
  assert.equal(theme().paused, true, 'a paused run is silent');
  const rect = buttonRect(ASSETS, 'btnMenu', HUD_MENU);
  app.scene.update(clickAt(...centre(rect)));
  assert.equal(app.sceneName, 'menu');
  assert.equal(theme().currentTime, 0);
  assert.equal(theme().paused, false, 'the run\'s pause does not outlive the run');
});

test('death silences the theme, and the menu starts it over', () => {
  const { app, els, theme } = harness();
  app.go('menu');
  app.scene.update(clickAt(...MENU_START));
  theme().currentTime = 30;
  die(app, els);
  assert.equal(theme().paused, true, 'the theme cuts out on death');
  assert.equal(els.find('game-over').paused, false, 'the jingle follows the blast');
  idle(app, 90);
  assert.equal(app.sceneName, 'gameover');
  app.scene.update(clickAt(...OVER_MENU));
  assert.equal(app.sceneName, 'menu');
  assert.equal(els.find('game-over').paused, true, 'the jingle does not bleed into the menu');
  assert.equal(theme().currentTime, 0);
  assert.equal(theme().paused, false);
});

test('RETRY from the score screen starts the theme from the beginning', () => {
  const { app, els, theme } = harness();
  app.go('menu');
  app.scene.update(clickAt(...MENU_START));
  theme().currentTime = 45;
  die(app, els);
  idle(app, 90);
  app.scene.update(clickAt(...OVER_RETRY));
  assert.equal(app.sceneName, 'game');
  assert.equal(theme().currentTime, 0);
  assert.equal(theme().paused, false);
});

test('the leaderboard is a sub-screen of the menu: going there and back keeps the position', async () => {
  __setBackendForTests({ loadBackend: async () => ({ top: async () => [], add: async () => {} }) });
  try {
    const { app, theme } = harness();
    app.go('menu');
    theme().currentTime = 17;
    app.scene.update(clickAt(...MENU_BOARD));
    assert.equal(app.sceneName, 'leaderboard');
    assert.equal(theme().currentTime, 17, 'the table does not touch the music');
    app.scene.update(clickAt(...BOARD_BACK));
    assert.equal(app.sceneName, 'menu');
    assert.equal(theme().currentTime, 17, 'coming back is not coming back from a run');
    assert.equal(theme().paused, false);
  } finally {
    __setBackendForTests();
  }
});

test('the leaderboard reached from the score screen leads back to a theme at zero', async () => {
  __setBackendForTests({ loadBackend: async () => ({ top: async () => [], add: async () => {} }) });
  try {
    const { app, els, theme } = harness();
    app.go('menu');
    app.scene.update(clickAt(...MENU_START));
    theme().currentTime = 52;
    die(app, els);
    idle(app, 90);
    app.go('leaderboard', { highlight: { name: 'ABC', score: 1 } });
    assert.equal(theme().paused, true, 'nothing plays on the table after a run');
    app.scene.update(clickAt(...BOARD_BACK));
    assert.equal(app.sceneName, 'menu');
    assert.equal(theme().currentTime, 0);
    assert.equal(theme().paused, false);
  } finally {
    __setBackendForTests();
  }
});
