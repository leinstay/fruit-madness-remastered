// Keyboard and pointer input.
//
// Keys are read from `event.code`, so the keyboard layout and the modifier state do not
// matter: ArrowLeft and KeyA both mean "left" on a Russian layout too. The pure parts
// (the code -> direction table and the client -> canvas transform) are exported on their
// own so they can be unit-tested without a DOM; `createInput` only needs its targets to
// speak addEventListener/removeEventListener, which is what tests/input.test.js injects.
import { W, H } from '../config.js';

const DIRECTION_BY_CODE = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

// Keys the browser would otherwise use to scroll the page.
const NO_SCROLL_CODES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function directionForCode(code) {
  return DIRECTION_BY_CODE[code] ?? null;
}

/**
 * The physical key of an event. `event.code` is the layout-independent answer and is what
 * every real keyboard provides; a few environments (notably synthetic events from browser
 * automation and some on-screen keyboards) leave it empty, so `event.key` is reconstructed
 * into the same vocabulary as a last resort. That fallback is layout-dependent by nature,
 * which is exactly why it is only used when `code` is missing.
 */
export function normalizeCode(event) {
  if (!event) return null;
  if (event.code) return event.code;
  const key = event.key;
  if (!key) return null;
  if (key === ' ' || key === 'Spacebar') return 'Space';
  if (key.length === 1) {
    const ch = key.toUpperCase();
    if (ch >= 'A' && ch <= 'Z') return `Key${ch}`;
    if (ch >= '0' && ch <= '9') return `Digit${ch}`;
    return null;
  }
  return key; // 'ArrowRight', 'Enter', 'Escape', ... already match the code vocabulary
}

/**
 * Client (page) coordinates -> logical canvas coordinates. The canvas is stretched by CSS
 * to fill the window at a 4:3 ratio, so the displayed rect is both offset and scaled.
 */
export function toCanvasPoint(rect, clientX, clientY, width = W, height = H) {
  const left = rect && Number.isFinite(rect.left) ? rect.left : 0;
  const top = rect && Number.isFinite(rect.top) ? rect.top : 0;
  const rw = rect && rect.width > 0 ? rect.width : width;
  const rh = rect && rect.height > 0 ? rect.height : height;
  return { x: ((clientX - left) * width) / rw, y: ((clientY - top) * height) / rh };
}

/**
 * createInput(target = window, { canvas }) ->
 *   { state:{up,down,left,right}, pressed(code), pointer:{x,y,down,clicked}, endFrame(), destroy() }
 *
 * `pressed(code)` is a one-shot: true only during the frame the key went down (auto-repeat
 * does not re-trigger it), cleared by `endFrame()`. `pointer.clicked` behaves the same way.
 */
export function createInput(target = window, { canvas = null } = {}) {
  const state = { up: false, down: false, left: false, right: false };
  const pointer = { x: 0, y: 0, down: false, clicked: false };
  const held = new Set();      // codes currently down
  const fresh = new Set();     // codes that went down since the last endFrame()
  const attached = [];

  function on(node, type, fn) {
    if (!node || typeof node.addEventListener !== 'function') return;
    node.addEventListener(type, fn);
    attached.push([node, type, fn]);
  }

  // Recomputed from the held set so that releasing ArrowLeft while KeyA is still down
  // does not stop the ship.
  function refreshState() {
    state.up = state.down = state.left = state.right = false;
    for (const code of held) {
      const dir = directionForCode(code);
      if (dir) state[dir] = true;
    }
  }

  function onKeyDown(e) {
    const code = normalizeCode(e);
    if (!code) return;
    if (NO_SCROLL_CODES.has(code) && typeof e.preventDefault === 'function') e.preventDefault();
    if (!held.has(code)) fresh.add(code); // ignore the OS auto-repeat
    held.add(code);
    refreshState();
  }

  function onKeyUp(e) {
    const code = normalizeCode(e);
    if (!code) return;
    held.delete(code);
    refreshState();
  }

  // Alt-Tab and friends: everything is released while we are not looking.
  function onBlur() {
    held.clear();
    fresh.clear();
    pointer.down = false;
    refreshState();
  }

  function movePointer(e) {
    const rect = canvas && typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect()
      : null;
    const p = toCanvasPoint(rect, e.clientX, e.clientY);
    pointer.x = p.x;
    pointer.y = p.y;
  }

  function onPointerDown(e) {
    movePointer(e);
    pointer.down = true;
    pointer.clicked = true;
  }

  function onPointerMove(e) { movePointer(e); }

  function onPointerUp(e) {
    movePointer(e);
    pointer.down = false;
  }

  on(target, 'keydown', onKeyDown);
  on(target, 'keyup', onKeyUp);
  on(target, 'blur', onBlur);
  if (canvas) {
    on(canvas, 'pointerdown', onPointerDown);
    on(canvas, 'pointermove', onPointerMove);
  }
  // Releasing outside the canvas must still count as a release.
  on(target, 'pointerup', onPointerUp);
  on(target, 'pointercancel', onPointerUp);

  return {
    state,
    pointer,
    pressed(code) { return fresh.has(code); },
    /** Call once at the end of every game frame to expire the one-shot flags. */
    endFrame() {
      fresh.clear();
      pointer.clicked = false;
    },
    destroy() {
      for (const [node, type, fn] of attached) {
        if (typeof node.removeEventListener === 'function') node.removeEventListener(type, fn);
      }
      attached.length = 0;
    },
  };
}
