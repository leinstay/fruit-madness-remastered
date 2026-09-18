// js/game/player.js — the order of operations is the same as in Player.as: acceleration -> move -> tilt -> speed clamp -> bounds
import { W, H, PLAYER } from '../config.js';
export function createPlayer() { return { x: W / 5, y: H / 2, vx: 0, vy: 0, rotation: 0 }; }
export function stepPlayer(p, input, hasFuel) {
  const max = hasFuel ? PLAYER.MAX_SPEED : PLAYER.EMPTY_MAX_SPEED;
  const fr = hasFuel ? PLAYER.FRICTION : PLAYER.EMPTY_FRICTION;
  if (input.left) p.vx -= PLAYER.ACCEL; else if (input.right) p.vx += PLAYER.ACCEL; else p.vx *= fr;
  if (input.up) p.vy -= PLAYER.ACCEL; else if (input.down) p.vy += PLAYER.ACCEL; else p.vy *= fr;
  p.x += p.vx; p.y += p.vy; p.rotation = p.vx;
  p.vx = Math.max(-max, Math.min(max, p.vx));
  p.vy = Math.max(-max, Math.min(max, p.vy));
  p.x = Math.max(PLAYER.HALF_W, Math.min(W - PLAYER.HALF_W, p.x));
  p.y = Math.max(PLAYER.HALF_H, Math.min(H - PLAYER.HALF_H, p.y));
}
