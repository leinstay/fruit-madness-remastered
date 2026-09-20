// Manifest-driven image loader.
// `normalizeSpriteEntry` is pure (Node-testable); the image loading itself is browser-only.
//
// A sprite entry in assets/manifest.json has one of four forms:
//   "path.png"
//   { "file": "path.png", "anchor": [x, y] }
//   { "frames": [...], "fps": n, "anchor"?: [x, y] }
//   { "frames": [...], "durations": [ticks...], "anchor"?: [x, y] }
// `anchor` is in image pixels from the top-left; absent means the image centre.
//
// The manifest's "vectors" map uses the same forms for the SVG versions of the same
// symbols, with three extra fields: `size` is the exact logical viewport [w, h] (fractional,
// so the image centre is no longer a safe default and `anchor` is always spelled out),
// `notext` names a variant of the file with the baked-in caption removed, and `textOnly`
// marks a symbol that is nothing but its caption and has no artwork to draw at all.
//
// A fifth form, `layered`, is one file holding every frame of an animation at once (the
// title screen). It is too big to hold as bitmaps and is not blitted like a sprite, so the
// loader only hands the entry over — js/core/title-frames.js does the rest.
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
 * Where a sprite is really drawn from. The manifest's `vectors` map holds the original
 * artwork; `sprites` holds the 2013 renders of the same symbols.
 *
 *   'vector'  the SVG frames, rasterised once per device scale (the art is resolution-free)
 *   'raster'  the PNG frames, blitted unsmoothed
 *
 *   'none'    nothing is loaded: the symbol is nothing but its caption (`textOnly`), which
 *             js/scenes/captions.js draws in the game's own font
 *
 * A symbol that carries both art and a caption ships a `notext` variant; that variant is
 * what gets drawn, and the caption is drawn over it at runtime.
 */
export function spriteSource(spec, vector) {
  const usable = vector && Array.isArray(vector.size) && vector.size[0] > 0 && vector.size[1] > 0;
  if (!usable) {
    return { kind: 'raster', frames: spec.frames, timing: spec.timing, anchor: spec.anchor, size: null };
  }
  if (vector.textOnly) return { kind: 'none', frames: [], timing: null, anchor: vector.anchor, size: vector.size };
  const frames = vector.notext ? [vector.notext] : vector.frames;
  return { kind: 'vector', frames, timing: vector.timing, anchor: vector.anchor, size: vector.size };
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
    img.onerror = () => {
      console.warn(`assets: failed to load ${url}`);
      resolve(null);
    };
    img.src = url;
  });
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

// Loads every sprite in the manifest. A missing or broken image never rejects the whole
// load: it is logged and the sprite simply reports has(name) === false.
export async function loadAssets(manifestUrl) {
  let manifest = { sprites: {}, vectors: {}, audio: {}, fonts: {} };
  try {
    const res = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    console.warn(`assets: could not load the manifest ${manifestUrl}:`, err);
  }

  const vectors = new Map();
  const layers = new Map();
  for (const [name, entry] of Object.entries(manifest.vectors || {})) {
    try {
      const layered = layeredEntry(entry);
      if (layered) layers.set(name, layered);
      else vectors.set(name, normalizeSpriteEntry(entry));
    } catch (err) {
      console.warn(`assets: skipping vector "${name}":`, err);
    }
  }

  const sprites = new Map();
  const specs = new Map();
  const jobs = [];
  for (const [name, entry] of Object.entries(manifest.sprites || {})) {
    let spec;
    try {
      spec = normalizeSpriteEntry(entry);
    } catch (err) {
      console.warn(`assets: skipping sprite "${name}":`, err);
      continue;
    }
    specs.set(name, spec);
    // A layered symbol is drawn from its one SVG file. Its raster frames are the fallback
    // and are only fetched if that ever fails, so nothing of them is downloaded normally.
    if (layers.has(name)) continue;
    const source = spriteSource(spec, vectors.get(name) || null);
    if (source.kind === 'none') continue;   // drawn as text, nothing to fetch
    const record = {
      kind: source.kind,
      images: new Array(source.frames.length).fill(null),
      bitmaps: null,
      timing: source.timing,
      anchor: source.anchor,
      size: source.size,
    };
    sprites.set(name, record);
    source.frames.forEach((url, i) => {
      jobs.push(loadImage(url).then((img) => { record.images[i] = img; }));
    });
  }
  await Promise.all(jobs);

  // A vector that would not load falls back to the 2013 render of the same symbol, so a
  // sprite can never go missing because one SVG failed.
  const retries = [];
  for (const [name, record] of sprites) {
    if (record.kind !== 'vector' || record.images.every(Boolean)) continue;
    console.warn(`assets: "${name}" falls back to its raster frames`);
    const spec = specs.get(name);
    record.kind = 'raster';
    record.size = null;
    record.anchor = spec.anchor;
    record.timing = spec.timing;
    record.images = new Array(spec.frames.length).fill(null);
    spec.frames.forEach((url, i) => {
      retries.push(loadImage(url).then((img) => { record.images[i] = img; }));
    });
  }
  await Promise.all(retries);

  for (const [name, record] of sprites) {
    record.images = record.images.filter(Boolean);
    if (record.images.length === 0) {
      console.warn(`assets: sprite "${name}" has no usable frames`);
      sprites.delete(name);
    } else if (Array.isArray(record.timing) && record.timing.length !== record.images.length) {
      record.timing = null; // some frames were lost; fall back to a static sprite
    }
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
      if (record.kind !== 'vector') continue;
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
   * at, the registration point and whether the blit should be smoothed. A vector frame is
   * already at the device resolution, so its blit is ~1:1 and smoothing only softens the
   * sub-pixel remainder; a raster frame is scaled up and must stay hard-edged.
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
    if (record.size) {
      return { source: image, w: record.size[0], h: record.size[1], anchor: record.anchor, smooth: true };
    }
    return {
      source: image, w: image.width, h: image.height,
      anchor: record.anchor || [image.width / 2, image.height / 2], smooth: false,
    };
  };

  /**
   * The logical size of a sprite: its vector viewport, or the natural size of its PNG.
   * A symbol that is drawn as text has no frames but still has a box — the scenes lay their
   * buttons and their tap targets out on it.
   */
  const size = (name) => {
    const record = sprites.get(name);
    if (!record) {
      const spec = vectors.get(name) || layers.get(name);
      return spec && spec.size ? spec.size.slice() : null;
    }
    if (record.size) return record.size.slice();
    const image = record.images[0];
    return image && image.width ? [image.width, image.height] : null;
  };

  const frameCount = (name) => (sprites.has(name) ? sprites.get(name).images.length : 0);
  const timing = (name) => (sprites.has(name) ? sprites.get(name).timing : null);
  const anchor = (name) => {
    const record = sprites.get(name);
    if (record && record.anchor) return record.anchor;
    if (!record) {
      const spec = vectors.get(name) || layers.get(name);
      if (spec && spec.anchor) return spec.anchor;
    }
    const wh = size(name);
    return wh ? [wh[0] / 2, wh[1] / 2] : null;
  };

  /** The layered vector entry of a symbol, or null — see js/core/title-frames.js. */
  const layered = (name) => layers.get(name) || null;

  /**
   * Loads the 2013 raster frames of a symbol that was skipped because it is drawn from a
   * layered vector. This is the fallback for a vector that could not be fetched or
   * decoded, and is why those frames are not downloaded in the normal case. Resolves to
   * whether the symbol can be drawn afterwards; calling it twice is harmless.
   */
  async function loadRasterFrames(name) {
    if (sprites.has(name)) return true;
    const spec = specs.get(name);
    if (!spec) return false;
    const images = await Promise.all(spec.frames.map(loadImage));
    const usable = images.filter(Boolean);
    if (usable.length === 0) {
      console.warn(`assets: "${name}" has no usable raster frames either`);
      return false;
    }
    sprites.set(name, {
      kind: 'raster',
      images: usable,
      bitmaps: null,
      timing: Array.isArray(spec.timing) && spec.timing.length !== usable.length ? null : spec.timing,
      anchor: spec.anchor,
      size: null,
    });
    return true;
  }

  return {
    img, frame, has, size, frameCount, timing, anchor, rasterise,
    layered, loadRasterFrames, vectors, manifest,
  };
}

// Draws one frame so that the sprite's anchor (its centre when there is no anchor)
// lands on (x, y); the rotation happens about that same point.
// Silently does nothing when the sprite is missing, so a failed asset never breaks a scene.
//
// The destination is snapped to a whole device pixel, not to a whole logical one: the
// canvas is drawn at the display's resolution, so that is where the pixel grid actually is.
// Raster frames are blitted with smoothing off, which keeps the art that has not been
// redrawn from its vector source hard-edged at any scale.
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
