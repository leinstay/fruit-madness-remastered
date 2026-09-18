// The leaderboard service, backed by Cloud Firestore (project `fruit-madness-52222`).
//
// The three calls the scenes use — fetchTop10(), submitScore(), isOnline() — keep the exact
// shape the offline stub of Task 11 had, so no scene logic changes. Everything that can go
// wrong (no config, the CDN blocked, no network, rules rejecting the write, a hung request)
// surfaces as a rejected Error whose `message` is one of:
//
//   'offline'  — nothing could be reached, or the request timed out
//   'cooldown' — a score was sent less than COOLDOWN_MS ago
//   'invalid'  — the nickname or the score did not pass the local checks
//   'denied'   — the server rules refused the write
//
// Nothing Firebase-related runs at import time: the SDK is pulled from the gstatic CDN by a
// lazy dynamic import() on first use. That keeps the Node tests DOM-free and lets the game
// boot instantly (and completely) with no network at all. A failed load is never cached, so
// the next attempt tries again.

import { FIREBASE_CONFIG, FIRESTORE_DB_ID, SCORE_MAX } from '../config.js';
import { validateNick } from '../game/nick.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const COLLECTION = 'scores';
const LIMIT = 10;
const COOLDOWN_MS = 10_000;
const TIMEOUT_MS = 8_000;       // a hanging request must show OFFLINE, not LOADING... forever

/**
 * topTen(entries) -> [{ name, score }] — pure: drops malformed rows, sorts by score
 * descending keeping the earlier entry first on a tie, and trims to ten. Firestore already
 * returns the rows ordered and limited; running them through this keeps the table sane even
 * if a stray document ever slips past the rules.
 */
export function topTen(entries, limit = LIMIT) {
  if (!Array.isArray(entries)) return [];
  const clean = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const name = typeof e.name === 'string' ? e.name : '';
    const score = Math.floor(Number(e.score));
    if (!name || !Number.isFinite(score)) continue;
    clean.push({ name, score, order: clean.length });
  }
  // Array.prototype.sort is stable, but the explicit tiebreak keeps the intent readable.
  clean.sort((a, b) => (b.score - a.score) || (a.order - b.order));
  return clean.slice(0, limit).map(({ name, score }) => ({ name, score }));
}

/** 'denied' for a rules rejection, 'offline' for everything else (network, CDN, timeout). */
function classify(err) {
  const code = String((err && (err.code || err.message)) || '');
  if (/permission[-_ ]denied|PERMISSION_DENIED/i.test(code)) return 'denied';
  if (/^(offline|denied|invalid|cooldown)$/.test(code)) return code;
  return 'offline';
}

/** Rejects with Error('offline') when `promise` takes longer than `ms`. */
function withTimeout(promise, ms) {
  if (!(ms > 0)) return promise;
  let timer = null;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('offline')), ms);
  });
  // The race always settles (at the latest when the timer fires), and clearing the timer
  // there is what keeps a pending guard from holding the event loop open afterwards.
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * The real backend: loads the Firebase web SDK from the CDN and wraps the two operations the
 * game needs. Everything Firebase-specific lives here, which is what makes the service
 * testable in Node with a fake backend.
 */
async function loadFirestoreBackend() {
  if (!FIREBASE_CONFIG) throw new Error('offline');
  const { initializeApp, getApps, getApp } = await import(`${SDK}/firebase-app.js`);
  const fs = await import(`${SDK}/firebase-firestore-lite.js`);
  const app = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
  // The project's database is the named one `fruit-madness`, not `(default)`.
  const db = FIRESTORE_DB_ID ? fs.getFirestore(app, FIRESTORE_DB_ID) : fs.getFirestore(app);
  const scores = () => fs.collection(db, COLLECTION);
  return {
    async top(limit) {
      // orderBy('score') + limit is served by the automatic single-field index: no composite
      // index has to be created in the console for this query.
      const snap = await fs.getDocs(fs.query(scores(), fs.orderBy('score', 'desc'), fs.limit(limit)));
      return snap.docs.map((d) => {
        const data = d.data();
        return { name: data.name, score: data.score };
      });
    },
    async add(name, score) {
      await fs.addDoc(scores(), { name, score, createdAt: fs.serverTimestamp() });
    },
  };
}

/**
 * createLeaderboard({ loadBackend, now, timeoutMs, cooldownMs }) — the service itself.
 * `loadBackend()` resolves to `{ top(limit), add(name, score) }`; the tests pass a fake one.
 */
export function createLeaderboard({
  loadBackend = loadFirestoreBackend,
  now = () => Date.now(),
  timeoutMs = TIMEOUT_MS,
  cooldownMs = COOLDOWN_MS,
  hasConfig = () => Boolean(FIREBASE_CONFIG),
} = {}) {
  let backendPromise = null;
  let lastSubmit = -Infinity;

  /** The loaded backend. A rejected load is dropped, so a later call can try the CDN again. */
  function backend() {
    if (!backendPromise) {
      backendPromise = (async () => loadBackend())();
      backendPromise.catch(() => { backendPromise = null; });
    }
    return backendPromise;
  }

  /** True when a score could plausibly be read or written right now. */
  function isOnline() {
    if (!hasConfig()) return false;
    const nav = globalThis.navigator;
    return !(nav && nav.onLine === false);
  }

  /** fetchTop10() -> Promise<{name,score}[]>; rejects with Error('offline'|'denied'). */
  async function fetchTop10() {
    try {
      const rows = await withTimeout((async () => (await backend()).top(LIMIT))(), timeoutMs);
      return topTen(rows);
    } catch (err) {
      backendPromise = null;    // a broken app/db handle must not be reused
      throw new Error(classify(err), { cause: err });
    }
  }

  /**
   * submitScore(name, score) -> Promise<void>. The nickname and the score range are checked
   * before anything touches the network, so a typo never costs a request; the cooldown clock
   * only starts after a write that actually succeeded.
   */
  async function submitScore(name, score) {
    const nick = validateNick(name);
    const value = Math.floor(Number(score));
    if (!nick.ok) throw new Error('invalid');
    if (!Number.isFinite(value) || value <= 0 || value > SCORE_MAX) throw new Error('invalid');
    if (now() - lastSubmit < cooldownMs) throw new Error('cooldown');
    try {
      await withTimeout((async () => (await backend()).add(nick.value, value))(), timeoutMs);
    } catch (err) {
      backendPromise = null;
      throw new Error(classify(err), { cause: err });
    }
    lastSubmit = now();
  }

  return { fetchTop10, submitScore, isOnline, topTen };
}

// The instance the scenes import. `__setBackendForTests` swaps the SDK loader in Node.
let service = createLeaderboard();

export function fetchTop10() { return service.fetchTop10(); }
export function submitScore(name, score) { return service.submitScore(name, score); }
export function isOnline() { return service.isOnline(); }

/** Test seam: pass a fake `loadBackend`, or nothing to restore the real Firestore one. */
export function __setBackendForTests(options) {
  service = createLeaderboard(options || {});
}
