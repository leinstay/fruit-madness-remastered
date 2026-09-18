// Music and sound effects, built on HTMLAudioElement.
//
// Why plain <audio> and not the Web Audio API: no decoding step, no CORS requirement, and
// the owner can move assets/audio/ to any host by changing AUDIO_BASE_URL in js/config.js.
//
// Two rules shape the whole module:
//   1. Sound is optional. A missing key, a missing file, a blocked localStorage or a
//      rejected play() must never throw and never spam the console — the game stays fully
//      playable in silence.
//   2. Browsers refuse to play before a user gesture. Nothing is started until the first
//      pointerdown/keydown; a music() call made earlier is remembered and starts then.
//
// The decision logic is DOM-free: the element factory, the storage and the event targets
// are all injectable, which is what tests/audio.test.js exercises.

const MUTED_KEY = 'fm.muted';

/**
 * Resolves one manifest audio entry against the audio base URL.
 * Only the file name is kept, so pointing AUDIO_BASE_URL at another host moves every clip.
 * An empty base URL means "use the manifest path as it stands".
 */
export function resolveAudioUrl(baseUrl, entry) {
  const file = String(entry || '');
  if (!baseUrl) return file;
  const name = file.slice(file.lastIndexOf('/') + 1);
  return baseUrl.endsWith('/') ? `${baseUrl}${name}` : `${baseUrl}/${name}`;
}

function defaultMakeElement(url) {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('audio');
  el.preload = 'auto';
  el.src = url;
  return el;
}

function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null; // site data blocked: the mute flag simply will not survive a reload
  }
}

/**
 * @param {string} baseUrl            AUDIO_BASE_URL
 * @param {object} manifestAudio      the already-loaded manifest's `audio` map
 * @param {object} [opts]             { makeElement, storage, target, doc } — injection points
 */
export function createAudio(baseUrl, manifestAudio = {}, opts = {}) {
  const files = manifestAudio && typeof manifestAudio === 'object' ? manifestAudio : {};
  const makeElement = opts.makeElement || defaultMakeElement;
  const storage = 'storage' in opts ? opts.storage : defaultStorage();
  const target = 'target' in opts ? opts.target : globalThis;
  const doc = 'doc' in opts ? opts.doc : (typeof document === 'undefined' ? null : document);

  const elements = new Map();
  let armed = false;
  let muted = readMuted();
  let wanted = null;        // { name, loop } — the track that should be playing
  let scenePaused = false;  // the game scene is paused
  let hidden = false;       // the tab is in the background
  let currentSfx = null;

  function readMuted() {
    try {
      return !!storage && storage.getItem(MUTED_KEY) === '1';
    } catch {
      return false;
    }
  }

  function persistMuted(value) {
    try {
      if (storage) storage.setItem(MUTED_KEY, value ? '1' : '0');
    } catch { /* nothing we can do */ }
  }

  /** Lazily creates (and caches) the element for a manifest key; null when unknown. */
  function element(name) {
    if (elements.has(name)) return elements.get(name);
    const entry = files[name];
    if (!entry) return null;
    let el = null;
    try {
      el = makeElement(resolveAudioUrl(baseUrl, entry));
    } catch {
      el = null;
    }
    if (!el) return null;
    el.muted = muted;
    elements.set(name, el);
    return el;
  }

  function safePlay(el) {
    try {
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* autoplay blocked, or no decoder for the file */ }
  }

  function safePause(el) {
    try { el.pause(); } catch { /* ignore */ }
  }

  function rewind(el) {
    try { el.currentTime = 0; } catch { /* seeking before metadata can throw */ }
  }

  const musicShouldPlay = () => !!wanted && armed && !muted && !scenePaused && !hidden;

  /** The single place that decides whether the current track runs. */
  function applyMusicState() {
    if (!wanted) return;
    const el = element(wanted.name);
    if (!el) return;
    if (musicShouldPlay()) {
      if (el.paused) safePlay(el);
    } else if (!el.paused) {
      safePause(el);
    }
  }

  function music(name, { loop = true } = {}) {
    if (wanted && wanted.name === name) {
      if (wanted.loop !== loop) {
        wanted.loop = loop;
        const same = element(name);
        if (same) same.loop = loop;
      }
      applyMusicState();   // already the current track: never restarted
      return;
    }
    stopMusic();
    if (!files[name]) return;   // unknown key: stay silent, remember nothing
    wanted = { name, loop };
    const el = element(name);
    if (!el) { wanted = null; return; }
    el.loop = loop;
    rewind(el);
    applyMusicState();
  }

  /** Stops the music for good: the next music() call starts from the beginning. */
  function stopMusic() {
    if (!wanted) return;
    const el = elements.get(wanted.name);
    if (el) { safePause(el); rewind(el); }
    wanted = null;
  }

  /** Pauses without forgetting the track or its position (game pause). */
  function pauseMusic() {
    scenePaused = true;
    applyMusicState();
  }

  function resumeMusic() {
    scenePaused = false;
    applyMusicState();
  }

  function sfx(name, { onEnded } = {}) {
    const el = element(name);
    if (!el) return;
    if (!armed || muted) return;   // silence means silence: onEnded does not fire either
    currentSfx = el;
    el.loop = false;
    rewind(el);
    el.onended = function handle() {
      el.onended = null;
      if (currentSfx === el) currentSfx = null;
      if (typeof onEnded === 'function') {
        try { onEnded(); } catch { /* a scene callback must not break playback */ }
      }
    };
    safePlay(el);
  }

  /** Stops a playing effect and cancels its pending onEnded (leaving a scene). */
  function stopSfx() {
    const el = currentSfx;
    currentSfx = null;
    if (!el) return;
    el.onended = null;
    safePause(el);
    rewind(el);
  }

  function setMuted(value) {
    muted = !!value;
    persistMuted(muted);
    for (const el of elements.values()) el.muted = muted;
    if (muted) stopSfx();
    applyMusicState();
  }

  /** The first user gesture: everything that was requested earlier starts now. */
  function arm() {
    if (armed) return;
    armed = true;
    detachGesture();
    applyMusicState();
  }

  let detachGesture = () => {};
  if (target && typeof target.addEventListener === 'function') {
    const onGesture = () => arm();
    target.addEventListener('pointerdown', onGesture);
    target.addEventListener('keydown', onGesture);
    detachGesture = () => {
      try {
        target.removeEventListener('pointerdown', onGesture);
        target.removeEventListener('keydown', onGesture);
      } catch { /* ignore */ }
    };
  }

  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', () => {
      hidden = !!doc.hidden;
      applyMusicState();
    });
  }

  return {
    music,
    stopMusic,
    pauseMusic,
    resumeMusic,
    sfx,
    stopSfx,
    setMuted,
    arm,
    get muted() { return muted; },
    get playing() { return wanted ? wanted.name : null; },
    // Exposed for checking the game by hand in the browser console.
    get elements() { return elements; },
  };
}
