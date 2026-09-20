// The title screen is one SVG file holding all 31 frames of the original animation:
// a shared <defs> with every drawing stored once, then 31 frame groups of <use>
// elements, each preceded by an exact marker comment (assets/sprites/titleBg.svg,
// built by tools/make-title.py).
//
// Showing it is a trade between download, memory and time:
//
//   * the file is downloaded once, as text. Cutting a frame out of it is plain string
//     slicing between the markers — there is no XML parser at runtime;
//   * a frame is rasterised into an offscreen canvas of whole device pixels
//     (Blob -> object URL -> Image -> decode() -> drawImage -> revoke), which takes about
//     20 ms whatever the scale — most of it is parsing the document;
//   * **a frame document carries only the drawings that frame uses.** Nearly all of the
//     time to prepare a frame is the browser parsing the document, so handing it all 295
//     definitions when about half are referenced costs about half the frame rate. The
//     definitions sit one per line inside `<defs>`, so they are indexed by id once and
//     the referenced ones — transitively, should a drawing ever point at another — are
//     collected by string search.
//
// The animation is a **loop**: 31 keyframes over 40 ticks, i.e. a different one 46.5 times
// a second. Rasterising on demand can therefore never keep up — that is a second of CPU
// per second of animation — so the whole loop has to be held. Holding it as 31 full frames
// costs 33.5 MB at scale 1 and 134 MB at scale 2, which is too much for a phone; but only
// 11.76 % of the field's pixels ever change over the loop.
//
// So the loop is kept as **one base frame plus, for every other keyframe, only the tiles
// that differ from it**: the field is cut into 12x9 tiles of 50 logical pixels, a keyframe
// is rasterised once, its tiles are compared with the base's, and the ones that changed are
// packed into a strip of a canvas — 14 MB for the loop at scale 1, 58 MB at scale 2, held
// under a budget that drops the scale a step rather than overrun it. Drawing a keyframe is
// then one blit of the base plus one blit per changed tile (0.2 ms), and the steady state
// rasterises nothing at all: 46.5 keyframes a second, none skipped, the page at 60 Hz.
//
// Nothing here ever blocks the render loop. Keyframes are prepared one at a time, in
// timeline order from the playhead, with a yield between the decode and the diff, so the
// whole loop is ready in 1.1 s (scale 1) to 1.6 s (scale 2) without the page dropping a
// frame; `draw` returns immediately and blits the most recent keyframe that is ready.

import { W, H } from '../config.js';
import { rasterFrameSize } from './assets.js';

/**
 * The render scale a title frame is ever rasterised at. The field is 600x450, so scale 3
 * would cost 1800x1350x4 = 9.7 MB for the base frame alone, for a sharpness nobody can see
 * on artwork this soft. Above the cap the bitmaps are simply blitted a little larger.
 */
export const MAX_TITLE_SCALE = 2;

/**
 * The side of one tile, in logical pixels: the field is 12 x 9 of them. Small enough that a
 * twinkling star costs one tile rather than a quarter of the screen, large enough that a
 * keyframe is a few dozen blits rather than a few thousand.
 */
export const TILE_SIZE = 50;

/**
 * How far a channel may drift before a tile counts as changed. The same drawing rasterises
 * identically, so this only absorbs renderer noise; it is not a similarity threshold.
 */
export const TILE_TOLERANCE = 2;

/** The scales the cache steps down through when the whole loop will not fit its budget. */
export const TITLE_SCALE_STEPS = [2, 1.5, 1];

/**
 * What the whole loop may cost in bitmaps. The base plus the patch atlases are counted as
 * width x height x 4; going over drops to the next scale step, so a desktop keeps the full
 * resolution and a small device quietly gets a coarser one instead of running out of memory.
 */
export const TITLE_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;

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

// --- The tile grid, the diff and the patch atlas ---------------------------------------
// All pure: buffers and numbers in, numbers out, so tests/title-frames.test.js covers the
// whole of the cache's arithmetic without a canvas.

/**
 * The field cut into tiles of `tile` logical pixels, expressed in the device pixels of a
 * frame rasterised at `scale`. Row-major, `cols * rows` of them.
 *
 * Left and top are floored, right and bottom ceiled, so at a fractional scale two
 * neighbouring tiles overlap by at most one device pixel and **never leave a gap** — a gap
 * would show as a seam of the base frame along a tile border. The outer edges are clamped
 * to the canvas, whose size is the one `rasterFrameSize` gives the rasteriser.
 */
export function tileGrid(size, scale, tile = TILE_SIZE) {
  const [width, height] = rasterFrameSize(size, scale);
  const side = Math.max(1, tile);
  const cols = Math.max(1, Math.ceil(size[0] / side));
  const rows = Math.max(1, Math.ceil(size[1] / side));
  // The last column and row end on the canvas edge; the ones before them are ceiled.
  const from = (n, limit) => Math.min(limit, Math.max(0, Math.floor(n * side * scale)));
  const to = (n, count, limit) => (n + 1 >= count ? limit : Math.min(limit, Math.ceil((n + 1) * side * scale)));
  const rects = [];
  for (let row = 0; row < rows; row += 1) {
    const y = from(row, height);
    const y1 = to(row, rows, height);
    for (let col = 0; col < cols; col += 1) {
      const x = from(col, width);
      rects.push({ x, y, w: Math.max(1, to(col, cols, width) - x), h: Math.max(1, y1 - y) });
    }
  }
  return { cols, rows, width, height, tile: side, rects };
}

/**
 * Which of `rects` hold a pixel where `shot` differs from `base` by more than `tolerance`
 * on any channel, alpha included. Both buffers are RGBA rows of `width` pixels.
 * The indices come back in the order of `rects`, i.e. row-major.
 *
 * Reading the whole canvas once and slicing it here is measurably faster than one
 * `getImageData` per tile: 108 readbacks of a 100x100 region cost more in call overhead
 * than one readback of the frame costs in copying.
 */
export function changedTiles(shot, base, width, rects, tolerance = TILE_TOLERANCE) {
  const stride = width * 4;
  const out = [];
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    const bytes = r.w * 4;
    let differs = false;
    for (let y = r.y; y < r.y + r.h && !differs; y += 1) {
      const from = y * stride + r.x * 4;
      for (let p = from; p < from + bytes; p += 1) {
        const d = shot[p] - base[p];
        if (d > tolerance || d < -tolerance) { differs = true; break; }
      }
    }
    if (differs) out.push(i);
  }
  return out;
}

/**
 * The changed tiles of one keyframe packed side by side into a single strip: where each
 * one sits in the atlas (`sx`, `sy`), where it belongs on the frame (`dx`, `dy`) and how
 * big it is. A strip rather than a square keeps the packing trivial and exact — no wasted
 * rows, no bin packing — and `bytes` is what that canvas costs.
 */
export function packPatchAtlas(rects, changed) {
  const patches = [];
  let width = 0;
  let height = 0;
  for (const index of changed) {
    const r = rects[index];
    if (!r) continue;
    patches.push({ sx: width, sy: 0, dx: r.x, dy: r.y, w: r.w, h: r.h });
    width += r.w;
    if (r.h > height) height = r.h;
  }
  if (patches.length === 0) return { width: 0, height: 0, bytes: 0, patches };
  return { width, height, bytes: width * height * 4, patches };
}

/** The whole loop starting at `start`, in timeline order: [start, start+1, ...] wrapped. */
export function preparationOrder(count, start) {
  const n = Math.max(0, Math.floor(count) || 0);
  if (n === 0) return [];
  const from = wrapIndex(start, n);
  const out = [];
  for (let i = 0; i < n; i += 1) out.push((from + i) % n);
  return out;
}

/**
 * Which keyframe to put on screen when `wanted` is not prepared yet: the most recent
 * prepared one at or before it, walking backwards around the loop. Never a later one — the
 * animation would visibly jump forward and back — and -1 when nothing is ready at all.
 */
export function shownKeyframe(prepared, wanted) {
  const n = prepared.length;
  if (n === 0) return -1;
  let i = wrapIndex(wanted, n);
  for (let step = 0; step < n; step += 1) {
    if (prepared[i]) return i;
    i = (i - 1 + n) % n;
  }
  return -1;
}

/**
 * What the whole loop will cost once it is prepared, from the keyframes measured so far:
 * the base frame plus the average patch atlas over the `total` keyframes that need one.
 */
export function projectedCacheBytes(baseBytes, patchBytes, done, total) {
  if (!(done > 0)) return baseBytes;
  return baseBytes + Math.ceil((patchBytes / done) * total);
}

/** The scale the cache rasterises at for a given render scale: the display's, up to the cap. */
export function titleCacheScale(renderScale, maxScale = MAX_TITLE_SCALE) {
  const s = Number(renderScale);
  return Math.min(Math.max(Number.isFinite(s) && s > 0 ? s : 1, 1), maxScale);
}

/** The next step down from `scale`, or null when it is already at the floor. */
export function nextTitleScale(scale, steps = TITLE_SCALE_STEPS) {
  let best = null;
  for (const step of steps) {
    if (step < scale && (best === null || step > best)) best = step;
  }
  return best;
}

// --- The browser half ------------------------------------------------------------------

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/**
 * Decodes one frame document into an `Image`. `pieces` is the array `buildFrameParts`
 * returns; Blob concatenates it itself, so the megabyte-sized string is never built.
 * The object URL stays alive until `release()`, because the image is only readable while
 * its source is.
 *
 * `createImageBitmap` would be the obvious alternative to the Image-and-canvas dance, but
 * Chrome rejects an SVG blob outright, so there is nothing to choose between.
 */
async function decodeDocument(pieces) {
  const url = URL.createObjectURL(new Blob(pieces, { type: 'image/svg+xml' }));
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  return { image, release: () => URL.revokeObjectURL(url) };
}

/**
 * The uniform part of a context's transform — where the logical origin sits in device
 * pixels and how many of them one logical pixel covers — or null when the transform is not
 * a plain scale-and-translate (or cannot be read at all).
 */
function readTransform(ctx) {
  if (!ctx || typeof ctx.getTransform !== 'function') return null;
  try {
    const t = ctx.getTransform();
    if (!t || t.b !== 0 || t.c !== 0) return null;
    if (!(t.a > 0) || Math.abs(t.a - t.d) > 1e-9) return null;
    return { scale: t.a, x: t.e, y: t.f };
  } catch {
    return null;
  }
}

/**
 * Hands the main thread back to the page. Waiting for a paint and then for a task means
 * the decode of one keyframe and the diff of the previous one never land in the same frame
 * as each other, so the menu keeps repainting while the loop is being prepared.
 */
function yieldToPage() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function fetchDocumentText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const now = () => (typeof performance === 'object' && performance && typeof performance.now === 'function'
  ? performance.now() : Date.now());

/**
 * createTitleFrames({ url, size }) -> { draw, failed, frameCount, release, stats }
 *
 * `draw(ctx, index, scale)` paints the field-sized keyframe at the origin and returns
 * whether anything was painted. It never waits: the file is fetched on the first call, the
 * loop is prepared one keyframe at a time in the background, and until a keyframe is ready
 * the most recent prepared one before it stands in. Once the loop is prepared, drawing is
 * one blit of the base frame plus one per tile that keyframe changes, and nothing is
 * rasterised ever again.
 *
 * A change of render scale throws the cache away and prepares it again at the new scale,
 * showing the old base stretched in the meantime, so the screen never goes blank.
 *
 * `failed()` is true once the file could not be fetched or a keyframe could not be decoded;
 * from then on `draw` returns false without painting, one warning has named the title, and
 * the caller keeps whatever it draws behind the artwork.
 */
export function createTitleFrames({
  url,
  size = [W, H],
  maxScale = MAX_TITLE_SCALE,
  budgetBytes = TITLE_CACHE_BUDGET_BYTES,
  tile = TILE_SIZE,
  loadText = fetchDocumentText,
  decodeFrame = decodeDocument,
  yieldToLoop = yieldToPage,
} = {}) {
  let status = 'idle';        // idle -> loading -> ready, or failed
  let parts = null;
  const documents = [];       // per keyframe, the pieces its document is made of
  let warnedAboutDefs = false;

  // The cache. Everything below is thrown away and built again when the scale changes;
  // `generation` is what tells work that is already in flight that it is stale.
  let generation = 0;
  let scale = 0;              // what the cache is being built at
  let asked = 0;              // the render scale the caller last asked for
  let grid = null;
  let base = null;            // the one full keyframe every other one is a patch of
  let baseData = null;        // its pixels; kept only while the loop is being prepared
  let baseBytes = 0;
  let patches = [];           // per keyframe { canvas, list } — the tiles that differ
  let patchBytes = 0;
  let patchesDone = 0;
  let tileCounts = [];
  let prepared = [];
  let preparedCount = 0;
  let order = null;
  let cursor = 0;
  let busy = false;
  let scratch = null;         // reused for every keyframe; read back, never shown
  let scratchCtx = null;
  let previous = null;        // the base of the scale being left, shown stretched
  let shownIndex = -1;
  let startedAt = 0;
  let decodeMs = 0;           // summed time in the rasteriser
  let prepareMs = 0;          // summed time in the diff and the packing
  let prepareWallMs = 0;      // wall clock from the first keyframe to the last

  // Said once, never per frame: from here on `draw` paints nothing and the menu keeps its
  // own flat backdrop, with its labels and buttons, which never needed the artwork.
  function fail(err) {
    if (status === 'failed') return;
    status = 'failed';
    console.warn('title: the artwork could not be shown:', err);
  }

  function start() {
    if (status !== 'idle') return;
    status = 'loading';
    loadText(url).then((text) => {
      parts = sliceTitleFrames(text);
      status = 'ready';
      resetCache(false);
    }).catch(fail);
  }

  /**
   * The document pieces for one keyframe: just the drawings it uses, or — if the file turns
   * out to hold a reference the definitions cannot answer — the whole thing, which is
   * slower but always complete. The complaint is made once, not every frame.
   *
   * Worked out once per keyframe and kept: the array holds references to strings the file
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

  const count = () => (parts ? parts.frames.length : 0);

  /**
   * Drops the whole cache and starts again at the current `scale`. The base of the scale
   * being left is kept as `previous` so that `draw` has something to show — stretched —
   * until the new base is ready; a resize must never blank the title.
   */
  function resetCache(keepForDisplay = true) {
    generation += 1;
    if (keepForDisplay && base) previous = base;
    base = null;
    baseData = null;
    baseBytes = 0;
    patches = [];
    patchBytes = 0;
    patchesDone = 0;
    tileCounts = [];
    prepared = new Array(count()).fill(false);
    preparedCount = 0;
    order = null;
    cursor = 0;
    scratch = null;
    scratchCtx = null;
    grid = scale > 0 ? tileGrid(size, scale, tile) : null;
    startedAt = 0;
    decodeMs = 0;
    prepareMs = 0;
    prepareWallMs = 0;
  }

  /** The loop is complete: the readback buffers are dead weight from here on. */
  function finish() {
    if (!scratch && !baseData && !previous) return;
    scratch = null;
    scratchCtx = null;
    baseData = null;
    previous = null;
  }

  function ensureScratch(w, h) {
    if (scratch && scratch.width === w && scratch.height === h) return true;
    scratch = makeCanvas(w, h);
    scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
    return Boolean(scratchCtx);
  }

  /**
   * Rasterises one keyframe and either keeps it whole (the first one prepared becomes the
   * base) or reduces it to the tiles that differ from the base.
   *
   * Returns 'done', 'stale' if the scale changed underneath it, or 'overbudget' if the
   * loop is on course to cost more than it may.
   */
  async function prepareKeyframe(index, mine) {
    const at = scale;
    const [w, h] = rasterFrameSize(size, at);
    const decodedAt = now();
    const handle = await decodeFrame(documentFor(index));
    decodeMs += now() - decodedAt;
    if (mine !== generation) { handle.release(); return 'stale'; }
    // The decode is main-thread work; let the page paint before the diff starts.
    await yieldToLoop();
    if (mine !== generation) { handle.release(); return 'stale'; }

    const t0 = now();
    try {
      if (!ensureScratch(w, h)) throw new Error('no 2d context for the title cache');
      scratchCtx.imageSmoothingEnabled = true;
      scratchCtx.clearRect(0, 0, w, h);
      scratchCtx.drawImage(handle.image, 0, 0, w, h);
    } finally {
      handle.release();
    }

    if (!base) {
      base = makeCanvas(w, h);
      const c = base.getContext('2d');
      if (!c) throw new Error('no 2d context for the title base frame');
      c.drawImage(scratch, 0, 0);
      baseData = scratchCtx.getImageData(0, 0, w, h).data;
      baseBytes = w * h * 4;
      previous = null;
      tileCounts[index] = 0;
      patches[index] = null;
    } else {
      const shot = scratchCtx.getImageData(0, 0, w, h).data;
      const changed = changedTiles(shot, baseData, w, grid.rects);
      const atlas = packPatchAtlas(grid.rects, changed);
      let canvas = null;
      if (atlas.patches.length > 0) {
        canvas = makeCanvas(atlas.width, atlas.height);
        const c = canvas.getContext('2d');
        if (!c) throw new Error('no 2d context for a title patch');
        c.imageSmoothingEnabled = false;
        for (const p of atlas.patches) c.drawImage(scratch, p.dx, p.dy, p.w, p.h, p.sx, p.sy, p.w, p.h);
      }
      patches[index] = canvas ? { canvas, list: atlas.patches } : null;
      patchBytes += atlas.bytes;
      patchesDone += 1;
      tileCounts[index] = atlas.patches.length;
    }
    prepared[index] = true;
    preparedCount += 1;
    prepareMs += now() - t0;
    prepareWallMs = now() - startedAt;

    // Re-checked as the loop goes: the first few keyframes already say what the rest will
    // cost, and dropping a step early is far cheaper than finding out at the last one.
    const projected = projectedCacheBytes(baseBytes, patchBytes, patchesDone, Math.max(0, count() - 1));
    if (projected > budgetBytes && nextTitleScale(scale) !== null) return 'overbudget';
    return 'done';
  }

  /** Prepares the next keyframe of the sweep, unless one is already being prepared. */
  function pump() {
    if (status !== 'ready' || busy || !order || scale <= 0) return;
    while (cursor < order.length && prepared[order[cursor]]) cursor += 1;
    if (cursor >= order.length) { finish(); return; }
    if (startedAt === 0) startedAt = now();
    const index = order[cursor];
    const mine = generation;
    busy = true;
    prepareKeyframe(index, mine).then((result) => {
      busy = false;
      if (result === 'stale') { pump(); return; }
      if (mine !== generation) { pump(); return; }
      if (result === 'overbudget') {
        const lower = nextTitleScale(scale);
        console.info(`title: the loop does not fit ${budgetBytes} bytes at scale ${scale}, dropping to ${lower}`);
        scale = lower;
        resetCache();
        pump();
        return;
      }
      cursor += 1;
      pump();
    }).catch((err) => { busy = false; fail(err); });
  }

  /**
   * Blits one prepared keyframe: the base, then the tiles that keyframe changes.
   *
   * The cache holds whole device pixels, so it is blitted in device space: with the
   * context's own scale undone, the base and every patch land on whole device pixels and,
   * at the scale the cache was built for, they are copied one for one. Asking the context
   * to place them in logical units instead costs a subpixel resample of the entire picture
   * — which is invisible on the base alone but shows as a shimmer along the patch borders.
   * Edges are taken as the difference of two rounded positions, never as a rounded width,
   * so neighbouring patches cannot leave a gap when the cache is stretched.
   */
  function blit(ctx, index) {
    const patch = patches[index];
    const view = readTransform(ctx);
    if (!view) {
      // A context that cannot report its transform (a very old canvas, a test stub): place
      // everything in logical units and let it resample.
      ctx.drawImage(base, 0, 0, size[0], size[1]);
      if (patch) {
        const kx = size[0] / grid.width;
        const ky = size[1] / grid.height;
        for (const p of patch.list) {
          ctx.drawImage(patch.canvas, p.sx, p.sy, p.w, p.h, p.dx * kx, p.dy * ky, p.w * kx, p.h * ky);
        }
      }
      return;
    }
    const k = view.scale / scale;          // device pixels per cache pixel
    const at = (origin, v) => Math.round(origin + v * k);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const x0 = at(view.x, 0);
    const y0 = at(view.y, 0);
    ctx.drawImage(base, x0, y0, at(view.x, grid.width) - x0, at(view.y, grid.height) - y0);
    if (!patch) return;
    for (const p of patch.list) {
      const px = at(view.x, p.dx);
      const py = at(view.y, p.dy);
      ctx.drawImage(patch.canvas, p.sx, p.sy, p.w, p.h,
        px, py, at(view.x, p.dx + p.w) - px, at(view.y, p.dy + p.h) - py);
    }
  }

  function draw(ctx, index, renderScale) {
    if (status === 'failed') return false;
    start();
    const wanted = titleCacheScale(renderScale, maxScale);
    if (wanted !== asked) {
      asked = wanted;
      scale = wanted;
      resetCache();
    }
    let show = -1;
    if (status === 'ready' && count() > 0) {
      const playhead = wrapIndex(index, count());
      // The sweep is laid out once, from wherever the animation stands when it starts, and
      // then runs in timeline order: the keyframes about to be wanted come first.
      if (!order) { order = preparationOrder(count(), playhead); cursor = 0; }
      pump();
      if (base) show = shownKeyframe(prepared, playhead);
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if (show >= 0) {
      blit(ctx, show);
      shownIndex = show;
    } else if (previous) {
      // Mid-rebuild after a resize: the old base, stretched, rather than nothing.
      ctx.drawImage(previous, 0, 0, size[0], size[1]);
    } else {
      ctx.restore();
      return false;
    }
    ctx.restore();
    return true;
  }

  return {
    draw,
    failed: () => status === 'failed',
    frameCount: count,
    /** Which keyframe the last `draw` actually put on screen, or -1 before the first one. */
    shownFrame: () => shownIndex,
    /** What the cache holds and what it cost — for measuring, not for drawing. */
    stats: () => ({
      scale,
      count: count(),
      prepared: preparedCount,
      complete: count() > 0 && preparedCount === count(),
      baseBytes,
      patchBytes,
      bytes: baseBytes + patchBytes,
      tiles: [...tileCounts],
      tilesPerKeyframe: grid ? grid.rects.length : 0,
      decodeMs,
      prepareMs,
      prepareWallMs,
    }),
    release() {
      scale = 0;
      asked = 0;
      resetCache(false);
      previous = null;
      shownIndex = -1;
    },
  };
}
