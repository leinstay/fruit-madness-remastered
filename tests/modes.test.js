// tests/modes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODES, spawnEnemy, stepEnemy, isOffscreen } from '../js/game/modes.js';
import { W, H } from '../js/config.js';

test('mode 1: from right, lane centers, speed 7+d', () => {
  const e = spawnEnemy(1, 0, 0.2);
  assert.equal(e.x, W + e.size); assert.equal(e.y, 45); assert.equal(e.vx, -7.2); assert.equal(e.vy, 0);
  assert.equal(spawnEnemy(1, 4, 0).y, 405);
});
test('mode 3: from top, moves down at 5+d', () => {
  const e = spawnEnemy(3, 2, 0); assert.equal(e.x, 300); assert.equal(e.vy, 5);
});
test('mode 5: diagonal down-right with 2/3 slope', () => {
  const e = spawnEnemy(5, 2, 0); assert.equal(e.vx, 4); assert.ok(Math.abs(e.vy - 8 / 3) < 1e-9);
  assert.ok(e.x < 0 && e.y < 0);
});
test('every mode names the side or corner its attack comes from, and nothing else', () => {
  assert.deepEqual(MODES[1].danger, { kind: 'side', side: 'right' });
  assert.deepEqual(MODES[2].danger, { kind: 'side', side: 'left' });
  assert.deepEqual(MODES[3].danger, { kind: 'side', side: 'top' });
  assert.deepEqual(MODES[4].danger, { kind: 'side', side: 'bottom' });
  assert.deepEqual(MODES[5].danger, { kind: 'corner', corner: 'tl' });
  assert.deepEqual(MODES[6].danger, { kind: 'corner', corner: 'br' });
  assert.deepEqual(MODES[7].danger, { kind: 'corner', corner: 'tr' });
  assert.deepEqual(MODES[8].danger, { kind: 'corner', corner: 'bl' });
  // The warning is a description of the attack, never a position or a drawing: where the
  // sign goes is the scene's business.
  for (const [id, mode] of Object.entries(MODES)) {
    assert.deepEqual(Object.keys(mode.danger).sort(), mode.danger.kind === 'side'
      ? ['kind', 'side'] : ['corner', 'kind'], `mode ${id} carries presentation data`);
  }
});

test('the danger descriptor of a mode agrees with the direction it attacks from', () => {
  const SIDE = { right: [-1, 0], left: [1, 0], top: [0, 1], bottom: [0, -1] };
  const CORNER = { tl: [1, 1], tr: [-1, 1], bl: [1, -1], br: [-1, -1] };
  for (const [id, mode] of Object.entries(MODES)) {
    const [vx, vy] = mode.vel(0);
    const want = mode.danger.kind === 'side' ? SIDE[mode.danger.side] : CORNER[mode.danger.corner];
    assert.ok(want, `mode ${id}: unknown descriptor`);
    assert.equal(Math.sign(vx), want[0], `mode ${id}: vx`);
    assert.equal(Math.sign(vy), want[1], `mode ${id}: vy`);
  }
});

test('every mode eventually crosses the field and leaves', () => {
  for (const id of Object.keys(MODES)) for (let lane = 0; lane < 5; lane++) {
    const e = spawnEnemy(+id, lane, 0); let entered = false;
    for (let i = 0; i < 600 && !(entered && isOffscreen(e)); i++) {
      stepEnemy(e); if (e.x > 0 && e.x < W && e.y > 0 && e.y < H) entered = true;
    }
    assert.ok(entered, `mode ${id} lane ${lane} never entered`);
    assert.ok(isOffscreen(e), `mode ${id} lane ${lane} never left`);
  }
});
