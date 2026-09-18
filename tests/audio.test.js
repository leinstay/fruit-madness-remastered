import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, resolveAudioUrl } from '../js/core/audio.js';

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
      playCalls: 0,
      rejectPlay: false,
      play() {
        this.playCalls += 1;
        if (this.rejectPlay) return Promise.reject(new Error('NotAllowedError'));
        this.paused = false;
        return Promise.resolve();
      },
      pause() { this.paused = true; },
      /** Simulates the browser firing 'ended'. */
      finish() { this.paused = true; const h = this.onended; if (h) h.call(this); },
    };
    created.push(el);
    return el;
  };
  return { created, makeElement, find: (part) => created.find((e) => e.src.includes(part)) };
}

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
}

/** A DOM-free event target that records its listeners. */
function fakeTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).concat(fn)); },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn));
    },
    fire(type) { for (const fn of (listeners.get(type) || []).slice()) fn({ type }); },
  };
}

function setup(opts = {}) {
  const els = fakeElements();
  const storage = opts.storage || fakeStorage();
  const target = opts.target || fakeTarget();
  const audio = createAudio('assets/audio/', MANIFEST, {
    makeElement: els.makeElement, storage, target, doc: null,
  });
  return { audio, els, storage, target };
}

test('resolveAudioUrl re-bases the manifest file name onto the audio base URL', () => {
  assert.equal(resolveAudioUrl('assets/audio/', 'assets/audio/boom.mp3'), 'assets/audio/boom.mp3');
  assert.equal(resolveAudioUrl('https://cdn.example/fm/', 'assets/audio/boom.mp3'),
    'https://cdn.example/fm/boom.mp3');
  assert.equal(resolveAudioUrl('https://cdn.example/fm', 'assets/audio/boom.mp3'),
    'https://cdn.example/fm/boom.mp3');
  // No base URL: the manifest path is used exactly as it stands.
  assert.equal(resolveAudioUrl('', 'assets/audio/boom.mp3'), 'assets/audio/boom.mp3');
});

test('nothing plays before the first user gesture', () => {
  const { audio, els } = setup();
  audio.music('mainTheme');
  audio.sfx('boom');
  assert.equal(els.created.every((e) => e.playCalls === 0), true);
});

test('a music() call made before arming starts at the moment of arming', () => {
  const { audio, els } = setup();
  audio.music('mainTheme');
  audio.arm();
  const theme = els.find('main-theme');
  assert.ok(theme, 'the element for mainTheme was created');
  assert.equal(theme.paused, false);
  assert.equal(theme.loop, true);
});

test('the first pointerdown arms playback, and the listeners are then removed', () => {
  const { audio, els, target } = setup();
  audio.music('mainTheme');
  assert.equal(els.find('main-theme').playCalls, 0);
  target.fire('pointerdown');
  assert.equal(els.find('main-theme').playCalls, 1);
  target.fire('pointerdown');
  target.fire('keydown');
  assert.equal(els.find('main-theme').playCalls, 1, 'arming happens exactly once');
  assert.equal((target.listeners.get('pointerdown') || []).length, 0);
  assert.equal((target.listeners.get('keydown') || []).length, 0);
});

test('music() for the track that is already playing does not restart it', () => {
  const { audio, els } = setup();
  audio.arm();
  audio.music('mainTheme');
  const theme = els.find('main-theme');
  theme.currentTime = 12.5;
  audio.music('mainTheme');
  assert.equal(theme.playCalls, 1);
  assert.equal(theme.currentTime, 12.5);
});

test('switching tracks stops the old one and starts the new one from the beginning', () => {
  const { audio, els } = setup();
  audio.arm();
  audio.music('mainTheme');
  const theme = els.find('main-theme');
  theme.currentTime = 30;
  audio.music('gameOver', { loop: false });
  const over = els.find('game-over');
  assert.equal(theme.paused, true);
  assert.equal(theme.currentTime, 0);
  assert.equal(over.paused, false);
  assert.equal(over.loop, false);
});

test('stopMusic() pauses and rewinds, and the next music() call starts fresh', () => {
  const { audio, els } = setup();
  audio.arm();
  audio.music('mainTheme');
  const theme = els.find('main-theme');
  theme.currentTime = 42;
  audio.stopMusic();
  assert.equal(theme.paused, true);
  assert.equal(theme.currentTime, 0);
  audio.music('mainTheme');
  assert.equal(theme.playCalls, 2);
  assert.equal(theme.currentTime, 0);
});

test('pauseMusic()/resumeMusic() keep the position', () => {
  const { audio, els } = setup();
  audio.arm();
  audio.music('mainTheme');
  const theme = els.find('main-theme');
  theme.currentTime = 7;
  audio.pauseMusic();
  assert.equal(theme.paused, true);
  assert.equal(theme.currentTime, 7);
  audio.resumeMusic();
  assert.equal(theme.paused, false);
  assert.equal(theme.currentTime, 7);
});

test('the muted flag is read from storage, persisted, and suppresses playback', () => {
  const storage = fakeStorage({ 'fm.muted': '1' });
  const { audio, els } = setup({ storage });
  assert.equal(audio.muted, true);
  audio.arm();
  audio.music('mainTheme');
  audio.sfx('boom');
  assert.equal(els.created.every((e) => e.playCalls === 0), true);

  audio.setMuted(false);
  assert.equal(storage.store['fm.muted'], '0');
  assert.equal(els.find('main-theme').paused, false, 'unmuting resumes the current music');

  audio.setMuted(true);
  assert.equal(storage.store['fm.muted'], '1');
  assert.equal(audio.muted, true);
  assert.equal(els.find('main-theme').paused, true, 'muting silences immediately');
});

test('setMuted(true) silences a playing sfx as well', () => {
  const { audio, els } = setup();
  audio.arm();
  audio.sfx('boom');
  const boom = els.find('boom');
  assert.equal(boom.paused, false);
  audio.setMuted(true);
  assert.equal(boom.muted === true || boom.paused === true, true);
});

test('a missing storage never breaks construction', () => {
  const els = fakeElements();
  const audio = createAudio('assets/audio/', MANIFEST, {
    makeElement: els.makeElement, storage: null, target: null, doc: null,
  });
  assert.equal(audio.muted, false);
  audio.setMuted(true);
  assert.equal(audio.muted, true);
});

test('sfx() fires onEnded when the clip finishes', () => {
  const { audio, els } = setup();
  audio.arm();
  let ended = 0;
  audio.sfx('boom', { onEnded: () => { ended += 1; } });
  const boom = els.find('boom');
  assert.equal(boom.paused, false);
  assert.equal(ended, 0);
  boom.finish();
  assert.equal(ended, 1);
  boom.finish();
  assert.equal(ended, 1, 'the handler is detached after it has run once');
});

test('stopSfx() cancels a pending onEnded', () => {
  const { audio, els } = setup();
  audio.arm();
  let ended = 0;
  audio.sfx('boom', { onEnded: () => { ended += 1; } });
  audio.stopSfx();
  const boom = els.find('boom');
  assert.equal(boom.paused, true);
  assert.equal(boom.currentTime, 0);
  boom.finish();
  assert.equal(ended, 0);
});

test('a rejecting play() is swallowed', async () => {
  const els = fakeElements();
  const rejecting = (url) => { const el = els.makeElement(url); el.rejectPlay = true; return el; };
  const audio = createAudio('assets/audio/', MANIFEST, {
    makeElement: rejecting, storage: fakeStorage(), target: null, doc: null,
  });
  audio.arm();
  assert.doesNotThrow(() => { audio.music('mainTheme'); audio.sfx('boom'); });
  await new Promise((r) => setImmediate(r)); // an unhandled rejection would fail the run here
});

test('a play() that throws synchronously is swallowed', () => {
  const throwing = () => ({
    src: '', loop: false, muted: false, currentTime: 0, paused: true, onended: null,
    play() { throw new Error('boom'); },
    pause() { this.paused = true; },
  });
  const audio = createAudio('assets/audio/', MANIFEST, {
    makeElement: throwing, storage: fakeStorage(), target: null, doc: null,
  });
  audio.arm();
  assert.doesNotThrow(() => { audio.music('mainTheme'); audio.sfx('boom'); });
});

test('an unknown key is ignored: no element, no throw', () => {
  const { audio, els } = setup();
  audio.arm();
  assert.doesNotThrow(() => {
    audio.music('nope');
    audio.sfx('alsoNope', { onEnded: () => { throw new Error('must not run'); } });
    audio.stopMusic();
  });
  assert.equal(els.created.length, 0);
});

test('an empty manifest leaves the game silent but working', () => {
  const els = fakeElements();
  const audio = createAudio('assets/audio/', undefined, {
    makeElement: els.makeElement, storage: fakeStorage(), target: null, doc: null,
  });
  audio.arm();
  assert.doesNotThrow(() => { audio.music('mainTheme'); audio.stopMusic(); audio.sfx('boom'); });
  assert.equal(els.created.length, 0);
});

test('hiding the tab pauses the music and showing it again resumes', () => {
  const els = fakeElements();
  const doc = { hidden: false, ...fakeTarget() };
  const audio = createAudio('assets/audio/', MANIFEST, {
    makeElement: els.makeElement, storage: fakeStorage(), target: null, doc,
  });
  audio.arm();
  audio.music('mainTheme');
  const theme = els.find('main-theme');
  theme.currentTime = 9;
  doc.hidden = true;
  doc.fire('visibilitychange');
  assert.equal(theme.paused, true);
  assert.equal(theme.currentTime, 9, 'hiding does not rewind');
  doc.hidden = false;
  doc.fire('visibilitychange');
  assert.equal(theme.paused, false);
});

test('a hidden tab does not resume music that is muted or stopped', () => {
  const els = fakeElements();
  const doc = { hidden: false, ...fakeTarget() };
  const audio = createAudio('assets/audio/', MANIFEST, {
    makeElement: els.makeElement, storage: fakeStorage(), target: null, doc,
  });
  audio.arm();
  audio.music('mainTheme');
  audio.setMuted(true);
  doc.hidden = true; doc.fire('visibilitychange');
  doc.hidden = false; doc.fire('visibilitychange');
  assert.equal(els.find('main-theme').paused, true);

  audio.setMuted(false);
  audio.stopMusic();
  doc.hidden = true; doc.fire('visibilitychange');
  doc.hidden = false; doc.fire('visibilitychange');
  assert.equal(els.find('main-theme').paused, true);
});
