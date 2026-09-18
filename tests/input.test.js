// The pure parts of js/core/input.js, exercised without a DOM by injecting fake event
// targets: the key-code -> direction mapping and the client -> canvas coordinate transform.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInput, directionForCode, toCanvasPoint, normalizeCode, joystickDirections, attachTouch,
} from '../js/core/input.js';

// A minimal stand-in for window / canvas: records handlers and lets a test fire them.
function fakeTarget(rect = null) {
  const handlers = new Map();
  return {
    rect,
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = handlers.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    getBoundingClientRect() { return rect; },
    fire(type, event = {}) {
      for (const fn of handlers.get(type) || []) fn(event);
    },
    count(type) { return (handlers.get(type) || []).length; },
  };
}

const key = (code) => { let prevented = false; return { code, preventDefault() { prevented = true; }, get prevented() { return prevented; } }; };

test('directionForCode: arrows and WASD map to the same four directions', () => {
  assert.equal(directionForCode('ArrowUp'), 'up');
  assert.equal(directionForCode('KeyW'), 'up');
  assert.equal(directionForCode('ArrowDown'), 'down');
  assert.equal(directionForCode('KeyS'), 'down');
  assert.equal(directionForCode('ArrowLeft'), 'left');
  assert.equal(directionForCode('KeyA'), 'left');
  assert.equal(directionForCode('ArrowRight'), 'right');
  assert.equal(directionForCode('KeyD'), 'right');
  assert.equal(directionForCode('KeyP'), null);
  assert.equal(directionForCode('Escape'), null);
  assert.equal(directionForCode(undefined), null);
});

test('normalizeCode prefers event.code and rebuilds it from event.key when it is missing', () => {
  assert.equal(normalizeCode({ code: 'KeyW', key: 'ц' }), 'KeyW', 'code wins, whatever the layout');
  assert.equal(normalizeCode({ code: '', key: 'ArrowRight' }), 'ArrowRight');
  assert.equal(normalizeCode({ code: '', key: 'Enter' }), 'Enter');
  assert.equal(normalizeCode({ code: '', key: 'Escape' }), 'Escape');
  assert.equal(normalizeCode({ code: '', key: ' ' }), 'Space');
  assert.equal(normalizeCode({ code: '', key: 'p' }), 'KeyP');
  assert.equal(normalizeCode({ code: '', key: 'D' }), 'KeyD');
  assert.equal(normalizeCode({ code: '', key: '7' }), 'Digit7');
  assert.equal(normalizeCode({ code: '', key: 'ц' }), null, 'a non-latin letter has no code');
  assert.equal(normalizeCode({ code: '', key: '' }), null);
  assert.equal(normalizeCode(null), null);
});

test('toCanvasPoint: a CSS-scaled canvas maps back to 600x450 coordinates', () => {
  // The canvas is displayed twice its logical size, offset by (40, 10) on the page.
  const rect = { left: 40, top: 10, width: 1200, height: 900 };
  assert.deepEqual(toCanvasPoint(rect, 40, 10), { x: 0, y: 0 });
  assert.deepEqual(toCanvasPoint(rect, 1240, 910), { x: 600, y: 450 });
  assert.deepEqual(toCanvasPoint(rect, 640, 460), { x: 300, y: 225 });
  // A degenerate rect (hidden element) must not produce NaN.
  assert.deepEqual(toCanvasPoint({ left: 0, top: 0, width: 0, height: 0 }, 5, 5), { x: 5, y: 5 });
});

test('state follows held keys; arrows and WASD do not cancel each other', () => {
  const target = fakeTarget();
  const input = createInput(target);
  assert.deepEqual(input.state, { up: false, down: false, left: false, right: false });

  target.fire('keydown', key('ArrowLeft'));
  target.fire('keydown', key('KeyA'));
  assert.equal(input.state.left, true);
  target.fire('keyup', key('ArrowLeft'));
  assert.equal(input.state.left, true, 'KeyA is still held');
  target.fire('keyup', key('KeyA'));
  assert.equal(input.state.left, false);

  target.fire('keydown', key('KeyW'));
  target.fire('keydown', key('ArrowRight'));
  assert.deepEqual(input.state, { up: true, down: false, left: false, right: true });
  target.fire('blur');
  assert.deepEqual(input.state, { up: false, down: false, left: false, right: false });
});

test('pressed() is a one-shot that survives key repeat and clears on endFrame()', () => {
  const target = fakeTarget();
  const input = createInput(target);

  target.fire('keydown', key('KeyP'));
  assert.equal(input.pressed('KeyP'), true);
  assert.equal(input.pressed('Escape'), false);
  target.fire('keydown', key('KeyP')); // auto-repeat while still held
  input.endFrame();
  assert.equal(input.pressed('KeyP'), false);

  target.fire('keyup', key('KeyP'));
  target.fire('keydown', key('KeyP'));
  assert.equal(input.pressed('KeyP'), true);
});

test('arrows and space are prevented from scrolling the page; other keys are not', () => {
  const target = fakeTarget();
  createInput(target);
  for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) {
    const e = key(code);
    target.fire('keydown', e);
    assert.equal(e.prevented, true, code);
  }
  const p = key('KeyP');
  target.fire('keydown', p);
  assert.equal(p.prevented, false);
});

test('pointer reports canvas coordinates and a one-frame click', () => {
  const target = fakeTarget();
  const canvas = fakeTarget({ left: 40, top: 10, width: 1200, height: 900 });
  const input = createInput(target, { canvas });

  canvas.fire('pointerdown', { clientX: 640, clientY: 460 });
  assert.deepEqual({ x: input.pointer.x, y: input.pointer.y }, { x: 300, y: 225 });
  assert.equal(input.pointer.down, true);
  assert.equal(input.pointer.clicked, true);

  input.endFrame();
  assert.equal(input.pointer.clicked, false, 'the click lasts exactly one frame');
  assert.equal(input.pointer.down, true, 'but the button is still held');

  target.fire('pointerup', { clientX: 640, clientY: 460 });
  assert.equal(input.pointer.down, false);
});

test('destroy() detaches every listener it added', () => {
  const target = fakeTarget();
  const canvas = fakeTarget({ left: 0, top: 0, width: 600, height: 450 });
  const input = createInput(target, { canvas });
  assert.ok(target.count('keydown') > 0);
  input.destroy();
  assert.equal(target.count('keydown'), 0);
  assert.equal(canvas.count('pointerdown'), 0);
});

// --- Touch joystick -------------------------------------------------------------------

test('joystickDirections: inside the dead zone nothing is pressed', () => {
  const none = { up: false, down: false, left: false, right: false };
  assert.deepEqual(joystickDirections(0, 0), none);
  assert.deepEqual(joystickDirections(11.9, 0), none);
  assert.deepEqual(joystickDirections(12, 0), none, 'exactly on the dead zone is still idle');
  assert.deepEqual(joystickDirections(8, 8), none, 'the dead zone is a circle, not a square');
  assert.deepEqual(joystickDirections(12.5, 0), { ...none, right: true });
  // The dead zone is configurable.
  assert.deepEqual(joystickDirections(5, 0, 2), { ...none, right: true });
  assert.deepEqual(joystickDirections(5, 0, 20), none);
});

test('joystickDirections: the eight 45-degree sectors, y pointing down the screen', () => {
  const at = (deg, r = 100) => joystickDirections(
    r * Math.cos((deg * Math.PI) / 180),
    r * Math.sin((deg * Math.PI) / 180),
  );
  const dirs = (d) => Object.keys(d).filter((k) => d[k]).sort().join('+');
  assert.equal(dirs(at(0)), 'right');
  assert.equal(dirs(at(45)), 'down+right');
  assert.equal(dirs(at(90)), 'down');
  assert.equal(dirs(at(135)), 'down+left');
  assert.equal(dirs(at(180)), 'left');
  assert.equal(dirs(at(-180)), 'left', 'the wrap-around point');
  assert.equal(dirs(at(-135)), 'left+up');
  assert.equal(dirs(at(-90)), 'up');
  assert.equal(dirs(at(-45)), 'right+up');
});

test('joystickDirections: sector boundaries are half-open, so no angle is ever idle', () => {
  const at = (deg, r = 100) => joystickDirections(
    r * Math.cos((deg * Math.PI) / 180),
    r * Math.sin((deg * Math.PI) / 180),
  );
  const dirs = (d) => Object.keys(d).filter((k) => d[k]).sort().join('+');
  // Each sector covers [45n - 22.5, 45n + 22.5): a boundary belongs to the next sector.
  assert.equal(dirs(at(22.4)), 'right');
  assert.equal(dirs(at(22.5)), 'down+right');
  assert.equal(dirs(at(67.5)), 'down');
  assert.equal(dirs(at(112.5)), 'down+left');
  assert.equal(dirs(at(157.5)), 'left');
  assert.equal(dirs(at(-22.5)), 'right', 'the lower edge of the right sector');
  assert.equal(dirs(at(-22.6)), 'right+up');
  assert.equal(dirs(at(-67.5)), 'right+up');
  assert.equal(dirs(at(-67.6)), 'up');
});

test('joystickDirections: a huge vector is the same as a small one past the dead zone', () => {
  assert.deepEqual(joystickDirections(10000, 0), joystickDirections(13, 0));
  assert.deepEqual(joystickDirections(-5000, -5000), { up: true, down: false, left: true, right: false });
  assert.deepEqual(
    joystickDirections(Number.NaN, 4),
    { up: false, down: false, left: false, right: false },
  );
});

// A canvas stand-in that also speaks the pointer-capture API.
function fakeCanvas(rect = { left: 0, top: 0, width: 600, height: 450 }) {
  const node = fakeTarget(rect);
  node.captured = [];
  node.setPointerCapture = (id) => { node.captured.push(id); };
  node.releasePointerCapture = (id) => {
    const i = node.captured.indexOf(id);
    if (i >= 0) node.captured.splice(i, 1);
  };
  return node;
}

const touch = (pointerId, clientX, clientY, pointerType = 'touch') => ({
  pointerId, pointerType, clientX, clientY, preventDefault() {},
});

test('attachTouch: a touch drag writes the same booleans the keyboard writes', () => {
  const target = fakeTarget();
  const canvas = fakeCanvas();
  const input = createInput(target, { canvas });
  attachTouch(input, canvas);

  canvas.fire('pointerdown', touch(1, 100, 100));
  assert.deepEqual(input.state, { up: false, down: false, left: false, right: false });
  assert.equal(input.joystick.active, true);

  canvas.fire('pointermove', touch(1, 160, 100));
  assert.deepEqual(input.state, { up: false, down: false, left: false, right: true });

  canvas.fire('pointerup', touch(1, 160, 100));
  assert.deepEqual(input.state, { up: false, down: false, left: false, right: false });
  assert.equal(input.joystick.active, false);
});

test('attachTouch: keyboard and touch are ORed and neither release clears the other', () => {
  const target = fakeTarget();
  const canvas = fakeCanvas();
  const input = createInput(target, { canvas });
  attachTouch(input, canvas);

  target.fire('keydown', key('ArrowUp'));
  canvas.fire('pointerdown', touch(7, 100, 100));
  canvas.fire('pointermove', touch(7, 160, 100));
  assert.deepEqual(input.state, { up: true, down: false, left: false, right: true });

  // Letting go of the stick leaves the held key alone.
  canvas.fire('pointerup', touch(7, 160, 100));
  assert.deepEqual(input.state, { up: true, down: false, left: false, right: false });

  // ... and the other way round.
  canvas.fire('pointerdown', touch(8, 100, 100));
  canvas.fire('pointermove', touch(8, 160, 100));
  target.fire('keyup', key('ArrowUp'));
  assert.deepEqual(input.state, { up: false, down: false, left: false, right: true });
  canvas.fire('pointercancel', touch(8, 160, 100));
  assert.deepEqual(input.state, { up: false, down: false, left: false, right: false });
});

test('attachTouch: a mouse pointer never creates a joystick', () => {
  const target = fakeTarget();
  const canvas = fakeCanvas();
  const input = createInput(target, { canvas });
  attachTouch(input, canvas);

  canvas.fire('pointerdown', touch(1, 100, 100, 'mouse'));
  canvas.fire('pointermove', touch(1, 300, 100, 'mouse'));
  assert.equal(input.joystick.active, false);
  assert.deepEqual(input.state, { up: false, down: false, left: false, right: false });
  assert.equal(input.pointer.clicked, true, 'it is still an ordinary click');
});

test('attachTouch: a touch inside an excluded button rect creates no joystick', () => {
  const target = fakeTarget();
  const canvas = fakeCanvas();               // 1:1, so client == canvas coordinates
  const input = createInput(target, { canvas });
  attachTouch(input, canvas);
  input.setTouchExclusions([{ x: 20, y: 400, w: 80, h: 40 }]);

  canvas.fire('pointerdown', touch(1, 60, 420));
  canvas.fire('pointermove', touch(1, 200, 420));
  assert.equal(input.joystick.active, false, 'the PAUSE button owns this touch');
  assert.deepEqual(input.state, { up: false, down: false, left: false, right: false });

  // Just outside the rect the joystick works as usual.
  canvas.fire('pointerdown', touch(2, 300, 200));
  canvas.fire('pointermove', touch(2, 360, 200));
  assert.equal(input.joystick.active, true);
  assert.equal(input.state.right, true);
});

test('attachTouch: a second finger cannot steal the joystick and can press a button', () => {
  const target = fakeTarget();
  const canvas = fakeCanvas();
  const input = createInput(target, { canvas });
  attachTouch(input, canvas);
  input.setTouchExclusions([{ x: 20, y: 400, w: 80, h: 40 }]);

  canvas.fire('pointerdown', touch(1, 300, 200));
  canvas.fire('pointermove', touch(1, 360, 200));
  assert.equal(input.state.right, true);

  // The second finger taps PAUSE: it registers as a click and leaves the stick alone.
  input.endFrame();
  canvas.fire('pointerdown', touch(2, 60, 420));
  assert.equal(input.pointer.clicked, true);
  assert.equal(input.state.right, true, 'the first finger keeps steering');
  canvas.fire('pointerup', touch(2, 60, 420));
  assert.equal(input.state.right, true);

  // A second finger elsewhere must not move the joystick centre either.
  const centre = { x: input.joystick.x, y: input.joystick.y };
  canvas.fire('pointerdown', touch(3, 100, 100));
  canvas.fire('pointermove', touch(3, 100, 40));
  assert.deepEqual({ x: input.joystick.x, y: input.joystick.y }, centre);
  assert.deepEqual(input.state, { up: false, down: false, left: false, right: true });

  canvas.fire('pointerup', touch(1, 360, 200));
  assert.deepEqual(input.state, { up: false, down: false, left: false, right: false });
});

test('attachTouch: the ring centre and the clamped knob are in canvas coordinates', () => {
  const target = fakeTarget();
  // Displayed at half size and offset: 1 CSS px = 2 canvas px.
  const canvas = fakeCanvas({ left: 10, top: 20, width: 300, height: 225 });
  const input = createInput(target, { canvas });
  attachTouch(input, canvas);

  canvas.fire('pointerdown', touch(1, 110, 120));
  assert.deepEqual({ x: input.joystick.x, y: input.joystick.y }, { x: 200, y: 200 });
  assert.deepEqual({ x: input.joystick.knobX, y: input.joystick.knobY }, { x: 200, y: 200 });

  canvas.fire('pointermove', touch(1, 125, 120));   // 15 CSS px right = 30 canvas px
  assert.deepEqual({ x: input.joystick.knobX, y: input.joystick.knobY }, { x: 230, y: 200 });

  canvas.fire('pointermove', touch(1, 1110, 120));  // far away: clamped to the ring radius
  assert.equal(input.joystick.knobX, 200 + input.joystick.radius);
  assert.equal(input.joystick.knobY, 200);
});
