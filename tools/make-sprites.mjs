#!/usr/bin/env node
// tools/make-sprites.mjs — regenerates every sprite that the 2013 export could not provide.
//
// Run with `node tools/make-sprites.mjs` from the repository root. It is deterministic and
// idempotent: the same inputs always produce byte-identical PNGs.
//
// What it makes, and where the art comes from:
//
//   apple, pear, pomegranate, lime, banana, plum   the six fruit of the original title-screen cast.
//     They exist in the 2013 art only inside the flattened `titleBg` bitmap (see
//     docs/assets-inventory.md), so they are re-drawn here at game size following that art:
//     the palette of every one of them is READ OUT OF `assets/sprites/titleBg_0.png` at the
//     sample coordinates listed in CAST below, and the shapes are hand-authored pixel masks
//     traced from the same picture. Nothing is invented and nothing is imported.
//
//   boss          the pomegranate again, drawn on a larger grid for the boss-flyby event.
//   berry         one ball of the extracted `cherry` sprite, halved — literally derived from it.
//   comboCell     the extracted `muffin` sprite, halved, as the combo bar's cell icon.
//   comboBar      the extracted `scoreBar` capsule plus the "combo bar" caption lifted out of
//                 the extracted `comboBar` (whose baked-in muffins and "not working yet :("
//                 line are dropped).
//
// Like the extracted gameplay art, the fruit are drawn on a coarse grid and scaled up with
// whole-number nearest-neighbour steps, so one art pixel is 2 logical pixels — exactly the
// chunkiness of `cherry.png`. Every output pixel is fully opaque or fully transparent.

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
// The character grid: a small canvas of palette letters that becomes the sprite.
// ---------------------------------------------------------------------------

const EMPTY = ' ';

function grid(w, h) {
  return { w, h, cells: Array.from({ length: h }, () => new Array(w).fill(EMPTY)) };
}

const at = (g, x, y) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? EMPTY : g.cells[y][x]);
const set = (g, x, y, c) => { if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.cells[y][x] = c; };

/** Filled ellipse. Coordinates are in cell units; the centre may sit on a half cell. */
function ellipse(g, cx, cy, rx, ry, ch) {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) set(g, x, y, ch);
    }
  }
}

/**
 * Overlays an array of strings at (x, y). A space means "leave whatever is there",
 * so stamps can carve faces into a body without squaring off its edges; `~` erases.
 */
function stamp(g, x, y, rows) {
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < row.length; dx++) {
      const c = row[dx];
      if (c === EMPTY) continue;
      set(g, x + dx, y + dy, c === '~' ? EMPTY : c);
    }
  });
}

/**
 * Shades the lit-from-the-top-left side: every `from` cell far enough down and to the
 * right of the body centre becomes `to`. The same rule as the extracted cherry, whose
 * darker red sits as a crescent on its lower right. `cut` is in body radii, so 0.45
 * darkens roughly the outer third of the lower-right side.
 */
function shade(g, from, to, cx, cy, rx, ry, cut = 0.45) {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (at(g, x, y) !== from) continue;
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      if (nx * 0.72 + ny * 0.69 > cut) set(g, x, y, to);
    }
  }
}

/**
 * Turns the rim of every filled region into its own outline colour, so each shape comes
 * out with the closed dark edge the original art has. `map` gives the outline letter for
 * each fill letter; fills missing from it are left alone.
 */
function outline(g, map) {
  const before = g.cells.map((row) => row.slice());
  const solid = (x, y) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? false : before[y][x] !== EMPTY);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const c = before[y][x];
      const to = map[c];
      if (!to) continue;
      if (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1)) set(g, x, y, to);
    }
  }
}

/**
 * Draws the border *between* two fills: every `a` cell touching a `b` cell becomes `to`.
 * `outline` only rims a shape against empty space, so this is what keeps the worm off the
 * apple and the peel off the banana where the two overlap.
 */
function edge(g, a, b, to) {
  const before = g.cells.map((row) => row.slice());
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      if (before[y][x] !== a) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (before[y + dy] || [])[x + dx] === b)) set(g, x, y, to);
    }
  }
}

/** Renders a grid into an RGBA image, scaled up by `scale` whole pixels per cell. */
function render(g, palette, scale) {
  const img = blank(g.w * scale, g.h * scale);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const c = g.cells[y][x];
      if (c === EMPTY) continue;
      const col = palette[c];
      if (!col) throw new Error(`palette has no entry for '${c}'`);
      const rgba = [parseInt(col.slice(1, 3), 16), parseInt(col.slice(3, 5), 16), parseInt(col.slice(5, 7), 16), 255];
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(img, x * scale + sx, y * scale + sy, rgba);
    }
  }
  return img;
}

// ---------------------------------------------------------------------------
// The cast. Every colour is sampled from the title screen rather than typed in:
// `pick` reads the pixel at the given coordinate of assets/sprites/titleBg_0.png,
// which is where each character actually stands.
// ---------------------------------------------------------------------------

const title = readPng(src('titleBg_0.png'));
const pick = (x, y) => hex(get(title, x, y));

/** Palette letters shared by the whole cast, taken from the title screen's own colours. */
const COMMON = {
  K: pick(174, 0),    // #141414 — the near-black the title art outlines faces with
  W: pick(27, 4),     // #ffffff — eye highlights and teeth
};

const CAST = {
  apple: {
    // The green apple with the X eyes, the tongue and the worm, at the top left of the logo.
    G: pick(148, 48),   // #14d072 flesh
    g: pick(172, 15),   // #14a114 flesh in shadow
    o: pick(168, 15),   // #157214 dark green rim
    d: pick(184, 15),   // #1f9314 leaf
    D: pick(168, 15),   // #157214 leaf rim
    s: pick(130, 24),   // #724314 stem
    S: pick(130, 27),   // #844314 stem highlight
    w: pick(178, 29),   // #ffe2c4 the worm
    v: pick(182, 26),   // #f1a394 the worm in shadow
    c: pick(170, 22),   // #1414d0 the worm's cap
    C: pick(170, 24),   // #4372ff the cap's band
    p: pick(144, 99),   // #ffa1d0 tongue
  },
  pear: {
    // The angry pear in the dark hat, top centre-left, mostly hidden behind the logo:
    // everything below its mouth is completed by hand in the same style.
    G: pick(198, 16),   // #b98314 flesh
    g: pick(182, 20),   // #9c7115 flesh in shadow
    o: pick(197, 14),   // #af7d14 rim
    h: pick(180, 0),    // #434343 hat felt
    m: pick(204, 54),   // #8b1414 mouth
    p: pick(210, 55),   // #ffa1d0 tongue
    s: pick(130, 24),   // #724314 stalk
  },
  pomegranate: {
    // The crowned pomegranate with the fanged grin, top centre.
    G: pick(330, 0),    // #d81414 flesh
    g: pick(342, 18),   // #be1414 flesh in shadow
    o: pick(334, 0),    // #a11414 dark rim and the crown's edge
  },
  lime: {
    // The bright lime wedge with the worried face, top right of the logo.
    G: pick(414, 4),    // #8eff68 flesh
    g: pick(398, 24),   // #48e314 the darker green of its right face
    // On the title screen the lime is drawn straight onto the navy sky and has no rim of
    // its own; against the game's near-black field it needs one, so it borrows the dark
    // green the rest of the cast is outlined with.
    o: pick(160, 0),    // #14a114
  },
  banana: {
    // The peeled banana with the crossed-out eyes, to the right of the lime.
    G: pick(454, 25),   // #ffffb9 flesh
    g: pick(482, 65),   // #d1d175 flesh in shadow
    o: pick(480, 64),   // #c0c04d olive rim
    y: pick(444, 82),   // #ffecac the open peel
    Y: pick(450, 78),   // #d0a143 the peel's shaded side
    s: pick(496, 34),   // #a17316 stalk
  },
  plum: {
    // The little plum with its mouth open, to the left of the rainbow banner.
    G: pick(175, 150),  // #7243a1 flesh
    g: pick(176, 160),  // #483b70 flesh in shadow
    o: pick(172, 147),  // #882055 dark rim
    s: pick(166, 145),  // #472230 stem
    m: pick(174, 175),  // #8b1414 mouth
    p: pick(182, 177),  // #ffa1d0 tongue
  },
};
// ---------------------------------------------------------------------------
// The cast, drawn. Each fruit gets two drawings, exactly like the extracted `cherry`,
// which holds an open-eyed face for 8 ticks and a screwed-up one for 14. The second
// drawing is the same body wearing the second face.
// ---------------------------------------------------------------------------

/** Fills a symmetric silhouette given as half-widths, one per row, centred on `cx`. */
function wedge(g, y0, halfWidths, cx, ch) {
  halfWidths.forEach((hw, i) => {
    for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) set(g, x, y0 + i, ch);
  });
}

const BODY = {};

// --- apple -----------------------------------------------------------------
// Round green body, a leaf and a stem on top, X for eyes, the tongue hanging out of the
// right corner, and the pink worm in its blue cap looking over the apple's shoulder.
BODY.apple = (g, f) => {
  ellipse(g, 11.5, 14, 9.4, 8.9, 'G');
  stamp(g, 9, 2, ['sSs', 'sSs', 'sSs', 'sSs']);
  stamp(g, 2, 3, ['dddd ', 'ddddd', 'dDddd', ' dDdd', '  dd ']);
  stamp(g, 14, 0, [' ccc ', 'ccccc', 'CCCCC', ' www ', ' wvw ', ' www ', ' ww  ', ' ww  ']);
  shade(g, 'G', 'g', 11.5, 14, 9.4, 8.9, 0.42);
  edge(g, 'w', 'G', 'v');
  edge(g, 'w', 'g', 'v');
  outline(g, { G: 'o', s: 'K', d: 'D', w: 'v', c: 'C' });
  const faces = [
    [
      'K  K    K  K',
      ' KK      KK ',
      ' KK      KK ',
      'K  K    K  K',
      '            ',
      ' KK         ',
      '   KK       ',
      '     KKK    ',
      '       KKpp ',
      '         pp ',
    ],
    [
      '            ',
      'K  K    K  K',
      ' KK      KK ',
      'K  K    K  K',
      '            ',
      '  KK        ',
      '    KKK     ',
      '       KK   ',
      '        Kpp ',
      '        ppp ',
    ],
  ];
  stamp(g, 5, 11, faces[f]);
};

// --- pear ------------------------------------------------------------------
// The narrow-shouldered pear in its flat dark hat. Only its head and mouth are visible on
// the title screen — the logo covers the rest — so the body below is completed here in the
// same shape language: a pear's heavy bottom under the same neck.
BODY.pear = (g, f) => {
  ellipse(g, 11.5, 17.5, 8.0, 6.2, 'G');
  ellipse(g, 11.5, 11.5, 4.9, 5.6, 'G');
  stamp(g, 11, 3, ['s', 's']);
  shade(g, 'G', 'g', 11.5, 16, 8.0, 7.6, 0.42);
  stamp(g, 7, 3, ['hhhhhhhhhh', 'hhhhhhhhhh', 'hhhhhhhhhh']);
  stamp(g, 2, 6, ['hhhhhhhhhhhhhhhhhhhh']);
  edge(g, 'h', 'G', 'K');
  edge(g, 'h', 'g', 'K');
  outline(g, { G: 'o', h: 'K', s: 'K' });
  const faces = [
    [
      'KKKK KKKK',
      'KKWK KWKK',
      'KWWK KWWK',
      ' KK   KK ',
      '         ',
      ' KKKKKKK ',
      ' KmmmmmK ',
      ' KmpppmK ',
      '  KKKKK  ',
    ],
    [
      'KKKK KKKK',
      'KKKK KKKK',
      'KWKK KKWK',
      ' KK   KK ',
      '         ',
      '  KKKKK  ',
      '  KmmmK  ',
      '  KmppK  ',
      '   KKK   ',
    ],
  ];
  stamp(g, 7, 9, faces[f]);
};

// --- pomegranate -----------------------------------------------------------
// The round red one with the spiky crown and the little fanged grin.
BODY.pomegranate = (g, f) => {
  ellipse(g, 11.5, 14.5, 9.3, 8.7, 'G');
  stamp(g, 6, 2, [
    '   G   G   G  ',
    '  GG  GG  GG  ',
    ' GGG GGGG GGG ',
    ' GGGGGGGGGGGG ',
    'GGGGGGGGGGGGGG',
  ]);
  shade(g, 'G', 'g', 11.5, 14.5, 9.3, 8.7, 0.42);
  outline(g, { G: 'o' });
  const faces = [
    [
      'KKKK   KKKK',
      'KWKK   KWKK',
      'KKKK   KKKK',
      'KKKK   KKKK',
      '           ',
      ' K   K   K ',
      '  K K K K  ',
      '   W   W   ',
    ],
    [
      'KKKK   KKKK',
      'KKKK   KKKK',
      ' KK     KK ',
      '           ',
      '           ',
      ' K   K   K ',
      '  K K K K  ',
      '   W   W   ',
    ],
  ];
  stamp(g, 6, 11, faces[f]);
};

// --- lime ------------------------------------------------------------------
// A rounded wedge tapering to a soft point, the way it is drawn on the title screen,
// with the worried eyes and the wobbling mouth.
BODY.lime = (g, f) => {
  wedge(g, 4, [1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 10, 10, 10, 10, 9, 8, 7, 5], 11.5, 'G');
  shade(g, 'G', 'g', 11.5, 14, 10, 9, 0.34);
  outline(g, { G: 'o' });
  const faces = [
    [
      'KKK   KKK',
      'KWK   KWK',
      'KKK   KKK',
      '         ',
      '   KK    ',
      '  K  KK  ',
    ],
    [
      'KKK   KKK',
      'KKK   KKK',
      ' K     K ',
      '         ',
      '    KK   ',
      '  KK  K  ',
    ],
  ];
  stamp(g, 7, 12, faces[f]);
};

// --- banana ----------------------------------------------------------------
// The peeled banana: the pale fruit standing upright with the peel opened out below it,
// the brown stalk on top and the crossed-out eyes.
BODY.banana = (g, f) => {
  stamp(g, 11, 0, ['sss', 'sss', 'sss']);
  ellipse(g, 11.5, 11, 5.4, 8.2, 'G');
  shade(g, 'G', 'g', 11.5, 11, 5.4, 8.2, 0.38);
  // The peel opened out into a cup the fruit stands in.
  stamp(g, 3, 12, [
    '  yy          yy  ',
    ' yyy          yyy ',
    ' yyy          yyy ',
    ' yyy          yyy ',
    '  yyy        yyy  ',
    '  yyyy      yyyy  ',
    '   yyyyyyyyyyyy   ',
    '    yyyyyyyyyy    ',
    '     yyyyyyyy     ',
  ]);
  shade(g, 'y', 'Y', 11.5, 17, 9, 6, 0.3);
  edge(g, 'y', 'G', 's');
  edge(g, 'y', 'g', 's');
  outline(g, { G: 'o', y: 's', s: 'K' });
  const faces = [
    ['K K   K K', ' K     K ', 'K K   K K', '         ', ' K  K  K '],
    ['KKK   KKK', '         ', 'KKK   KKK', '         ', ' KKKKKKK '],
  ];
  stamp(g, 7, 8, faces[f]);
};

// --- plum ------------------------------------------------------------------
// The small purple one with its mouth wide open and a tongue in the corner.
BODY.plum = (g, f) => {
  ellipse(g, 11.5, 14, 8.1, 7.8, 'G');
  stamp(g, 10, 4, ['ss', 'ss']);
  shade(g, 'G', 'g', 11.5, 14, 8.1, 7.8, 0.42);
  outline(g, { G: 'o' });
  const faces = [
    [
      'KKK  KKK',
      'KWK  KWK',
      'KKK  KKK',
      '        ',
      ' KKKKKK ',
      'KWmmmmpK',
      'KmmmmppK',
      ' KKKKKK ',
    ],
    [
      'KKK  KKK',
      'KKK  KKK',
      ' K    K ',
      '        ',
      '  KKKK  ',
      ' KWmmpK ',
      '  KKKK  ',
      '        ',
    ],
  ];
  stamp(g, 8, 10, faces[f]);
};

/** Draws one 24x24 fruit. `face` is 0 or 1. */
function fruit(name, face) {
  const g = grid(24, 24);
  const pal = { ...COMMON, ...CAST[name] };
  BODY[name](g, face);
  return { g, pal };
}

// ---------------------------------------------------------------------------
// The boss: the same pomegranate on a 30-cell grid, so that the 120 px sprite is
// genuinely drawn large rather than blown up from the 24-cell one.
// ---------------------------------------------------------------------------

function bossFrame(f) {
  const g = grid(30, 30);
  const pal = { ...COMMON, ...CAST.pomegranate };
  ellipse(g, 15, 18, 12.4, 11.3, 'G');
  stamp(g, 7, 1, [
    '    G    G    G    ',
    '   GG   GGG  GG    ',
    '  GGG  GGGG  GGG   ',
    '  GGGGGGGGGGGGGG   ',
    ' GGGGGGGGGGGGGGGG  ',
    'GGGGGGGGGGGGGGGGGG ',
  ]);
  shade(g, 'G', 'g', 15, 18, 12.4, 11.3, 0.42);
  outline(g, { G: 'o' });
  const faces = [
    [
      'KKKKK     KKKKK',
      'KKWWK     KKWWK',
      'KKWWK     KKWWK',
      'KKKKK     KKKKK',
      'KKKKK     KKKKK',
      '               ',
      '               ',
      ' KK   KK   KK  ',
      '   KKK  KKK    ',
      '    WW   WW    ',
      '               ',
    ],
    [
      'KKKKK     KKKKK',
      'KKKKK     KKKKK',
      'KKKKK     KKKKK',
      ' KKK       KKK ',
      '               ',
      '               ',
      '               ',
      ' KK   KK   KK  ',
      '   KKK  KKK    ',
      '    WW   WW    ',
      '               ',
    ],
  ];
  stamp(g, 8, 14, faces[f]);
  return render(g, pal, 4);
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

for (const name of Object.keys(CAST)) {
  for (let f = 0; f < 2; f++) {
    const { g, pal } = fruit(name, f);
    emit(`${name}_${f}.png`, render(g, pal, 2));
  }
}
for (let f = 0; f < 2; f++) emit(`boss_${f}.png`, bossFrame(f));
emit('berry.png', makeBerry());
emit('comboCell.png', makeComboCell());
// The capsule is copied pixel for pixel out of `scoreBar`, anti-aliased rim included, so
// that the three HUD bars stay identical; hardening its alpha would make it the odd one out.
emit('comboBar.png', makeComboBar(), false);

console.log(written.join('\n'));
