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
  assert.deepEqual(names(rows), ['b', 'c', 'a']);
  assert.deepEqual(rows[0], { name: 'b', score: 300 });
});

test('topTen keeps the earlier entry first on a tie', () => {
  const rows = topTen([
    { name: 'first', score: 100 },
    { name: 'second', score: 100 },
    { name: 'third', score: 100 },
  ]);
  assert.deepEqual(names(rows), ['first', 'second', 'third']);
});

test('topTen trims to ten rows', () => {
  const src = [];
  for (let i = 0; i < 25; i++) src.push({ name: `n${i}`, score: i });
  const rows = topTen(src);
  assert.equal(rows.length, 10);
  assert.deepEqual(names(rows), ['n24', 'n23', 'n22', 'n21', 'n20', 'n19', 'n18', 'n17', 'n16', 'n15']);
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
  assert.deepEqual(rows, [{ name: 'floaty', score: 7 }, { name: 'ok', score: 5 }]);
});

test('topTen tolerates a missing list', () => {
  assert.deepEqual(topTen(undefined), []);
  assert.deepEqual(topTen(null), []);
  assert.deepEqual(topTen('not an array'), []);
});
