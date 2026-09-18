// The on-screen half of the touch joystick: a translucent ring where the thumb landed and
// a knob inside it showing the current direction. Everything it needs is already in canvas
// coordinates (js/core/input.js converts from CSS pixels with the canvas transform), so this
// is pure drawing — and it draws nothing at all when the game is being played on a keyboard.
const TAU = Math.PI * 2;
const RING_FILL = 'rgba(255, 255, 255, 0.07)';
const RING_STROKE = 'rgba(255, 255, 255, 0.30)';
const KNOB_FILL = 'rgba(255, 225, 77, 0.35)';
const KNOB_STROKE = 'rgba(255, 225, 77, 0.65)';
const KNOB_RADIUS = 15;

export function drawJoystick(ctx, joystick) {
  if (!joystick || !joystick.active) return;
  const r = joystick.radius > 0 ? joystick.radius : 40;
  ctx.save();
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(joystick.x, joystick.y, r, 0, TAU);
  ctx.fillStyle = RING_FILL;
  ctx.fill();
  ctx.strokeStyle = RING_STROKE;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(joystick.knobX, joystick.knobY, KNOB_RADIUS, 0, TAU);
  ctx.fillStyle = KNOB_FILL;
  ctx.fill();
  ctx.strokeStyle = KNOB_STROKE;
  ctx.stroke();

  ctx.restore();
}
