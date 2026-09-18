// The pure parts of js/core/input.js, exercised without a DOM by injecting fake event
// targets: the key-code -> direction mapping and the client -> canvas coordinate transform.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput, directionForCode, toCanvasPoint, normalizeCode } from '../js/core/input.js';

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
