// Manifest-driven image loader.
// `normalizeSpriteEntry` is pure (Node-testable); the image loading itself is browser-only.
//
// The game draws one set of art: the vector drawings of the 2013 symbols. A sprite entry in
// assets/manifest.json has one of four forms:
//   "path.svg"
//   { "file": "path.svg", "anchor": [x, y] }
//   { "frames": [...], "fps": n, "anchor"?: [x, y] }
//   { "frames": [...], "durations": [ticks...], "anchor"?: [x, y] }
// plus three fields of its own: `size` is the exact logical viewport [w, h] (fractional, so
// the image centre is not a safe default and `anchor` is always spelled out), `notext` names
// a variant of the file with the baked-in caption removed, and `textOnly` marks a symbol
// that is nothing but its caption and has no artwork to draw at all.
// `anchor` is in logical pixels from the top-left of that viewport.
//
// A fifth form, `layered`, is one file holding every frame of an animation at once (the
// title screen). It is too big to hold as bitmaps and is not blitted like a sprite, so the
// loader only hands the entry over — js/core/title-frames.js does the rest.
//
// A drawing that does not arrive is asked for once more and then given up on: the key is
// named in a single warning and simply is not drawn. Nothing the game does depends on its
// art — the physics, the collisions and the captions are all independent of it — so a
// missing file costs a picture and never a playable game.
import { W, H } from '../config.js';
import { deviceScale, snapToDevice } from './canvas.js';

export function normalizeSpriteEntry(entry) {
  if (typeof entry === 'string') {
    return { frames: [entry], timing: null, anchor: null, size: null, notext: null, textOnly: false };
  }
  if (!entry || typeof entry !== 'object') {
    throw new Error(`normalizeSpriteEntry: unsupported entry ${JSON.stringify(entry)}`);
  }
  const pair = (value) => (Array.isArray(value) && value.length === 2 ? [Number(value[0]), Number(value[1])] : null);
  const anchor = pair(entry.anchor);
  const size = pair(entry.size);
  const notext = typeof entry.notext === 'string' ? entry.notext : null;
  const textOnly = entry.textOnly === true;

  if (Array.isArray(entry.frames)) {
    if (entry.frames.length === 0) throw new Error('normalizeSpriteEntry: empty frames array');
    const frames = entry.frames.slice();
    let timing = null;
    if (Array.isArray(entry.durations)) {
      if (entry.durations.length !== frames.length) {
        throw new Error(`normalizeSpriteEntry: durations length ${entry.durations.length} does not match ${frames.length} frames`);
      }
      timing = entry.durations.map(Number);
    } else if (typeof entry.fps === 'number' && entry.fps > 0) {
      timing = entry.fps;
    }
    return { frames, timing, anchor, size, notext, textOnly };
  }

  if (typeof entry.file === 'string') {
    return { frames: [entry.file], timing: null, anchor, size, notext, textOnly };
  }
  throw new Error(`normalizeSpriteEntry: entry has neither "frames" nor "file": ${JSON.stringify(entry)}`);
}

/**
 * A `layered` vector entry -> { file, frameCount, durations, size, anchor }, or null when
 * the entry is not one. One SVG file carries every frame of the animation; `frameCount`
 * says how many it holds and `durations` are the 60 Hz holds, one per frame, exactly as
 * on the sprite it mirrors. Pure, so the manifest test can check the entry against the
 * file without a browser.
 */
export function layeredEntry(entry) {
  if (!entry || typeof entry !== 'object' || entry.layered !== true) return null;
  if (typeof entry.file !== 'string' || entry.file === '') {
    throw new Error('layeredEntry: a layered entry needs a "file"');
  }
  const frameCount = Number(entry.frameCount);
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error(`layeredEntry: ${entry.file} needs a positive integer "frameCount"`);
  }
  const durations = Array.isArray(entry.durations) ? entry.durations.map(Number) : null;
  if (durations && durations.length !== frameCount) {
    throw new Error(`layeredEntry: ${entry.file} has ${durations.length} durations for ${frameCount} frames`);
  }
  const pair = (value) => (Array.isArray(value) && value.length === 2 ? [Number(value[0]), Number(value[1])] : null);
  const size = pair(entry.size);
  if (!size || !(size[0] > 0) || !(size[1] > 0)) {
    throw new Error(`layeredEntry: ${entry.file} needs a positive "size"`);
  }
  return { file: entry.file, frameCount, durations, size, anchor: pair(entry.anchor) || [0, 0] };
}

/**
 * Which files a sprite is really drawn from:
 *
 *   'vector'  the SVG frames, rasterised once per device scale (the art is resolution-free)
 *   'none'    nothing is loaded: the symbol is nothing but its caption (`textOnly`), which
 *             js/scenes/captions.js draws in the game's own font
 *
 * A symbol that carries both art and a caption ships a `notext` variant; that variant is
 * what gets drawn, and the caption is drawn over it at runtime.
 *
 * An entry that cannot say how big its drawing is could only be placed by guesswork, so it
 * is rejected here and the loader skips that one key.
 */
export function spriteSource(spec) {
  if (!spec || !Array.isArray(spec.size) || !(spec.size[0] > 0) || !(spec.size[1] > 0)) {
    throw new Error('spriteSource: a sprite entry needs a positive size');
  }
  if (spec.textOnly) return { kind: 'none', frames: [], timing: null, anchor: spec.anchor, size: spec.size };
  const frames = spec.notext ? [spec.notext] : spec.frames;
  return { kind: 'vector', frames, timing: spec.timing, anchor: spec.anchor, size: spec.size };
}

/**
 * The URL to ask for a frame that did not arrive the first time. The query makes it a
 * different resource as far as the cache is concerned, so a transient failure that the
 * browser has already memoised is not simply replayed.
 */
export function retryUrl(url, token = Date.now()) {
  return `${url}${String(url).includes('?') ? '&' : '?'}retry=${token}`;
}

/**
 * What to make of a sprite's frames once every load has settled: which images can be used,
 * whether the recorded timing still describes them, whether the key is worth keeping at
 * all, and the **single** warning to print for it (null when nothing went wrong).
 *
 * One line per key, naming the key, whether it lost one frame or all of them: a failure
 * has to be visible in the console without being able to flood it.
 */
export function frameOutcome(name, images, timing = null) {
  const usable = images.filter(Boolean);
  if (usable.length === 0) {
    return { images: usable, timing: null, drop: true, warning: `assets: "${name}" could not be loaded and is not drawn` };
  }
  if (usable.length === images.length) return { images: usable, timing, drop: false, warning: null };
  return {
    images: usable,
    // Some frames are gone, so the per-frame holds no longer line up: hold frame 0 instead.
    timing: Array.isArray(timing) ? null : timing,
    drop: false,
    warning: `assets: "${name}" is missing ${images.length - usable.length} of ${images.length} frames`,
  };
}

/** The offscreen bitmap one vector frame needs at `scale`, in whole device pixels. */
export function rasterFrameSize(size, scale) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return [Math.max(1, Math.ceil(size[0] * s)), Math.max(1, Math.ceil(size[1] * s))];
}

/**
 * Whether a vector frame is worth caching as a bitmap. Caching buys ~0.05 ms a blit, which
 * matters for the dozens of sprites a game frame draws, but a symbol that covers half the
 * field or more would cost megabytes to hold at three device pixels per logical one. Those
 * are drawn straight from the SVG, which the browser rasterises at the destination size and
 * is therefore just as crisp.
 */
export function isCacheable(size) {
  return Array.isArray(size) && size[0] * size[1] <= (W * H) / 2;
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * One frame, with a second attempt past the cache. Nothing is said here: the whole sprite
 * is reported once, by `frameOutcome`, after every one of its frames has settled.
 */
async function loadFrame(url) {
  const first = await loadImage(url);
  return first || loadImage(retryUrl(url));
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/**
 * Draws one vector frame into an offscreen canvas of whole device pixels. The art is drawn
 * at exactly `size * scale`, so the bitmap maps 1:1 onto the screen and the up-to-one-pixel
 * remainder of the rounded canvas stays transparent.
 */
function rasteriseFrame(image, size, scale) {
  const [w, h] = rasterFrameSize(size, scale);
  const canvas = makeCanvas(w, h);
  const c = canvas.getContext('2d');
  if (!c) return null;
  c.clearRect(0, 0, w, h);
  c.imageSmoothingEnabled = true;
  c.drawImage(image, 0, 0, size[0] * scale, size[1] * scale);
  return canvas;
}

// Loads every sprite in the manifest. A missing or broken drawing never rejects the whole
// load: the key is named once and simply reports has(name) === false from then on.
//
// `onProgress(done, total)` is called once the manifest has said how many frames there are
// and then after every single one of them settles, loaded or not — it counts what has been
// waited for, which is what the loading screen's bar is driven by. It is optional and it is
// never allowed to break a load: a callback that throws is ignored.
export async function loadAssets(manifestUrl, { onProgress = null } = {}) {
  let manifest = { sprites: {}, audio: {}, fonts: {} };
  try {
    const res = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    console.warn(`assets: could not load the manifest ${manifestUrl}:`, err);
  }

  const specs = new Map();    // every key that has a box, drawn or not
  const layers = new Map();   // the symbols that live in one file of their own
  const sprites = new Map();  // the ones with images to blit
  const jobs = [];
  let total = 0;              // known once every key has been walked, below
  let settled = 0;
  const report = () => {
    if (typeof onProgress !== 'function') return;
    try {
      onProgress(settled, total);
    } catch (err) {
      console.warn('assets: the progress callback threw:', err);
      onProgress = null;
    }
  };
  for (const [name, entry] of Object.entries(manifest.sprites || {})) {
    let source;
    let spec;
    try {
      const layered = layeredEntry(entry);
      if (layered) { layers.set(name, layered); continue; }
      spec = normalizeSpriteEntry(entry);
      source = spriteSource(spec);
    } catch (err) {
      console.warn(`assets: skipping sprite "${name}":`, err);
      continue;
    }
    specs.set(name, spec);
    if (source.kind === 'none') continue;   // drawn as text, nothing to fetch
    const record = {
      images: new Array(source.frames.length).fill(null),
      bitmaps: null,
      timing: source.timing,
      anchor: source.anchor,
      size: source.size,
    };
    sprites.set(name, record);
    source.frames.forEach((url, i) => {
      jobs.push(loadFrame(url).then((img) => {
        record.images[i] = img;
        settled += 1;
        report();
      }));
    });
  }
  // A frame can only settle on a network event, i.e. never during the loop above, so the
  // first thing anyone hears is this: nothing done out of everything there is.
  total = jobs.length;
  report();
  await Promise.all(jobs);

  // Every frame has been asked for twice by now. Whatever arrived is what the sprite has;
  // a key that lost frames says so once and the game carries on without that picture.
  for (const [name, record] of sprites) {
    const outcome = frameOutcome(name, record.images, record.timing);
    if (outcome.warning) console.warn(outcome.warning);
    if (outcome.drop) { sprites.delete(name); continue; }
    record.images = outcome.images;
    record.timing = outcome.timing;
  }

  // The scale the vector frames are currently rasterised at.
  let rasterScale = 0;

  /**
   * Rasterises every vector frame for a device scale. Called once after loading and again
   * whenever the canvas resolution changes; re-asking for the current scale costs nothing.
   */
  function rasterise(scale) {
    const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
    if (s === rasterScale) return;
    for (const record of sprites.values()) {
      record.bitmaps = isCacheable(record.size)
        ? record.images.map((image) => rasteriseFrame(image, record.size, s))
        : null;
    }
    rasterScale = s;
  }

  const has = (name) => sprites.has(name);
  const frameIndex = (record, frame) => {
    const n = record.images.length;
    return ((Math.floor(frame) % n) + n) % n;
  };
  const img = (name, frame = 0) => {
    const record = sprites.get(name);
    return record ? record.images[frameIndex(record, frame)] : null;
  };

  /**
   * Everything drawSprite needs for one frame: what to blit, the logical size to blit it
   * at, the registration point and whether the blit should be smoothed. A cached frame is
   * already at the device resolution, so its blit is ~1:1 and smoothing only softens the
   * sub-pixel remainder; an uncached one is drawn from the SVG at the destination size.
   */
  const frame = (name, index = 0) => {
    const record = sprites.get(name);
    if (!record || record.images.length === 0) return null;
    const i = frameIndex(record, index);
    const bitmap = record.bitmaps ? record.bitmaps[i] : null;
    if (bitmap) {
      return {
        source: bitmap, w: bitmap.width / rasterScale, h: bitmap.height / rasterScale,
        anchor: record.anchor, smooth: true,
      };
    }
    const image = record.images[i];
    if (!image || !image.width) return null;
    return { source: image, w: record.size[0], h: record.size[1], anchor: record.anchor, smooth: true };
  };

  /**
   * The logical size of a sprite: the viewport of its drawing. A symbol that is drawn as
   * text, and one whose art could not be loaded, have no frames but still have a box — the
   * scenes lay their buttons and their tap targets out on it.
   */
  const size = (name) => {
    const record = sprites.get(name) || specs.get(name) || layers.get(name);
    return record && record.size ? record.size.slice() : null;
  };

  const frameCount = (name) => (sprites.has(name) ? sprites.get(name).images.length : 0);
  const timing = (name) => (sprites.has(name) ? sprites.get(name).timing : null);
  const anchor = (name) => {
    const record = sprites.get(name) || specs.get(name) || layers.get(name);
    if (record && record.anchor) return record.anchor;
    const wh = size(name);
    return wh ? [wh[0] / 2, wh[1] / 2] : null;
  };

  /** The layered entry of a symbol, or null — see js/core/title-frames.js. */
  const layered = (name) => layers.get(name) || null;

  return { img, frame, has, size, frameCount, timing, anchor, rasterise, layered, manifest };
}

// Draws one frame so that the sprite's anchor (its centre when there is no anchor)
// lands on (x, y); the rotation happens about that same point.
// Silently does nothing when the sprite is missing, so a failed asset never breaks a scene.
//
// The destination is snapped to a whole device pixel, not to a whole logical one: the
// canvas is drawn at the display's resolution, so that is where the pixel grid actually is.
export function drawSprite(ctx, assets, name, frame = 0, x = 0, y = 0, rotationDeg = 0) {
  if (!ctx || !assets || !assets.frame) return;
  const f = assets.frame(name, frame);
  if (!f) return;
  const a = f.anchor || [f.w / 2, f.h / 2];
  const s = deviceScale(ctx);
  ctx.save();
  ctx.imageSmoothingEnabled = f.smooth;
  if (rotationDeg) {
    ctx.translate(snapToDevice(x, s), snapToDevice(y, s));
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(f.source, -a[0], -a[1], f.w, f.h);
  } else {
    ctx.drawImage(f.source, snapToDevice(x - a[0], s), snapToDevice(y - a[1], s), f.w, f.h);
  }
  ctx.restore();
}
