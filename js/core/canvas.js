// Canvas geometry: how many device pixels the 600x450 logical field is drawn on.
//
// The page lays the canvas out in CSS pixels (css/style.css keeps the box at 4:3); the
// backing store is that box multiplied by the display's device pixel ratio, so one logical
// pixel becomes `scale` device pixels and the vector art can be rasterised at the exact
// resolution the screen shows. Every scene keeps drawing in 600x450 units: js/main.js
// installs `setTransform(scale, 0, 0, scale, 0, 0)` before each render.
//
// Pure and DOM-free, so tests/canvas.test.js can cover it under plain node --test.
import { W, H } from '../config.js';

/**
 * The ceiling on the render scale. A phone at dpr 3 in landscape already asks for a
 * 1800x1350 backing store; beyond that the extra pixels cost memory in the sprite raster
 * cache and buy nothing the eye can see.
 */
export const MAX_RENDER_SCALE = 3;

/**
 * computeBackingSize(cssW, cssH, dpr, cap) -> { width, height, scale }
 *
 * `width`/`height` are the canvas backing store in device pixels, `scale` is how many of
 * them one logical pixel covers. The 4:3 aspect is enforced here as well as in the CSS, so
 * a box that is not exactly 4:3 is fitted inside rather than stretched.
 */
export function computeBackingSize(cssW, cssH, dpr = 1, cap = MAX_RENDER_SCALE) {
  const w = Number.isFinite(cssW) && cssW > 0 ? cssW : W;
  const h = Number.isFinite(cssH) && cssH > 0 ? cssH : H;
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const limit = Number.isFinite(cap) && cap > 0 ? cap : MAX_RENDER_SCALE;
  const scale = Math.min(Math.min(w / W, h / H) * ratio, limit);
  const width = Math.max(1, Math.round(W * scale));
  return { width, height: Math.max(1, Math.round(H * scale)), scale: width / W };
}

/**
 * `v` (a logical coordinate) moved onto the nearest whole device pixel. Snapping in device
 * space instead of logical space keeps edges hard at any scale without the visible drift
 * that rounding to whole logical pixels causes once one of them is several device pixels.
 */
export function snapToDevice(v, scale = 1) {
  if (!Number.isFinite(v)) return 0;
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Math.round(v * s) / s;
}

/**
 * How many device pixels one logical pixel covers in `ctx` right now, read from its current
 * transform (rotation included, hence the vector length). A context that cannot report its
 * transform — the stubs in the tests, very old canvas implementations — counts as 1:1.
 */
export function deviceScale(ctx) {
  if (!ctx || typeof ctx.getTransform !== 'function') return 1;
  try {
    const t = ctx.getTransform();
    const s = Math.hypot(t.a, t.b);
    return Number.isFinite(s) && s > 0 ? s : 1;
  } catch {
    return 1;
  }
}
