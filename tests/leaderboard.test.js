import test from 'node:test';
import assert from 'node:assert/strict';
import { topTen } from '../js/services/leaderboard.js';

const names = (rows) => rows.map((r) => r.name);

test('topTen sorts by score descending', () => {
  const rows = topTen([
    { name: 'a', score: 10 },
    { name: 'b', score: 300 },
    { name: 'c', score: 50 },
  ]);
  assert.deepEqual(names(rows), ['B', 'C', 'A']);
  assert.deepEqual(rows[0], { name: 'B', score: 300 });
});

test('topTen shows every name in capitals without touching the order', () => {
  const rows = topTen([
    { name: 'bob', score: 10 },
    { name: 'Lein', score: 300 },
    { name: 'poTATo', score: 50 },
  ]);
  assert.deepEqual(rows, [
    { name: 'LEIN', score: 300 },
    { name: 'POTATO', score: 50 },
    { name: 'BOB', score: 10 },
  ]);
});

test('topTen keeps the earlier entry first on a tie', () => {
  const rows = topTen([
    { name: 'first', score: 100 },
    { name: 'second', score: 100 },
    { name: 'third', score: 100 },
  ]);
  assert.deepEqual(names(rows), ['FIRST', 'SECOND', 'THIRD']);
});

test('topTen trims to ten rows', () => {
  const src = [];
  for (let i = 0; i < 25; i++) src.push({ name: `n${i}`, score: i });
  const rows = topTen(src);
  assert.equal(rows.length, 10);
  assert.deepEqual(names(rows), ['N24', 'N23', 'N22', 'N21', 'N20', 'N19', 'N18', 'N17', 'N16', 'N15']);
});

test('topTen is pure: it does not reorder its input', () => {
  const src = [{ name: 'a', score: 1 }, { name: 'b', score: 2 }];
  const copy = src.map((e) => ({ ...e }));
  topTen(src);
  assert.deepEqual(src, copy);
});

test('topTen skips junk entries and normalizes the rows', () => {
  const rows = topTen([
    null,
    'nonsense',
    { name: 'ok', score: 5 },
    { name: '', score: 99 },
    { name: 'nan', score: Number.NaN },
    { name: 'floaty', score: 7.9 },
  ]);
  assert.deepEqual(rows, [{ name: 'FLOATY', score: 7 }, { name: 'OK', score: 5 }]);
});

test('topTen tolerates a missing list', () => {
  assert.deepEqual(topTen(undefined), []);
  assert.deepEqual(topTen(null), []);
  assert.deepEqual(topTen('not an array'), []);
});

// ---------------------------------------------------------------------------
// The service itself, driven through a fake backend: no Firebase, no network.
// `createLeaderboard` is the seam — the real one only differs in `loadBackend`.

import { createLeaderboard } from '../js/services/leaderboard.js';

function fakeBackend(rows = [], { onAdd } = {}) {
  const calls = { top: 0, add: [] };
  const backend = {
    async top(limit) { calls.top += 1; return rows.slice(0, limit); },
    async add(name, score) { calls.add.push({ name, score }); if (onAdd) await onAdd(name, score); },
  };
  return { backend, calls, loadBackend: async () => backend };
}

function denied() {
  const err = new Error('Missing or insufficient permissions.');
  err.code = 'permission-denied';
  return err;
}

test('fetchTop10 maps the rows and keeps the score order', async () => {
  const { loadBackend, calls } = fakeBackend([
    { name: 'AAA', score: 300, createdAt: 'ignored' },
    { name: 'BBB', score: 50 },
    { name: 'CCC', score: 10 },
  ]);
  const lb = createLeaderboard({ loadBackend });
  assert.deepEqual(await lb.fetchTop10(), [
    { name: 'AAA', score: 300 }, { name: 'BBB', score: 50 }, { name: 'CCC', score: 10 },
  ]);
  assert.equal(calls.top, 1);
});

test('fetchTop10 rejects with offline when the backend cannot be loaded', async () => {
  const lb = createLeaderboard({ loadBackend: async () => { throw new Error('import failed'); } });
  await assert.rejects(lb.fetchTop10(), (e) => e.message === 'offline');
});

test('a failed backend load is retried, not cached', async () => {
  let attempts = 0;
  const lb = createLeaderboard({
    loadBackend: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('CDN blocked');
      return { async top() { return [{ name: 'Late', score: 7 }]; }, async add() {} };
    },
  });
  await assert.rejects(lb.fetchTop10(), (e) => e.message === 'offline');
  await assert.rejects(lb.fetchTop10(), (e) => e.message === 'offline');
  assert.deepEqual(await lb.fetchTop10(), [{ name: 'LATE', score: 7 }]);
  assert.equal(attempts, 3);
});

test('a hanging request times out as offline', async () => {
  const lb = createLeaderboard({ timeoutMs: 20, loadBackend: async () => ({
    top: () => new Promise(() => {}),        // never settles
    add: () => new Promise(() => {}),
  }) });
  await assert.rejects(lb.fetchTop10(), (e) => e.message === 'offline');
  await assert.rejects(lb.submitScore('Lein', 100), (e) => e.message === 'offline');
});

test('permission-denied from the rules maps to denied', async () => {
  const lb = createLeaderboard({ loadBackend: async () => ({
    async top() { throw denied(); },
    async add() { throw denied(); },
  }) });
  await assert.rejects(lb.fetchTop10(), (e) => e.message === 'denied');
  await assert.rejects(lb.submitScore('Lein', 100), (e) => e.message === 'denied');
});

test('submitScore writes the trimmed name and a floored score', async () => {
  const { loadBackend, calls } = fakeBackend();
  const lb = createLeaderboard({ loadBackend });
  await lb.submitScore('  Lein  ', 2601.9);
  assert.deepEqual(calls.add, [{ name: 'LEIN', score: 2601 }]);
});

test('submitScore sends the name in capitals', async () => {
  const { loadBackend, calls } = fakeBackend();
  const lb = createLeaderboard({ loadBackend, cooldownMs: 0 });
  await lb.submitScore('bob', 10);
  await lb.submitScore('poTATo', 20);
  assert.deepEqual(calls.add, [{ name: 'BOB', score: 10 }, { name: 'POTATO', score: 20 }]);
});

test('submitScore validates before touching the network', async () => {
  const { loadBackend, calls } = fakeBackend();
  const lb = createLeaderboard({ loadBackend });
  for (const bad of ['ab', 'abcdefg', 'a b', 'Панда', 'a_b', '']) {
    await assert.rejects(lb.submitScore(bad, 100), (e) => e.message === 'invalid');
  }
  for (const bad of [0, -5, 0.5, Number.NaN, 10_000_000, Infinity]) {
    await assert.rejects(lb.submitScore('Lein', bad), (e) => e.message === 'invalid');
  }
  assert.deepEqual(calls.add, []);
});

test('submitScore accepts the score range boundaries', async () => {
  const { loadBackend, calls } = fakeBackend();
  const lb = createLeaderboard({ loadBackend, cooldownMs: 0 });
  await lb.submitScore('Lein', 1);
  await lb.submitScore('Lein', 9_999_999);
  assert.deepEqual(calls.add, [{ name: 'LEIN', score: 1 }, { name: 'LEIN', score: 9_999_999 }]);
});

test('a second submit inside 10 seconds is a cooldown, and nothing is sent', async () => {
  const { loadBackend, calls } = fakeBackend();
  let clock = 1_000_000;
  const lb = createLeaderboard({ loadBackend, now: () => clock });
  await lb.submitScore('Lein', 100);
  clock += 9_999;
  await assert.rejects(lb.submitScore('Lein', 200), (e) => e.message === 'cooldown');
  assert.equal(calls.add.length, 1);
  clock += 1;
  await lb.submitScore('Lein', 200);
  assert.deepEqual(calls.add, [{ name: 'LEIN', score: 100 }, { name: 'LEIN', score: 200 }]);
});

test('the cooldown clock only starts after a write that succeeded', async () => {
  let fail = true;
  let clock = 0;
  const calls = [];
  const lb = createLeaderboard({
    now: () => clock,
    loadBackend: async () => ({
      async top() { return []; },
      async add(name, score) { if (fail) throw new Error('network down'); calls.push({ name, score }); },
    }),
  });
  await assert.rejects(lb.submitScore('Lein', 100), (e) => e.message === 'offline');
  fail = false;
  await lb.submitScore('Lein', 100);            // a retry straight away must go through
  assert.deepEqual(calls, [{ name: 'LEIN', score: 100 }]);
});

test('isOnline follows the config and navigator.onLine', async () => {
  assert.equal(createLeaderboard({ hasConfig: () => false }).isOnline(), false);
  assert.equal(createLeaderboard({ hasConfig: () => true }).isOnline(), true);
});
