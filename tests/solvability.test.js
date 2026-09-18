import test from 'node:test';
import assert from 'node:assert/strict';
import { findSafePath } from './helpers/solver.js';

const SEEDS = +(process.env.SOLVER_SEEDS || 12);
const FRAMES = +(process.env.SOLVER_FRAMES || 3600);   // 60 s = 3 full cycles
for (const startShift of [0, 6, 12, 25]) {
  test(`solvable: ${SEEDS} seeds x ${FRAMES} frames at startShift ${startShift}`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = findSafePath(seed * 1000 + startShift, FRAMES, { startShift });
      assert.ok(r.ok, `seed ${seed * 1000 + startShift} shift ${startShift}: no safe path, died at frame ${r.diedAtFrame}`);
    }
  });
}
test('solver sanity: an impossible world is reported as unsolvable', async () => {
  const { solveAgainst } = await import('./helpers/solver.js');
  const wall = Array.from({ length: 300 }, () => Array.from({ length: 40 }, (_, i) => [300, i * 12, 40]).flat());
  // a solid wall at x=300 does not kill someone standing to its left — so we move it towards the player:
  const moving = wall.map((fr, f) => fr.map((v, i) => (i % 3 === 0 ? 700 - f * 5 : v)));
  assert.equal(solveAgainst(moving, {}).ok, false);
});
