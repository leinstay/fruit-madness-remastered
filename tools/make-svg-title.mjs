#!/usr/bin/env node
// tools/make-svg-title.mjs — builds assets/sprites/titleBg.svg, the animated title screen.
//
// The title is a 31-keyframe vector animation. Exported frame by frame it is about 29 MB,
// because every frame repeats the whole cast: the same sixty-odd shape definitions, nine of
// them a quarter of a megabyte each. Only eleven of the placements are constant over the
// loop and they interleave in z-order, so a static base with overlays is not possible. What
// is possible is storing each definition once: this tool folds the 31 exported frames into a
// single file with one shared <defs> and 31 <g> frame groups of <use> elements.
//
// The result is one SVG that also opens correctly as a plain image (frame 0 is visible, the
// rest carry display="none"), and that the game can take apart without an XML parser: every
// frame group is preceded by an exact marker comment, so cutting frame k out is a string
// slice between <!--frame:k--> and the next marker.
//
// What it does to the exported markup, beyond folding it:
//
//   * crops to the visible field: width/height 600x450 and a viewBox placing the symbol's
//     registration point where the game places it, at stage (300, 225). Path data is left
//     alone; only the viewport changes,
//   * drops the exporter's private namespace, XML comments and the XML prolog,
//   * trims the exporter's number padding ("1.0" -> "1") without moving a coordinate,
//   * removes the two baked-in labels (the version line and the credit) together with their
//     glyph outlines. Their spacing is wrong in this export and the game draws both with the
//     real font at runtime,
//   * paints the white backdrop the artwork was drawn over, behind every frame.
//
// The exported frames are working material and are not part of the repository, so their
// directory is given on the command line:
//
//   node tools/make-svg-title.mjs <dir-with-the-exported-title-frames>
//
// Run it from the repository root. It is deterministic and idempotent: the same inputs always
// produce a byte-identical assets/sprites/titleBg.svg and it writes nothing else.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'assets', 'sprites', 'titleBg.svg');

const KEY = 'titleBg';
const FRAMES = 31;

// The logical field and where the game puts the symbol's registration point inside it.
const FIELD_W = 600;
const FIELD_H = 450;
const FIELD_ANCHOR_X = 300;
const FIELD_ANCHOR_Y = 225;

// Same rounding as the gameplay sprites: Flash stores coordinates as whole twips, that is
// multiples of 0.05, so two decimals keep every path exactly where it was.
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

const setAttr = (node, name, value) => {
  const found = node.attrs.find(([k]) => k === name);
  if (found) found[1] = value;
  else node.attrs.push([name, value]);
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

/** Strips a CSS unit suffix and normalises the number: "667.5px" -> "667.5". */
const plainLength = (value) => fmt(parseFloat(value), DECIMALS.size);

// ---------------------------------------------------------------------------
// Cleaning one exported frame
// ---------------------------------------------------------------------------

function cleanFrame(source, file) {
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
      else if (k === 'transform' || k === 'gradientTransform' || k === 'patternTransform') {
        pair[1] = roundNumbers(v, DECIMALS.transform);
      } else if (k.endsWith('opacity')) pair[1] = roundNumbers(v, DECIMALS.opacity);
      else if (k === 'stroke-width' || k === 'width' || k === 'height') pair[1] = plainLength(v);
      else if (k === 'x' || k === 'y' || k === 'viewBox') pair[1] = roundNumbers(v, DECIMALS.coords);
    }
  };
  walk(svg, round);

  const width = parseFloat(attr(svg, 'width'));
  const height = parseFloat(attr(svg, 'height'));
  if (!(width > 0) || !(height > 0)) throw new Error(`${file}: the root <svg> has no usable width/height`);
  return { svg, width, height };
}

/**
 * The registration point of the symbol: Flash writes it as the translation of the single
 * group that wraps the whole frame.
 */
function registrationGroup(svg, file) {
  const groups = elements(svg).filter((c) => c.name === 'g' && attr(c, 'transform'));
  if (groups.length !== 1) throw new Error(`${file}: expected exactly one registration group, found ${groups.length}`);
  const m = /matrix\(([^)]*)\)/.exec(attr(groups[0], 'transform'));
  if (!m) throw new Error(`${file}: the registration group is not a matrix transform`);
  const parts = m[1].split(/[\s,]+/).map(Number);
  if (parts.length !== 6 || parts[0] !== 1 || parts[1] !== 0 || parts[2] !== 0 || parts[3] !== 1) {
    throw new Error(`${file}: the registration group scales or skews the frame`);
  }
  return { group: groups[0], point: [parts[4], parts[5]] };
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
}

// ---------------------------------------------------------------------------
// Folding the frames into one file
// ---------------------------------------------------------------------------

/**
 * The identity of a definition: its markup with its own id taken out, so two frames that
 * repeat the same shape under the same frame-local id collapse into one entry.
 */
function contentKey(def) {
  const copy = { name: def.name, attrs: def.attrs.filter(([k]) => k !== 'id'), children: def.children };
  return serialize(copy);
}

/**
 * Definitions may carry ids of their own inside — the rainbow banner is painted with a
 * pattern. Those have to become unique across the whole file too, so they are renumbered
 * and the paint references inside the same definition follow.
 */
function renameInnerIds(def, nextName) {
  const renamed = new Map();
  walk(def, (node) => {
    const id = attr(node, 'id');
    if (!id) return;
    const name = nextName();
    renamed.set(id, name);
    setAttr(node, 'id', name);
  });
  if (renamed.size === 0) return;
  const rewrite = (node) => {
    for (const pair of node.attrs) {
      for (const [from, to] of renamed) {
        pair[1] = pair[1].split(`url(#${from})`).join(`url(#${to})`);
        if (pair[1] === `#${from}`) pair[1] = `#${to}`;
      }
    }
  };
  rewrite(def);
  walk(def, rewrite);
}

function build(srcDir) {
  const defsByKey = new Map();
  const defsInOrder = [];
  const frames = [];
  let rawBytes = 0;
  let anchor = null;
  let viewport = null;
  let strippedUses = 0;
  let nextInner = 0;

  for (let n = 0; n < FRAMES; n += 1) {
    const name = `${KEY}_${n}.svg`;
    const from = path.join(srcDir, name);
    if (!fs.existsSync(from)) throw new Error(`missing ${from}`);
    const source = fs.readFileSync(from, 'utf8');
    rawBytes += Buffer.byteLength(source);

    const { svg, width, height } = cleanFrame(source, name);
    if (viewport === null) viewport = [width, height];
    if (viewport[0] !== width || viewport[1] !== height) throw new Error(`${name}: frames disagree on the viewport`);

    const before = registrationGroup(svg, name).group.children.length;
    stripCaptions(svg);
    const { group, point } = registrationGroup(svg, name);
    strippedUses += before - group.children.length;
    if (anchor === null) anchor = point;
    if (anchor[0] !== point[0] || anchor[1] !== point[1]) throw new Error(`${name}: frames disagree on the anchor`);

    // Fold this frame's definitions into the shared set, remembering where each went.
    const globalId = new Map();
    for (const defs of elements(svg).filter((c) => c.name === 'defs')) {
      for (const def of elements(defs)) {
        const localId = attr(def, 'id');
        if (!localId) throw new Error(`${name}: a definition without an id`);
        const key = contentKey(def);
        let known = defsByKey.get(key);
        if (!known) {
          known = `s${defsInOrder.length}`;
          setAttr(def, 'id', known);
          renameInnerIds(def, () => `p${nextInner++}`);
          defsByKey.set(key, known);
          defsInOrder.push(def);
        }
        globalId.set(localId, known);
      }
    }

    // Re-point this frame's uses at the shared definitions.
    walk(group, (node) => {
      const target = href(node);
      if (!target.startsWith('#')) return;
      const mapped = globalId.get(target.slice(1));
      if (!mapped) throw new Error(`${name}: reference ${target} resolves to nothing`);
      for (const pair of node.attrs) if (pair[1] === target) pair[1] = `#${mapped}`;
    });

    group.attrs = [
      ['id', `frame-${n}`],
      ...(n === 0 ? [] : [['display', 'none']]),
      ['transform', attr(group, 'transform')],
    ];
    frames.push(group);
  }

  return { defs: defsInOrder, frames, rawBytes, anchor, viewport, strippedUses };
}

function render({ defs, frames, anchor }) {
  const x = anchor[0] - FIELD_ANCHOR_X;
  const y = anchor[1] - FIELD_ANCHOR_Y;
  const out = [];
  out.push('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    + ` width="${FIELD_W}" height="${FIELD_H}"`
    + ` viewBox="${fmt(x, DECIMALS.coords)} ${fmt(y, DECIMALS.coords)} ${FIELD_W} ${FIELD_H}">\n`);
  out.push('<defs>\n');
  for (const def of defs) out.push(serialize(def, '  '));
  out.push('</defs>\n');
  // The artwork was drawn over a white page: a few areas, among them the ice-cream
  // character's eye glints, are holes that expect white behind them.
  out.push('<!--white backdrop intended by the artwork-->\n');
  out.push(`<rect x="${fmt(x, DECIMALS.coords)}" y="${fmt(y, DECIMALS.coords)}"`
    + ` width="${FIELD_W}" height="${FIELD_H}" fill="#ffffff"/>\n`);
  frames.forEach((frame, n) => {
    out.push(`<!--frame:${n}-->\n`);
    out.push(serialize(frame));
  });
  out.push('<!--frames:end-->\n');
  out.push('</svg>\n');
  return out.join('');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function main() {
  const srcDir = process.argv[2];
  if (!srcDir) {
    console.error('usage: node tools/make-svg-title.mjs <dir-with-the-exported-title-frames>');
    console.error('The SVG frames exported from the original 2013 Flash file are working material');
    console.error('and are not part of the repository, so their directory has to be given here.');
    process.exit(1);
  }
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    console.error(`make-svg-title: "${srcDir}" is not a directory.`);
    process.exit(1);
  }

  const built = build(srcDir);
  const text = render(built);
  fs.writeFileSync(OUT_FILE, text);

  const written = Buffer.byteLength(text);
  const gzipped = zlib.gzipSync(Buffer.from(text), { level: 9 }).length;
  console.log(`${KEY}: ${FRAMES} frames, viewport ${built.viewport.join('x')},`
    + ` registration ${built.anchor.join(',')}`);
  console.log(`definitions: ${built.defs.length} unique`);
  console.log(`captions: ${built.strippedUses / FRAMES} labels removed per frame`);
  console.log(`bytes: ${built.rawBytes} exported -> ${written} written (${gzipped} gzipped)`);
  console.log(`ratio: ${(written / built.rawBytes * 100).toFixed(1)} % of the export, `
    + `${(gzipped / written * 100).toFixed(1)} % of that on the wire`);
}

main();
