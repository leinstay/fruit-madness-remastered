// A tiny canvas-button helper shared by the menu, game-over and leaderboard scenes:
// rectangle hit-testing, pointer hover, keyboard selection and a matching text style.
//
// The two decision functions are pure and exported on their own so tests/ui.test.js can
// cover them without a DOM; `createButtons` is the thin stateful wrapper around them.
import { drawText } from '../core/text.js';

const PREV_CODES = ['ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA'];
const NEXT_CODES = ['ArrowDown', 'KeyS', 'ArrowRight', 'KeyD'];
const ACTIVATE_CODES = ['Enter', 'Space', 'NumpadEnter'];

export const MARKER = '>';
const COLOR_IDLE = '#ffffff';
const COLOR_SELECTED = '#ffe14d';

/** Index of the first enabled item covering (x, y), or -1. Topmost item wins. */
export function hitTest(items, x, y) {
  if (!Array.isArray(items)) return -1;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (!it || it.disabled) continue;
    if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return i;
  }
  return -1;
}

/** Moves a selection by `delta`, wrapping. -1 for an empty list; an out-of-range start
 *  is treated as "before the first item" for a forward move. */
export function nextIndex(index, delta, count) {
  if (!Number.isFinite(count) || count <= 0) return -1;
  const step = delta >= 0 ? 1 : -1;
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    return step > 0 ? 0 : count - 1;
  }
  return ((index + step) % count + count) % count;
}

/**
 * createButtons(defs) where a def is { id, x, y, w, h, label?, size?, align? }.
 * `update(input)` returns the id activated this frame (click or Enter/Space), else null.
 */
export function createButtons(defs) {
  const items = defs.map((d) => ({ size: 20, align: 'center', ...d }));
  let selected = 0;
  let lastX = null;
  let lastY = null;

  function pressedAny(input, codes) {
    return codes.some((c) => input.pressed(c));
  }

  function update(input) {
    if (!input) return null;
    const p = input.pointer;

    // Hover only counts when the pointer actually moved, so it does not fight the keyboard.
    if (p && (p.x !== lastX || p.y !== lastY)) {
      lastX = p.x;
      lastY = p.y;
      const over = hitTest(items, p.x, p.y);
      if (over >= 0) selected = over;
    }

    if (pressedAny(input, PREV_CODES)) selected = nextIndex(selected, -1, items.length);
    if (pressedAny(input, NEXT_CODES)) selected = nextIndex(selected, 1, items.length);

    if (p && p.clicked) {
      const hit = hitTest(items, p.x, p.y);
      if (hit >= 0) { selected = hit; return items[hit].id; }
      return null;
    }
    if (pressedAny(input, ACTIVATE_CODES)) {
      const it = items[selected];
      if (it && !it.disabled) return it.id;
    }
    return null;
  }

  return {
    items,
    get selected() { return selected; },
    set selected(i) { selected = i; },
    isSelected(id) { return items[selected] && items[selected].id === id; },
    select(id) {
      const i = items.findIndex((it) => it.id === id);
      if (i >= 0) selected = i;
    },
    byId(id) { return items.find((it) => it.id === id) || null; },
    update,
  };
}

/**
 * Draws a text button inside its rect. The selection marker sits just left of the rect,
 * or inside the label (`marker: 'inline'`) for buttons too close to the screen edge.
 */
export function drawButton(ctx, item, selected, { label = item.label, color } = {}) {
  const inline = item.marker === 'inline';
  const text = selected && inline ? `${MARKER} ${label}` : label;
  const cx = item.x + item.w / 2;
  const baseline = item.y + item.h - Math.round(item.h * 0.22);
  const fill = color || (selected ? COLOR_SELECTED : COLOR_IDLE);
  drawText(ctx, text, item.align === 'center' ? cx : item.x, baseline, {
    size: item.size, align: item.align, color: fill,
  });
  if (selected && !inline) drawMarker(ctx, item);
}

/** The selection marker on its own — for buttons drawn from a sprite (START). */
export function drawMarker(ctx, item, size = item.size) {
  drawText(ctx, MARKER, item.x - 10, item.y + item.h - Math.round(item.h * 0.22), {
    size, align: 'right', color: COLOR_SELECTED,
  });
}
