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
//   * **a frame document carries only the drawings that frame uses.** Nearly all of the
//     time to prepare a frame is the browser parsing the document, so handing it all 295
//     definitions when about half are referenced costs about half the frame rate. The
//     definitions sit one per line inside `<defs>`, so they are indexed by id once and
//     the referenced ones — transitively, should a drawing ever point at another — are
//     collected by string search;
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

/**
 * How many frames past the one on screen are prepared in the background.
 *
 * Exactly one frame is ever rasterised at a time. Two or three at once do get more frames
 * out of the browser per second — it decodes between the frames it paints, so a single
 * outstanding request leaves gaps — but the work is main-thread work, and asking for it
 * in parallel drops the menu's own repaint rate to a third. The loop comes first.
 */
export const PREPARE_AHEAD = 2;

const END_MARKER = '<!--frames:end-->';
const OPEN_DEFS = '<defs>';
const CLOSE_DEFS = '</defs>';
const frameMarker = (n) => `<!--frame:${n}-->`;

/**
 * Cuts the file into the pieces a single-frame document is assembled from:
 *
 *   open         the root element's opening tag
 *   definitions  Map id -> markup, one entry per line of <defs>, in document order
 *   backdrop     what stands between </defs> and the first frame: the white page rect
 *   frames       the markup of each frame group, with its display="none" removed
 *   suffix       the end marker and the closing root element
 *   prefix       open + the whole <defs> + backdrop, i.e. everything before frame 0
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

  const defsStart = svgText.indexOf(OPEN_DEFS);
  const defsEnd = svgText.indexOf(CLOSE_DEFS);
  if (defsStart < 0 || defsEnd < defsStart) throw new Error('title: no <defs> block');
  const definitions = new Map();
  for (const line of svgText.slice(defsStart + OPEN_DEFS.length, defsEnd).split('\n')) {
    const markup = line.trim();
    if (markup === '') continue;
    const id = /\sid="([^"]+)"/.exec(markup);
    if (!id) throw new Error('title: a definition without an id');
    definitions.set(id[1], markup);
  }
  if (definitions.size === 0) throw new Error('title: the definitions are empty');

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
  return {
    open: svgText.slice(0, defsStart),
    definitions,
    backdrop: svgText.slice(defsEnd + CLOSE_DEFS.length, first),
    prefix: svgText.slice(0, first),
    frames,
    suffix: svgText.slice(end),
  };
}

const REFERENCE_RE = /(?:xlink:)?href="#([^"]+)"/g;

/**
 * The ids `markup` points at, in the order it points at them, without repeats.
 * Most definitions are a lone path and point at nothing; the plain substring test skips
 * the regex for them, which matters because this runs over megabytes of path data.
 */
export function referencedIds(markup) {
  const text = String(markup);
  if (!text.includes('href="#')) return [];
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(REFERENCE_RE)) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); }
  }
  return out;
}

/**
 * The definitions `markup` needs, resolved transitively — a drawing may point at another
 * one — and returned in the document order of `definitions` so the output is stable.
 * Throws on a reference that resolves to nothing rather than emitting a document with a
 * hole in it.
 */
export function resolveDefinitions(definitions, markup) {
  const needed = new Set();
  const pending = referencedIds(markup);
  while (pending.length > 0) {
    const id = pending.pop();
    if (needed.has(id)) continue;
    const body = definitions.get(id);
    if (body === undefined) throw new Error(`title: definition #${id} is missing`);
    needed.add(id);
    for (const next of referencedIds(body)) pending.push(next);
  }
  const out = [];
  for (const [id, body] of definitions) if (needed.has(id)) out.push(body);
  return out;
}

const wrapIndex = (index, count) => ((Math.floor(index) % count) + count) % count;

/**
 * One frame of `parts` as the *pieces* of a standalone SVG document carrying **only** the
 * definitions that frame references. `index` wraps around.
 *
 * Pieces rather than one string on purpose: `new Blob(pieces)` takes the array as it is,
 * so nothing ever builds the megabyte-sized string a frame document would be. That alone
 * is worth about 20 ms a frame.
 */
export function buildFrameParts(parts, index) {
  const frame = parts.frames[wrapIndex(index, parts.frames.length)];
  return [parts.open, OPEN_DEFS, ...resolveDefinitions(parts.definitions, frame),
    CLOSE_DEFS, parts.backdrop, frame, parts.suffix];
}

/** The same document as one string, for anything that needs it in one piece. */
export function buildFrameDocument(parts, index) {
  return buildFrameParts(parts, index).join('');
}

/**
 * The same frame with every definition in the file. Only used if building the small
 * document ever fails, so that a surprise in the file costs sharpness of nothing and the
 * title still plays.
 */
export function buildFullFrameDocument(parts, index) {
  return parts.prefix + parts.frames[wrapIndex(index, parts.frames.length)] + parts.suffix;
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

/**
 * Rasterises one frame document into an offscreen canvas of `w` x `h` device pixels.
 * `pieces` is the array `buildFrameParts` returns; Blob concatenates it itself.
 *
 * `createImageBitmap` would be the obvious alternative to the Image-and-canvas dance, but
 * Chrome rejects an SVG blob outright, so there is nothing to choose between.
 */
async function rasteriseDocument(pieces, w, h) {
  const url = URL.createObjectURL(new Blob(pieces, { type: 'image/svg+xml' }));
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
  let shownIndex = -1;
  let busy = false;
  let warnedAboutDefs = false;
  const queue = [];
  const documents = [];       // per frame, the pieces its document is made of

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

  /**
   * The document pieces for one frame: just the drawings it uses, or — if the file turns
   * out to hold a reference the definitions cannot answer — the whole thing, which is
   * slower but always complete. The complaint is made once, not every frame.
   *
   * Worked out once per frame and kept: the array holds references to strings the file
   * already has, so remembering all 31 costs nothing, while working them out again would
   * mean scanning every definition for references on every single frame.
   */
  function documentFor(index) {
    if (documents[index]) return documents[index];
    let pieces;
    try {
      pieces = buildFrameParts(parts, index);
    } catch (err) {
      if (!warnedAboutDefs) {
        warnedAboutDefs = true;
        console.warn('title: using the full definitions for every frame:', err);
      }
      pieces = [buildFullFrameDocument(parts, index)];
    }
    documents[index] = pieces;
    return pieces;
  }

  /** Starts the next frame in the queue, unless one is already being prepared. */
  function pump() {
    if (status !== 'ready' || busy || queue.length === 0) return;
    const index = queue.shift();
    if (cache.has(index)) { pump(); return; }
    const at = scale;
    const [w, h] = rasterFrameSize(size, at);
    busy = true;
    rasterise(documentFor(index), w, h).then((bitmap) => {
      busy = false;
      if (!bitmap) { fail(new Error('the frame could not be rasterised')); return; }
      // The scale may have changed while this frame was being prepared; that bitmap is
      // the wrong size for the cache, but it is still a picture, so it may be shown.
      if (at === scale) cache.set(index, bitmap);
      shown = bitmap;
      shownIndex = index;
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
      const i = wrapIndex(index, n);
      const ready = cache.get(i);
      if (ready) { shown = ready; shownIndex = i; }
      // What to prepare, in order: the frame wanted now and the two that follow it. The
      // queue is rebuilt on every draw rather than appended to, so it can never hold a
      // frame the animation has already gone past — a stale entry would cost a whole
      // frame's worth of work and push the picture further behind.
      queue.length = 0;
      for (let ahead = 0; ahead < PREPARE_AHEAD + 1; ahead += 1) {
        const at = (i + ahead) % n;
        if (!cache.has(at) && !queue.includes(at)) queue.push(at);
      }
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
    /** Which frame the last `draw` actually put on screen, or -1 before the first one. */
    shownFrame: () => shownIndex,
    release() {
      cache.clear();
      shown = null;
      shownIndex = -1;
      queue.length = 0;
    },
  };
}
