import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, stepPlayer } from '../js/game/player.js';
import { W, H, PLAYER } from '../js/config.js';
const none = { up: false, down: false, left: false, right: false };

test('starts at W/5, H/2 at rest', () => {
  const p = createPlayer();
  assert.deepEqual([p.x, p.y, p.vx, p.vy], [W / 5, H / 2, 0, 0]);
});
test('original quirk: move happens before clamp (13 frames right = 45.5px)', () => {
  const p = createPlayer(); const x0 = p.x;
  for (let i = 0; i < 13; i++) stepPlayer(p, { ...none, right: true }, true);
  assert.equal(p.x - x0, 45.5);   // 0.5+1+...+6 = 39, then 6.5
  assert.equal(p.vx, 6);
});
test('friction 0.93 when released', () => {
  const p = createPlayer(); p.vx = 6;
  stepPlayer(p, none, true);
  assert.ok(Math.abs(p.vx - 5.58) < 1e-9);
});
test('left wins over right, up wins over down (as original)', () => {
  const p = createPlayer();
  stepPlayer(p, { up: true, down: true, left: true, right: true }, true);
  assert.equal(p.vx, -0.5); assert.equal(p.vy, -0.5);
});
test('rotation equals vx', () => {
  const p = createPlayer(); stepPlayer(p, { ...none, right: true }, true);
  assert.equal(p.rotation, 0.5);
});
test('no fuel: max speed 0.5, friction 0.99', () => {
  const p = createPlayer(); p.vx = 0.4;
  stepPlayer(p, none, false);
  assert.ok(Math.abs(p.vx - 0.396) < 1e-9);
  for (let i = 0; i < 10; i++) stepPlayer(p, { ...none, right: true }, false);
  assert.equal(p.vx, PLAYER.EMPTY_MAX_SPEED);
});
test('stays inside the field', () => {
  const p = createPlayer();
  for (let i = 0; i < 300; i++) stepPlayer(p, { ...none, left: true, up: true }, true);
  assert.equal(p.x, PLAYER.HALF_W); assert.equal(p.y, PLAYER.HALF_H);
});
