#!/usr/bin/env node
// tools/make-svg-sprites.mjs — prepares the vector sprites in assets/sprites/.
//
// The 2013 game held no raster art at all: every sprite, HUD part and button was a vector
// symbol. This tool takes the SVG frames exported from the original Flash file and turns
// them into the files the game ships:
//
//   * adds `viewBox="0 0 w h"` while keeping `width`/`height` (Safari and Firefox want both),
//   * drops the exporter's private namespace, XML comments and the XML prolog,
//   * trims the exporter's number padding ("1.0" -> "1") without moving a single coordinate,
//   * for symbols that carry a caption, writes a second, text-free `<key>.notext.svg` next to
//     the full one, so the captions can later be drawn at runtime with the real font metrics.
//
// The exported frames are working material and are not part of the repository, so their
// directory is given on the command line:
//
//   node tools/make-svg-sprites.mjs <dir-with-the-exported-svg-frames>
//
// Run it from the repository root. It is deterministic and idempotent: the same inputs always
// produce byte-identical files. It only ever writes the .svg files listed in SYMBOLS and never
// touches anything else in assets/sprites/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets', 'sprites');

// The gameplay cast. `background` is a flat colour and is painted with fillRect; the combo bar
// and the title screen are handled separately.
const SYMBOLS = [
  ['ufo', 14],
  ['panda', 3],
  ['cherry', 2],
  ['muffin', 2],
  ['star', 1],
  ['dangerHz', 8],
  ['dangerVt', 8],
  ['dangerDiag', 1],
  ['fuelBar', 1],
  ['fuelFill', 1],
  ['scoreBar', 1],
  ['gameOver', 1],
  ['btnStart', 1],
  ['btnPause', 1],
  ['btnMenu', 1],
];

// Decimals kept per attribute kind. Flash stores coordinates as whole twips, that is
// multiples of 0.05, so two decimals keep every path exactly where it was: the rasterised
// result is pixel for pixel the export. One decimal would save 3.5 % of the bytes (1.1 %
// once gzipped) but moves a quarter of the points by 0.05 px, which is visible as a
// different anti-aliasing weight along every edge. Transforms keep full precision because
// they also carry scale factors, and opacities are rounded far below one 8-bit level.
const DECIMALS = { coords: 2, transform: 6, opacity: 4, size: 6 };

// ---------------------------------------------------------------------------
// A minimal XML reader and writer. These files use a tiny subset: elements, attributes
// and whitespace, so a real parser would be overkill.
// ---------------------------------------------------------------------------

const NAME_RE = /[^\s/>=]+/y;
const SPACE_RE = /\s*/y;

function parseXml(source, file) {
  const root = { name: '#document', attrs: [], children: [] };
  const stack = [root];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt < 0) break;
    const text = source.slice(i, lt);
    if (text.trim()) stack[stack.length - 1].children.push({ text });
    if (source.startsWith('<!--', lt)) { i = source.indexOf('-->', lt) + 3; continue; }
    if (source.startsWith('<?', lt)) { i = source.indexOf('?>', lt) + 2; continue; }
    if (source.startsWith('<!', lt)) { i = source.indexOf('>', lt) + 1; continue; }
    if (source.startsWith('</', lt)) {
      i = source.indexOf('>', lt) + 1;
      stack.pop();
      if (stack.length === 0) throw new Error(`${file}: unbalanced closing tag`);
      continue;
    }
    const tag = parseTag(source, lt, file);
    const node = { name: tag.name, attrs: tag.attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!tag.selfClose) stack.push(node);
    i = tag.end;
  }
  if (stack.length !== 1) throw new Error(`${file}: unclosed elements`);
  return root;
}

function parseTag(source, pos, file) {
  NAME_RE.lastIndex = pos + 1;
  const nameMatch = NAME_RE.exec(source);
  if (!nameMatch) throw new Error(`${file}: malformed tag at ${pos}`);
  const name = nameMatch[0];
  let i = NAME_RE.lastIndex;
  const attrs = [];
  for (;;) {
    SPACE_RE.lastIndex = i;
    SPACE_RE.exec(source);
    i = SPACE_RE.lastIndex;
    if (source.startsWith('/>', i)) return { name, attrs, selfClose: true, end: i + 2 };
    if (source[i] === '>') return { name, attrs, selfClose: false, end: i + 1 };
    NAME_RE.lastIndex = i;
    const attrName = NAME_RE.exec(source);
    if (!attrName) throw new Error(`${file}: malformed attribute at ${i}`);
    i = NAME_RE.lastIndex;
    SPACE_RE.lastIndex = i;
    SPACE_RE.exec(source);
    i = SPACE_RE.lastIndex;
    if (source[i] !== '=') { attrs.push([attrName[0], '']); continue; }
    i += 1;
    SPACE_RE.lastIndex = i;
    SPACE_RE.exec(source);
    i = SPACE_RE.lastIndex;
    const quote = source[i];
    if (quote !== '"' && quote !== "'") throw new Error(`${file}: unquoted attribute value at ${i}`);
    const end = source.indexOf(quote, i + 1);
    if (end < 0) throw new Error(`${file}: unterminated attribute value at ${i}`);
    attrs.push([attrName[0], source.slice(i + 1, end)]);
    i = end + 1;
  }
}

const escapeAttr = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const escapeText = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function serialize(node, indent = '') {
  if (node.text !== undefined) return `${indent}${escapeText(node.text.trim())}\n`;
  const attrs = node.attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
  if (node.children.length === 0) return `${indent}<${node.name}${attrs}/>\n`;
  const inner = node.children.map((c) => serialize(c, `${indent}  `)).join('');
  return `${indent}<${node.name}${attrs}>\n${inner}${indent}</${node.name}>\n`;
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

const elements = (node) => node.children.filter((c) => c.name !== undefined);

function walk(node, fn) {
  for (const child of elements(node)) { fn(child, node); walk(child, fn); }
}

const attr = (node, name) => {
  const found = node.attrs.find(([k]) => k === name);
  return found ? found[1] : null;
};

const href = (node) => attr(node, 'xlink:href') || attr(node, 'href') || '';

function removeWhere(node, predicate) {
  node.children = node.children.filter((c) => !(c.name !== undefined && predicate(c)));
  for (const child of elements(node)) removeWhere(child, predicate);
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

function fmt(value, decimals) {
  let s = value.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

const NUMBER_RE = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const roundNumbers = (text, decimals) => text.replace(NUMBER_RE, (n) => fmt(Number(n), decimals));

/** Strips a CSS unit suffix and normalises the number: "69.1px" -> "69.1". */
const plainLength = (value) => fmt(parseFloat(value), DECIMALS.size);

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------

function cleanDocument(source, file) {
  const doc = parseXml(source, file);
  const svg = elements(doc).find((c) => c.name === 'svg');
  if (!svg) throw new Error(`${file}: no <svg> root`);

  // The export carries a private namespace with the exporter's own bookkeeping. Keep only
  // the attributes an SVG renderer reads: unprefixed ones plus xlink.
  const drop = (node) => {
    node.attrs = node.attrs.filter(([k]) => !k.includes(':') || k === 'xmlns:xlink' || k.startsWith('xlink:'));
  };
  drop(svg);
  walk(svg, drop);

  const round = (node) => {
    for (const pair of node.attrs) {
      const [k, v] = pair;
      if (k === 'd') pair[1] = roundNumbers(v, DECIMALS.coords);
      else if (k === 'transform' || k === 'gradientTransform') pair[1] = roundNumbers(v, DECIMALS.transform);
      else if (k.endsWith('opacity')) pair[1] = roundNumbers(v, DECIMALS.opacity);
      else if (k === 'stroke-width' || k === 'width' || k === 'height') pair[1] = plainLength(v);
      else if (k === 'x' || k === 'y') pair[1] = roundNumbers(v, DECIMALS.coords);
    }
  };
  walk(svg, round);

  const width = parseFloat(attr(svg, 'width'));
  const height = parseFloat(attr(svg, 'height'));
  if (!(width > 0) || !(height > 0)) throw new Error(`${file}: the root <svg> has no usable width/height`);
  const rest = svg.attrs.filter(([k]) => !['xmlns', 'xmlns:xlink', 'width', 'height', 'viewBox'].includes(k));
  svg.attrs = [
    ['xmlns', 'http://www.w3.org/2000/svg'],
    ['xmlns:xlink', 'http://www.w3.org/1999/xlink'],
    ['width', fmt(width, DECIMALS.size)],
    ['height', fmt(height, DECIMALS.size)],
    ['viewBox', `0 0 ${fmt(width, DECIMALS.size)} ${fmt(height, DECIMALS.size)}`],
    ...rest,
  ];

  return { svg, width, height };
}

/**
 * The registration point of the symbol: Flash writes it as the translation of the single
 * group that wraps the whole frame.
 */
function registrationPoint(svg, file) {
  const group = elements(svg).find((c) => c.name === 'g' && attr(c, 'transform'));
  if (!group) throw new Error(`${file}: no registration group`);
  const m = /matrix\(([^)]*)\)/.exec(attr(group, 'transform'));
  if (!m) throw new Error(`${file}: the registration group is not a matrix transform`);
  const parts = m[1].split(/[\s,]+/).map(Number);
  if (parts.length !== 6 || parts[0] !== 1 || parts[1] !== 0 || parts[2] !== 0 || parts[3] !== 1) {
    throw new Error(`${file}: the registration group scales or skews the frame`);
  }
  return [parts[4], parts[5]];
}

// ---------------------------------------------------------------------------
// Removing the baked-in captions
// ---------------------------------------------------------------------------

function definedIds(svg) {
  const ids = new Set();
  for (const defs of elements(svg).filter((c) => c.name === 'defs')) {
    walk(defs, (node) => { const id = attr(node, 'id'); if (id) ids.add(id); });
  }
  return ids;
}

/**
 * Drops every glyph reference, then everything that referenced only glyphs: empty groups,
 * uses whose target has gone, and finally the glyph outlines themselves.
 */
function stripCaptions(svg) {
  removeWhere(svg, (node) => node.name === 'use' && href(node).startsWith('#font_'));

  for (;;) {
    const before = JSON.stringify(svg);
    removeWhere(svg, (node) => node.name === 'g' && node.children.length === 0);
    const ids = definedIds(svg);
    removeWhere(svg, (node) => node.name === 'use' && href(node).startsWith('#') && !ids.has(href(node).slice(1)));
    if (JSON.stringify(svg) === before) break;
  }

  // Garbage-collect the definitions nothing points at any more.
  const defs = elements(svg).filter((c) => c.name === 'defs');
  const reachable = new Set();
  const collect = (node) => walk(node, (child) => {
    const target = href(child);
    if (child.name === 'use' && target.startsWith('#')) reachable.add(target.slice(1));
  });
  for (const child of elements(svg)) if (child.name !== 'defs') collect(child);
  for (;;) {
    const before = reachable.size;
    for (const group of defs) {
      for (const def of elements(group)) if (reachable.has(attr(def, 'id'))) collect(def);
    }
    if (reachable.size === before) break;
  }
  for (const group of defs) {
    group.children = group.children.filter((c) => c.name === undefined || reachable.has(attr(c, 'id')));
  }
  removeWhere(svg, (node) => node.name === 'defs' && node.children.length === 0);
}

/** True when anything is still painted: a fill or a stroke that is neither "none" nor invisible. */
function paintsAnything(svg) {
  let paints = false;
  const visible = (node, paintAttr) => {
    const paint = attr(node, paintAttr);
    if (!paint || paint === 'none') return false;
    const opacity = attr(node, `${paintAttr}-opacity`);
    return opacity === null || parseFloat(opacity) > 0;
  };
  walk(svg, (node) => {
    if (node.name !== 'path') return;
    if (visible(node, 'fill')) paints = true;
    if (visible(node, 'stroke') && parseFloat(attr(node, 'stroke-width') || '1') > 0) paints = true;
  });
  return paints;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

const frameFile = (key, frame, frames) => (frames === 1 ? `${key}.svg` : `${key}_${frame}.svg`);

function main() {
  const srcDir = process.argv[2];
  if (!srcDir) {
    console.error('usage: node tools/make-svg-sprites.mjs <dir-with-the-exported-svg-frames>');
    console.error('The SVG frames exported from the original 2013 Flash file are working material');
    console.error('and are not part of the repository, so their directory has to be given here.');
    process.exit(1);
  }
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    console.error(`make-svg-sprites: "${srcDir}" is not a directory.`);
    process.exit(1);
  }

  const rows = [];
  const textOnly = [];
  for (const [key, frames] of SYMBOLS) {
    let rawBytes = 0;
    let outBytes = 0;
    let notextBytes = 0;
    let size = null;
    let anchor = null;
    let hasText = false;
    const cleaned = [];

    for (let frame = 0; frame < frames; frame++) {
      const name = frameFile(key, frame, frames);
      const from = path.join(srcDir, name);
      if (!fs.existsSync(from)) {
        console.error(`make-svg-sprites: missing ${from}`);
        process.exit(1);
      }
      const source = fs.readFileSync(from, 'utf8');
      rawBytes += Buffer.byteLength(source);
      if (source.includes('#font_')) hasText = true;

      const { svg, width, height } = cleanDocument(source, name);
      const point = registrationPoint(svg, name);
      if (size === null) { size = [width, height]; anchor = point; }
      if (size[0] !== width || size[1] !== height) throw new Error(`${name}: frames disagree on the viewport`);
      if (anchor[0] !== point[0] || anchor[1] !== point[1]) throw new Error(`${name}: frames disagree on the anchor`);
      cleaned.push({ name, svg });
    }

    for (const { name, svg } of cleaned) {
      const text = serialize(svg);
      fs.writeFileSync(path.join(OUT_DIR, name), text);
      outBytes += Buffer.byteLength(text);
    }

    if (hasText) {
      const stripped = cleaned.map(({ name, svg }) => {
        const copy = parseXml(serialize(svg), name);
        const only = elements(copy).find((c) => c.name === 'svg');
        stripCaptions(only);
        return { name: name.replace(/\.svg$/, '.notext.svg'), svg: only };
      });
      if (stripped.some(({ svg }) => paintsAnything(svg))) {
        for (const { name, svg } of stripped) {
          const text = serialize(svg);
          fs.writeFileSync(path.join(OUT_DIR, name), text);
          notextBytes += Buffer.byteLength(text);
        }
      } else {
        textOnly.push(key);
      }
    }

    rows.push({
      key,
      frames,
      size: `${fmt(size[0], DECIMALS.size)}x${fmt(size[1], DECIMALS.size)}`,
      anchor: `${fmt(anchor[0], DECIMALS.size)},${fmt(anchor[1], DECIMALS.size)}`,
      rawBytes,
      outBytes,
      notextBytes,
      hasText: hasText ? 'yes' : 'no',
    });
  }

  const columns = [
    ['key', (r) => r.key],
    ['frames', (r) => String(r.frames)],
    ['viewport', (r) => r.size],
    ['anchor', (r) => r.anchor],
    ['raw', (r) => String(r.rawBytes)],
    ['written', (r) => String(r.outBytes)],
    ['notext', (r) => (r.notextBytes ? String(r.notextBytes) : '-')],
    ['text', (r) => r.hasText],
  ];
  const widths = columns.map(([head, get]) => Math.max(head.length, ...rows.map((r) => get(r).length)));
  const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  console.log(line(columns.map(([head]) => head)));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(columns.map(([, get]) => get(row))));
  const total = (field) => rows.reduce((sum, r) => sum + r[field], 0);
  console.log(line([
    'total',
    String(rows.reduce((n, r) => n + r.frames, 0)),
    '', '',
    String(total('rawBytes')),
    String(total('outBytes')),
    String(total('notextBytes')),
    '',
  ]));
  if (textOnly.length) {
    console.log(`\nNo text-free variant for ${textOnly.join(', ')}: the symbol is nothing but its caption.`);
  }
}

main();
