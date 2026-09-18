// The shared starfield background — a port of the original Star.as:
// 60 stars, x -= 2..4 per tick, a random alpha, respawned at the right edge.
// Visual-only randomness, so Math.random() is allowed here (js/game/* is not).
import { W, H } from '../config.js';
import { drawSprite } from '../core/assets.js';

const SPEED_MIN = 2, SPEED_MAX = 4;

function respawn(star, x) {
  star.x = x;
  star.y = Math.random() * H;
  star.speed = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
  star.alpha = 0.2 + Math.random() * 0.8;
}

export function createStarfield(count = 60) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    const star = { x: 0, y: 0, speed: 0, alpha: 1 };
    respawn(star, Math.random() * W);
    stars.push(star);
  }

  function update() {
    for (const star of stars) {
      star.x -= star.speed;
      if (star.x < -8) respawn(star, W + Math.random() * 8);
    }
  }

  function render(ctx, assets) {
    ctx.save();
    for (const star of stars) {
      ctx.globalAlpha = star.alpha;
      if (assets && assets.has && assets.has('star')) {
        drawSprite(ctx, assets, 'star', 0, star.x, star.y);
      } else {
        ctx.fillStyle = '#fff';
        ctx.fillRect(Math.round(star.x), Math.round(star.y), 2, 2);
      }
    }
    ctx.restore();
  }

  return { stars, update, render };
}
