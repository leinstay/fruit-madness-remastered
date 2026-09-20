// The title screen is one SVG file holding all 31 frames of the original animation:
// a shared <defs> with every drawing stored once, then 31 frame groups of <use>
// elements, each preceded by an exact marker comment (assets/sprites/titleBg.svg,
// built by tools/make-title.py).
//
// Showing it is a trade between download, memory and time:
//
//   * the file is downloaded once, as text. Cutting a frame out of it is plain string
//     slicing between the markers — there is no XML parser at runtime;
//   * a frame is rasterised on demand into an offscreen canvas of whole device pixels
//     (Blob -> object URL -> Image -> decode() -> drawImage -> revoke). One title frame
//     is the whole field, so at the maximum scale it is about 4 MB of bitmap and holding
//     all 31 is out of the question;
//   * so the rasterised frames live in a small LRU, and while frame k is on screen the
//     next two are prepared in the background.
//
// Nothing here ever blocks the render loop. `draw` returns immediately: if the frame it
// was asked for is not ready it blits the most recent one that is, and if none is ready
// yet it says so and lets the caller paint something else.

import { W, H } from '../config.js';
import { rasterFrameSize } from './assets.js';

/** How many rasterised frames are kept. Six at scale 2 is about 26 MB. */
export const FRAME_CACHE_LIMIT = 6;

/**
 * The render scale a title frame is ever rasterised at. The field is 600x450, so scale 3
 * would cost 1800x1350x4 = 9.7 MB a frame for a sharpness nobody can see on artwork this
 * soft. Above the cap the bitmap is simply blitted a little larger.
 */
export const MAX_TITLE_SCALE = 2;

const END_MARKER = '<!--frames:end-->';
const frameMarker = (n) => `<!--frame:${n}-->`;

/**
 * Cuts the file into the pieces a single-frame document is assembled from:
 *
 *   prefix   the root element and the shared definitions, up to the first frame marker
 *   frames   the markup of each frame group, with its display="none" removed
 *   suffix   the end marker and the closing root element
 *
 * Pure: a string in, strings out. Throws when the file is not in that shape, which is
 * what makes the caller fall back to the 2013 renders instead of drawing nothing.
 */
export function sliceTitleFrames(svgText) {
  if (typeof svgText !== 'string' || !svgText.startsWith('<svg')) {
    throw new Error('title: the file does not start with an <svg> element');
  }
  const end = svgText.indexOf(END_MARKER);
  if (end < 0) throw new Error(`title: no ${END_MARKER} marker`);
  const first = svgText.indexOf(frameMarker(0));
  if (first < 0 || first > end) throw new Error('title: no frame 0');

  const frames = [];
  let cursor = first;
  for (let n = 0; ; n += 1) {
    const marker = frameMarker(n);
    const at = svgText.indexOf(marker, cursor);
    if (at < 0 || at >= end) break;
    const from = at + marker.length;
    const next = svgText.indexOf(frameMarker(n + 1), from);
    const to = next >= 0 && next < end ? next : end;
    frames.push(svgText.slice(from, to).split(' display="none"').join(''));
    cursor = to;
  }
  if (frames.length === 0) throw new Error('title: the file holds no frames');
  return { prefix: svgText.slice(0, first), frames, suffix: svgText.slice(end) };
}

/** One frame of `parts` as a standalone SVG document. `index` wraps around. */
export function buildFrameDocument(parts, index) {
  const n = parts.frames.length;
  const i = ((Math.floor(index) % n) + n) % n;
  return parts.prefix + parts.frames[i] + parts.suffix;
}

/**
 * A least-recently-used map with a hard entry cap. `set` returns the values it had to
 * evict so the caller can let go of them; `get` counts as a use. Pure and DOM-free.
 */
export function createFrameCache(limit = FRAME_CACHE_LIMIT) {
  const max = Math.max(1, Math.floor(limit) || 1);
  const map = new Map();
  return {
    limit: max,
    get size() { return map.size; },
    keys: () => [...map.keys()],
    has: (key) => map.has(key),
    get(key) {
      if (!map.has(key)) return null;
      const value = map.get(key);
      map.delete(key);
      map.set(key, value);      // most recently used goes last
      return value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      const evicted = [];
      while (map.size > max) {
        const oldest = map.keys().next().value;
        evicted.push(map.get(oldest));
        map.delete(oldest);
      }
      return evicted;
    },
    clear() {
      const all = [...map.values()];
      map.clear();
      return all;
    },
  };
}

/** What a full cache costs in bytes at a render scale, RGBA and all. */
export function frameCacheBytes(limit, size, scale) {
  const [w, h] = rasterFrameSize(size, scale);
  return Math.max(1, Math.floor(limit) || 1) * w * h * 4;
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/** Rasterises one frame document into an offscreen canvas of `w` x `h` device pixels. */
async function rasteriseDocument(markup, w, h) {
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = makeCanvas(w, h);
    const c = canvas.getContext('2d');
    if (!c) return null;
    c.imageSmoothingEnabled = true;
    c.drawImage(image, 0, 0, w, h);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function fetchDocumentText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * createTitleFrames({ url, size }) -> { draw, failed, frameCount, release }
 *
 * `draw(ctx, index, scale)` paints the field-sized frame at the origin and returns
 * whether anything was painted. It never waits: the file is fetched on the first call,
 * frames are rasterised one at a time in the background, and the most recent ready
 * frame stands in for one that is not. A change of render scale empties the cache and
 * it refills itself lazily.
 *
 * `failed()` is true once the file could not be fetched or a frame could not be
 * decoded; from then on the caller should draw the 2013 raster frames instead.
 */
export function createTitleFrames({
  url,
  size = [W, H],
  limit = FRAME_CACHE_LIMIT,
  maxScale = MAX_TITLE_SCALE,
  loadText = fetchDocumentText,
  rasterise = rasteriseDocument,
} = {}) {
  const cache = createFrameCache(limit);
  let status = 'idle';        // idle -> loading -> ready, or failed
  let parts = null;
  let scale = 0;
  let shown = null;           // the last bitmap drawn; may be from the previous scale
  let busy = false;
  const queue = [];

  function fail(err) {
    if (status === 'failed') return;
    status = 'failed';
    console.warn('title: falling back to the raster frames:', err);
  }

  function start() {
    if (status !== 'idle') return;
    status = 'loading';
    loadText(url).then((text) => {
      parts = sliceTitleFrames(text);
      status = 'ready';
    }).catch(fail);
  }

  function want(index) {
    if (cache.has(index) || queue.includes(index)) return;
    if (queue.length >= limit) queue.shift();
    queue.push(index);
  }

  function pump() {
    if (status !== 'ready' || busy || queue.length === 0) return;
    const index = queue.shift();
    if (cache.has(index)) { pump(); return; }
    const at = scale;
    const [w, h] = rasterFrameSize(size, at);
    busy = true;
    rasterise(buildFrameDocument(parts, index), w, h).then((bitmap) => {
      busy = false;
      if (!bitmap) { fail(new Error('the frame could not be rasterised')); return; }
      // The scale may have changed while this frame was being prepared; that bitmap is
      // the wrong size for the cache, but it is still a picture, so it may be shown.
      if (at === scale) cache.set(index, bitmap);
      shown = bitmap;
      pump();
    }).catch((err) => { busy = false; fail(err); });
  }

  function draw(ctx, index, renderScale) {
    if (status === 'failed') return false;
    start();
    const wanted = Math.min(Math.max(Number(renderScale) > 0 ? Number(renderScale) : 1, 1), maxScale);
    if (wanted !== scale) {
      cache.clear();
      scale = wanted;
    }
    if (status === 'ready') {
      const n = parts.frames.length;
      const i = ((Math.floor(index) % n) + n) % n;
      const ready = cache.get(i);
      if (ready) shown = ready;
      else want(i);
      // While one frame is on screen, prepare the two that follow it.
      want((i + 1) % n);
      want((i + 2) % n);
      pump();
    }
    if (!shown) return false;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(shown, 0, 0, size[0], size[1]);
    ctx.restore();
    return true;
  }

  return {
    draw,
    failed: () => status === 'failed',
    frameCount: () => (parts ? parts.frames.length : 0),
    cachedFrames: () => cache.size,
    release() {
      cache.clear();
      shown = null;
      queue.length = 0;
    },
  };
}
