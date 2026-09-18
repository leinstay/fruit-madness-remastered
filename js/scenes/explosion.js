// The death blast — a port of the original Explosion.as.
//
// The 2013 game has no explosion sprite: it draws the blast with flash.display.Graphics as
// a few hundred white circles that fly apart and fade (see docs/assets-inventory.md). So do
// we. This is purely visual, so Math.random() is allowed here (js/game/* is not).

const COUNT_MIN = 300, COUNT_MAX = 600;
const RADIUS_MIN = 1, RADIUS_MAX = 3;
const SPEED = 6;        // base velocity range, per axis
const BOOST = 5;        // extra velocity some particles get, per axis
const BOOST_CHANCE = 0.37;
const FADE = 0.005;     // alpha lost per 60 Hz tick

const between = (lo, hi) => lo + Math.random() * (hi - lo);

export function createExplosion(x, y) {
  const particles = [];
  const count = Math.round(between(COUNT_MIN, COUNT_MAX));
  for (let i = 0; i < count; i++) {
    let vx = between(-SPEED, SPEED);
    let vy = between(-SPEED, SPEED);
    if (Math.random() < BOOST_CHANCE) {
      vx += between(-BOOST, BOOST);
      vy += between(-BOOST, BOOST);
    }
    particles.push({ x, y, vx, vy, r: between(RADIUS_MIN, RADIUS_MAX), alpha: Math.random() });
  }

  function update() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= FADE;
      if (p.alpha <= 0) particles.splice(i, 1);
    }
  }

  function render(ctx) {
    if (particles.length === 0) return;
    ctx.save();
    ctx.fillStyle = '#fff';
    for (const p of particles) {
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return { particles, update, render, get done() { return particles.length === 0; } };
}
