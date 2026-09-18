// Manifest-driven image loader.
// `normalizeSpriteEntry` is pure (Node-testable); the image loading itself is browser-only.
//
// A sprite entry in assets/manifest.json has one of four forms:
//   "path.png"
//   { "file": "path.png", "anchor": [x, y] }
//   { "frames": [...], "fps": n, "anchor"?: [x, y] }
//   { "frames": [...], "durations": [ticks...], "anchor"?: [x, y] }
// `anchor` is in PNG pixels from the top-left; absent means the image centre.

export function normalizeSpriteEntry(entry) {
  if (typeof entry === 'string') {
    return { frames: [entry], timing: null, anchor: null };
  }
  if (!entry || typeof entry !== 'object') {
    throw new Error(`normalizeSpriteEntry: unsupported entry ${JSON.stringify(entry)}`);
  }
  const anchor = Array.isArray(entry.anchor) && entry.anchor.length === 2
    ? [Number(entry.anchor[0]), Number(entry.anchor[1])]
    : null;

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
    return { frames, timing, anchor };
  }

  if (typeof entry.file === 'string') {
    return { frames: [entry.file], timing: null, anchor };
  }
  throw new Error(`normalizeSpriteEntry: entry has neither "frames" nor "file": ${JSON.stringify(entry)}`);
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

// Loads every sprite in the manifest. A missing or broken image never rejects the whole
// load: it is logged and the sprite simply reports has(name) === false.
export async function loadAssets(manifestUrl) {
  let manifest = { sprites: {}, audio: {}, fonts: {} };
  try {
    const res = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json();
  } catch (err) {
    console.warn(`assets: could not load the manifest ${manifestUrl}:`, err);
  }

  const sprites = new Map();
  const jobs = [];
  for (const [name, entry] of Object.entries(manifest.sprites || {})) {
    let spec;
    try {
      spec = normalizeSpriteEntry(entry);
    } catch (err) {
      console.warn(`assets: skipping sprite "${name}":`, err);
      continue;
    }
    const record = { images: new Array(spec.frames.length).fill(null), timing: spec.timing, anchor: spec.anchor };
    sprites.set(name, record);
    spec.frames.forEach((url, i) => {
      jobs.push(loadImage(url).then((img) => { record.images[i] = img; }));
    });
  }
  await Promise.all(jobs);

  for (const [name, record] of sprites) {
    record.images = record.images.filter(Boolean);
    if (record.images.length === 0) {
      console.warn(`assets: sprite "${name}" has no usable frames`);
      sprites.delete(name);
    } else if (Array.isArray(record.timing) && record.timing.length !== record.images.length) {
      record.timing = null; // some frames were lost; fall back to a static sprite
    }
  }

  const has = (name) => sprites.has(name);
  const img = (name, frame = 0) => {
    const record = sprites.get(name);
    if (!record) return null;
    const n = record.images.length;
    const i = ((Math.floor(frame) % n) + n) % n;
    return record.images[i];
  };
  const frameCount = (name) => (sprites.has(name) ? sprites.get(name).images.length : 0);
  const timing = (name) => (sprites.has(name) ? sprites.get(name).timing : null);
  const anchor = (name) => (sprites.has(name) ? sprites.get(name).anchor : null);

  return { img, has, frameCount, timing, anchor, manifest };
}

// Draws one frame so that the sprite's anchor (its centre when there is no anchor)
// lands on (x, y); the rotation happens about that same point.
// Silently does nothing when the sprite is missing, so a failed asset never breaks a scene.
export function drawSprite(ctx, assets, name, frame = 0, x = 0, y = 0, rotationDeg = 0) {
  if (!ctx || !assets || !assets.has || !assets.has(name)) return;
  const image = assets.img(name, frame);
  if (!image || !image.width) return;
  const a = assets.anchor(name) || [image.width / 2, image.height / 2];
  if (rotationDeg) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(image, Math.round(-a[0]), Math.round(-a[1]));
    ctx.restore();
  } else {
    ctx.drawImage(image, Math.round(x - a[0]), Math.round(y - a[1]));
  }
}
