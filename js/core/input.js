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

/** The floating joystick, in CSS pixels: nothing happens within this radius of the centre. */
export const JOYSTICK_DEAD_ZONE = 12;
/** The ring drawn around the joystick centre, in logical canvas pixels. */
export const JOYSTICK_RADIUS = 40;

const DEG = 180 / Math.PI;
// Sector 0 is "right" and they run clockwise, because the y axis points down the screen.
const SECTOR_DIRS = [
  ['right'], ['right', 'down'], ['down'], ['down', 'left'],
  ['left'], ['left', 'up'], ['up'], ['up', 'right'],
];

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
/**
 * True while the event comes from a text field (the nickname input on the game-over
 * screen). Typing there must not steer the ship, move a menu selection or be swallowed by
 * `preventDefault` — the field owns the keyboard for as long as it has focus.
 */
export function isTextEntry(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable === true;
}

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
 * The pure heart of the touch joystick: the vector from the joystick centre to the finger,
 * in CSS pixels, turned into the very same four booleans the keyboard produces. Within
 * `deadZone` nothing is pressed; beyond it the angle falls into one of eight 45-degree
 * sectors, and a diagonal sector simply sets two of the booleans — so the ship's physics
 * sees a touch drag and a pair of held arrow keys as literally the same input.
 *
 * Sectors are half-open: sector n covers [45n - 22.5, 45n + 22.5) degrees, which means
 * "right" is true for angles in [-67.5, 67.5) and every angle belongs to exactly one sector.
 */
export function joystickDirections(dx, dy, deadZone = JOYSTICK_DEAD_ZONE) {
  const dirs = { up: false, down: false, left: false, right: false };
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return dirs;
  const dead = Number.isFinite(deadZone) ? deadZone : 0;
  if (Math.hypot(dx, dy) <= dead) return dirs;
  const angle = Math.atan2(dy, dx) * DEG;          // 0 = right, +90 = down
  const sector = ((Math.floor((angle + 22.5) / 45) % 8) + 8) % 8;
  for (const dir of SECTOR_DIRS[sector]) dirs[dir] = true;
  return dirs;
}

const pointInRect = (r, x, y) => !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

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
  // What the touch joystick is asking for, kept apart from the keyboard so that releasing
  // one source never clears the other; `state` is the OR of the two.
  const touchState = { up: false, down: false, left: false, right: false };
  // The floating joystick as the game scene draws it, in logical canvas coordinates.
  const joystick = {
    active: false, x: 0, y: 0, knobX: 0, knobY: 0, radius: JOYSTICK_RADIUS,
  };
  // Canvas-coordinate rectangles the joystick must keep its hands off (PAUSE, MENU).
  let touchExclusions = [];
  const held = new Set();      // codes currently down
  const fresh = new Set();     // codes that went down since the last endFrame()
  const attached = [];

  function on(node, type, fn) {
    if (!node || typeof node.addEventListener !== 'function') return;
    node.addEventListener(type, fn);
    attached.push([node, type, fn]);
  }

  // Recomputed from the held set so that releasing ArrowLeft while KeyA is still down
  // does not stop the ship; the joystick is ORed on top for the same reason.
  function refreshState() {
    state.up = touchState.up;
    state.down = touchState.down;
    state.left = touchState.left;
    state.right = touchState.right;
    for (const code of held) {
      const dir = directionForCode(code);
      if (dir) state[dir] = true;
    }
  }

  function onKeyDown(e) {
    if (isTextEntry(e.target)) { held.clear(); refreshState(); return; }
    const code = normalizeCode(e);
    if (!code) return;
    if (NO_SCROLL_CODES.has(code) && typeof e.preventDefault === 'function') e.preventDefault();
    if (!held.has(code)) fresh.add(code); // ignore the OS auto-repeat
    held.add(code);
    refreshState();
  }

  function onKeyUp(e) {
    if (isTextEntry(e.target)) return;
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

  /** Closes the on-screen keyboard when the canvas is tapped outside the nickname field. */
  function blurTextEntry() {
    const doc = typeof document !== 'undefined' ? document : null;
    const active = doc ? doc.activeElement : null;
    if (active && isTextEntry(active) && typeof active.blur === 'function') active.blur();
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
    // A tap on the canvas while the nickname field has focus would otherwise be spent on
    // dismissing the on-screen keyboard: the field is blurred here, at pointerdown time,
    // so this very tap already counts as the click on RETRY / MENU that it looks like.
    blurTextEntry();
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
    joystick,
    /** Written by attachTouch(); keeps the touch source separate from the keyboard one. */
    setTouchDirections(dirs) {
      touchState.up = !!(dirs && dirs.up);
      touchState.down = !!(dirs && dirs.down);
      touchState.left = !!(dirs && dirs.left);
      touchState.right = !!(dirs && dirs.right);
      refreshState();
    },
    /**
     * Rectangles ({x, y, w, h} in canvas coordinates) where a touch belongs to an on-canvas
     * button instead of the joystick — the game scene passes PAUSE and MENU while it runs.
     */
    setTouchExclusions(rects) {
      touchExclusions = Array.isArray(rects) ? rects : [];
    },
    /** True when (x, y) in canvas coordinates lands on one of those buttons. */
    isTouchExcluded(x, y) {
      return touchExclusions.some((r) => pointInRect(r, x, y));
    },
    canvasPoint(clientX, clientY) {
      const rect = canvas && typeof canvas.getBoundingClientRect === 'function'
        ? canvas.getBoundingClientRect()
        : null;
      return toCanvasPoint(rect, clientX, clientY);
    },
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

/**
 * attachTouch(input, canvas) -> { destroy() }
 *
 * The floating virtual joystick. A touch (or pen) that lands anywhere on the canvas away
 * from the on-canvas buttons fixes the joystick centre at that very point; dragging from
 * there steers. The vector is measured in CSS pixels — the physical distance the thumb
 * travelled, independent of how far the 600x450 field is stretched — and turned by
 * `joystickDirections` into the same four booleans the arrow keys set, so the ship keeps
 * exactly the original acceleration, top speed and friction.
 *
 * The joystick follows one `pointerId` from beginning to end: a second finger can tap
 * PAUSE while the first keeps steering, and it can never hijack the stick. Mouse pointers
 * are ignored altogether, so a desktop click stays a plain click.
 */
export function attachTouch(input, canvas) {
  if (!input || !canvas || typeof canvas.addEventListener !== 'function') {
    return { destroy() {} };
  }

  const attached = [];
  let joyId = null;            // the pointerId currently owning the stick
  let originX = 0;             // the centre, in CSS (client) pixels
  let originY = 0;

  function on(node, type, fn, options) {
    if (!node || typeof node.addEventListener !== 'function') return;
    node.addEventListener(type, fn, options);
    attached.push([node, type, fn, options]);
  }

  const view = input.joystick;

  /** Moves the ring/knob of the on-screen stick, in canvas coordinates. */
  function updateView(clientX, clientY) {
    const centre = input.canvasPoint(originX, originY);
    const at = input.canvasPoint(clientX, clientY);
    let kx = at.x - centre.x;
    let ky = at.y - centre.y;
    const len = Math.hypot(kx, ky);
    if (len > view.radius) {
      const k = view.radius / len;
      kx *= k;
      ky *= k;
    }
    view.x = centre.x;
    view.y = centre.y;
    view.knobX = centre.x + kx;
    view.knobY = centre.y + ky;
  }

  function release() {
    joyId = null;
    view.active = false;
    input.setTouchDirections(null);
  }

  function onPointerDown(e) {
    if (!e || e.pointerType === 'mouse') return;   // desktop clicks stay plain clicks
    if (joyId !== null) return;                    // a second finger never steals the stick
    const p = input.canvasPoint(e.clientX, e.clientY);
    if (input.isTouchExcluded(p.x, p.y)) return;   // PAUSE / MENU own this touch
    joyId = e.pointerId;
    originX = e.clientX;
    originY = e.clientY;
    view.active = true;
    updateView(e.clientX, e.clientY);
    input.setTouchDirections(null);                // centred: nothing pressed yet
    if (typeof canvas.setPointerCapture === 'function') {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
    }
    if (typeof e.preventDefault === 'function') e.preventDefault();
  }

  function onPointerMove(e) {
    if (!e || e.pointerId !== joyId) return;
    updateView(e.clientX, e.clientY);
    input.setTouchDirections(joystickDirections(e.clientX - originX, e.clientY - originY));
    if (typeof e.preventDefault === 'function') e.preventDefault();
  }

  function onPointerUp(e) {
    if (!e || e.pointerId !== joyId) return;
    if (typeof canvas.releasePointerCapture === 'function') {
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    }
    release();
  }

  // The capture can be lost without a pointerup (a system gesture, an alert); either way
  // the ship must stop steering itself.
  function onLostCapture(e) {
    if (e && e.pointerId !== joyId) return;
    release();
  }

  const swallow = (e) => { if (e && typeof e.preventDefault === 'function') e.preventDefault(); };

  on(canvas, 'pointerdown', onPointerDown);
  on(canvas, 'pointermove', onPointerMove);
  on(canvas, 'pointerup', onPointerUp);
  on(canvas, 'pointercancel', onPointerUp);
  on(canvas, 'lostpointercapture', onLostCapture);
  // No long-press menu, no text selection and no double-tap zoom on the stage.
  on(canvas, 'contextmenu', swallow);
  on(canvas, 'selectstart', swallow);
  on(canvas, 'dblclick', swallow);
  // touch-action: none is set in css/style.css; this is the belt to that pair of braces
  // for browsers that still emit a cancelable touchmove on the canvas.
  on(canvas, 'touchmove', swallow, { passive: false });

  return {
    destroy() {
      release();
      for (const [node, type, fn, options] of attached) {
        if (typeof node.removeEventListener === 'function') node.removeEventListener(type, fn, options);
      }
      attached.length = 0;
    },
  };
}
