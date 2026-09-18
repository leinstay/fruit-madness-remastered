// The leaderboard service.
//
// This is the offline stub: the top 10 lives in localStorage['fm.scores'] so the whole UI
// (game over -> submit -> highlighted row) can be built and checked before Firebase exists.
// Task 13 replaces the three exported calls with Firestore ones; their names, arguments and
// return types are fixed here so the scenes never have to change.
//
// The module must import cleanly in Node (where there is no localStorage), so storage is
// only ever touched lazily, inside a try/catch.

const STORAGE_KEY = 'fm.scores';
const LIMIT = 10;

/** localStorage when it exists and is reachable, otherwise null (Node, private mode, …). */
function storage() {
  try {
    const ls = globalThis.localStorage;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch {
    return null; // Some browsers throw on access when site data is blocked.
  }
}

/**
 * topTen(entries) -> [{ name, score }] — pure: drops malformed rows, sorts by score
 * descending keeping the earlier entry first on a tie, and trims to ten. The one piece of
 * logic Task 13 keeps as is, so it is unit-tested on its own.
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

function readAll() {
  const ls = storage();
  if (!ls) return [];
  try {
    const parsed = JSON.parse(ls.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** True when scores can be read and written. Task 13: a Firebase config plus the network. */
export function isOnline() {
  return storage() !== null;
}

/** fetchTop10() -> Promise<{name,score}[]>; rejects with Error('offline') like Task 13 will. */
export async function fetchTop10() {
  if (!isOnline()) throw new Error('offline');
  return topTen(readAll());
}

/** submitScore(name, score) -> Promise<void>. Rejects with Error('offline'). */
export async function submitScore(name, score) {
  const ls = storage();
  if (!ls) throw new Error('offline');
  const entry = { name: String(name), score: Math.floor(Number(score)) || 0, createdAt: Date.now() };
  const all = readAll();
  all.push(entry);
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    throw new Error('offline', { cause: err });
  }
}
