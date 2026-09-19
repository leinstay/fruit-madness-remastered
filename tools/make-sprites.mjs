#!/usr/bin/env node
// tools/make-sprites.mjs — regenerates the small HUD and event sprites that are derived
// directly from the extracted 2013 art.
//
// Run with `node tools/make-sprites.mjs` from the repository root. It is deterministic and
// idempotent: the same inputs always produce byte-identical PNGs.
//
//   berry         one ball of the extracted `cherry` sprite, halved — literally derived from it.
//   comboCell     the extracted `muffin` sprite, halved, as the combo bar's cell icon.
//   comboBar      the extracted `scoreBar` capsule plus the "combo bar" caption lifted out of
//                 the original `comboBar` symbol (whose baked-in muffins and "not working
//                 yet :(" line are dropped).
//
// The enemy fruit (apple, pear, pomegranate, lime, banana, plum) and the boss are authored
// artwork kept as PNG files in assets/sprites/; this tool never touches them.
// Every pixel this tool writes is fully opaque or fully transparent, except the combo bar,
// which keeps the anti-aliased rim of the capsule it is copied from.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPRITES = path.join(ROOT, 'assets', 'sprites');
const src = (f) => path.join(SPRITES, f);

// ---------------------------------------------------------------------------
// PNG in and out. Only what these files need: 8 bits per sample, no interlace,
// colour type 3 (the palette-quantised title frames) and 6 (everything else).
// ---------------------------------------------------------------------------

function readPng(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
  const depth = b[24], color = b[25], interlace = b[28];
  if (depth !== 8 || interlace !== 0) throw new Error(`${file}: unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const idat = [];
  let plte = null, trns = null, o = 8;
  while (o + 8 <= b.length) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!ch) throw new Error(`${file}: unsupported colour type ${color}`);
  const stride = width * ch;
  const un = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = un.subarray(y * stride, (y + 1) * stride);
    const prev = y ? un.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, up = prev[i], ul = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const p = a + up - ul, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul;
      }
      cur[i] = v & 255;
    }
  }
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r, g, bl, al = 255;
    if (color === 6) { r = un[i * 4]; g = un[i * 4 + 1]; bl = un[i * 4 + 2]; al = un[i * 4 + 3]; }
    else if (color === 2) { r = un[i * 3]; g = un[i * 3 + 1]; bl = un[i * 3 + 2]; }
    else if (color === 3) { const k = un[i]; r = plte[k * 3]; g = plte[k * 3 + 1]; bl = plte[k * 3 + 2]; al = trns && k < trns.length ? trns[k] : 255; }
    else if (color === 0) { r = g = bl = un[i]; }
    else { r = g = bl = un[i * 2]; al = un[i * 2 + 1]; }
    data.set([r, g, bl, al], i * 4);
  }
  return { width, height, data };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 255] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function writePng(file, img) {
  const { width, height, data } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---------------------------------------------------------------------------
// Raster helpers
// ---------------------------------------------------------------------------

const blank = (w, h) => ({ width: w, height: h, data: Buffer.alloc(w * h * 4) });

function put(img, x, y, rgba) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data.set(rgba, (y * img.width + x) * 4);
}

function get(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return [0, 0, 0, 0];
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

const hex = (rgb) => '#' + rgb.slice(0, 3).map((n) => n.toString(16).padStart(2, '0')).join('');

/** Nearest-neighbour upscale by a whole number — keeps the pixels square and hard-edged. */
function upscale(img, factor) {
  const out = blank(img.width * factor, img.height * factor);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      put(out, x, y, get(img, (x / factor) | 0, (y / factor) | 0));
    }
  }
  return out;
}

/**
 * Halve an image by taking, for every 2x2 block, the colour that occupies most of it
 * (ties go to the darker colour, which keeps outlines from dissolving). Blocks that are
 * more than half transparent become transparent, so the result stays 0/255 alpha.
 */
function half(img) {
  const out = blank(img.width >> 1, img.height >> 1);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const tally = new Map();
      let clear = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const p = get(img, x * 2 + dx, y * 2 + dy);
          if (p[3] < 128) { clear++; continue; }
          const k = p.slice(0, 3).join(',');
          tally.set(k, (tally.get(k) || 0) + 1);
        }
      }
      if (clear > 2 || tally.size === 0) continue;
      let best = null, bestN = -1;
      for (const [k, n] of tally) {
        const lum = k.split(',').reduce((a, b) => a + +b, 0);
        if (n > bestN || (n === bestN && lum < best.lum)) best = { k, lum };
        if (n > bestN) bestN = n;
      }
      put(out, x, y, [...best.k.split(',').map(Number), 255]);
    }
  }
  return out;
}

/** Tight bounding box of the opaque pixels, or null when the image is empty. */
function bbox(img) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function crop(img, x0, y0, w, h) {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(out, x, y, get(img, x0 + x, y0 + y));
  return out;
}

/** Pastes `img` centred on a w x h transparent canvas. */
function centre(img, w, h) {
  const out = blank(w, h);
  const ox = Math.floor((w - img.width) / 2), oy = Math.floor((h - img.height) / 2);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const p = get(img, x, y);
      if (p[3]) put(out, ox + x, oy + y, p);
    }
  }
  return out;
}

/** Forces every pixel to fully opaque or fully transparent — no anti-aliased fringe. */
function hardenAlpha(img) {
  for (let i = 0; i < img.width * img.height; i++) {
    img.data[i * 4 + 3] = img.data[i * 4 + 3] >= 128 ? 255 : 0;
  }
  return img;
}

// ---------------------------------------------------------------------------
// Sprites derived straight from the extracted art
// ---------------------------------------------------------------------------

/** One ball of the extracted cherry, halved: the little berry of the berry-rain event. */
function makeBerry() {
  const cherry = readPng(src('cherry_0.png'));
  // The right-hand ball on its own, in cherry_0.png pixel coordinates. The extracted art
  // sits on a 2 px grid from an even origin, so halving this 24x24 block is exact.
  const ball = crop(cherry, 24, 24, 24, 24);
  const small = hardenAlpha(half(ball));
  const box = bbox(small);
  return centre(crop(small, box.x0, box.y0, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1), 12, 12);
}

/** The muffin, halved, as the combo bar's cell icon. */
function makeComboCell() {
  const muffin = readPng(src('muffin_0.png'));
  const even = crop(muffin, 0, 0, 32, 28);
  const small = hardenAlpha(half(even));
  const box = bbox(small);
  return crop(small, box.x0, box.y0, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
}

/**
 * The combo capsule: the empty `scoreBar` frame with the "combo bar" caption of the
 * original `comboBar` in place of "adventure score". Both symbols were exported with
 * their capsules on the same columns, so the caption drops straight in. The four baked-in
 * muffins and the 2013 "not working yet :(" line are left behind.
 */
function makeComboBar() {
  const score = readPng(src('scoreBar.png'));
  const combo = readPng(src('comboBar.png'));
  const out = blank(score.width, score.height);
  for (let y = CAPTION_ROWS[1] + 1; y < score.height; y++) {
    for (let x = 0; x < score.width; x++) put(out, x, y, get(score, x, y));
  }
  for (let y = CAPTION_ROWS[0]; y <= CAPTION_ROWS[1]; y++) {
    for (let x = 0; x < score.width; x++) put(out, x, y, get(combo, x, y));
  }
  return out;
}

// The rows both captions occupy in the exported HUD symbols.
const CAPTION_ROWS = [3, 10];

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const written = [];
function emit(file, img, harden = true) {
  if (harden) hardenAlpha(img);
  writePng(src(file), img);
  written.push(`${file}  ${img.width}x${img.height}`);
}

emit('berry.png', makeBerry());
emit('comboCell.png', makeComboCell());
// The capsule is copied pixel for pixel out of `scoreBar`, anti-aliased rim included, so
// that the three HUD bars stay identical; hardening its alpha would make it the odd one out.
emit('comboBar.png', makeComboBar(), false);

console.log(written.join('\n'));
