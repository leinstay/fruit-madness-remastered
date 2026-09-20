// tests/title.test.js — the title screen ships as ONE vector file: a shared <defs> with
// every shape stored once, followed by 31 frame groups. These checks are filesystem-only
// (no DOM, no canvas) and guard the two things the game depends on: that a frame can be cut
// out of the file by plain string slicing, without an XML parser, and that the cut-out frame
// is still complete markup whose every reference resolves.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'assets', 'sprites', 'titleBg.svg');
const FRAMES = 31;

const svg = fs.readFileSync(FILE, 'utf8');

/** The `<defs>…</defs>` block, which has to hold every definition in the file. */
function defsBlock() {
  const start = svg.indexOf('<defs>');
  const end = svg.indexOf('</defs>');
  assert.ok(start >= 0 && end > start, 'no <defs> block');
  return svg.slice(start, end);
}

/** Byte offset of the marker comment that opens frame `n`. */
const markerAt = (n) => svg.indexOf(`<!--frame:${n}-->`);

/**
 * The markup of frame `n`, cut out the way the game will cut it: between its own marker and
 * the next one, with no XML parsing involved.
 */
function sliceFrame(n) {
  const from = markerAt(n);
  assert.ok(from >= 0, `no marker for frame ${n}`);
  const start = from + `<!--frame:${n}-->`.length;
  const next = n + 1 < FRAMES ? markerAt(n + 1) : svg.indexOf('<!--frames:end-->');
  assert.ok(next > start, `frame ${n} is not followed by a marker`);
  return svg.slice(start, next);
}

/**
 * A tag balance check with a small stack. It only needs the subset these files use:
 * elements, attributes, comments and whitespace.
 */
function assertBalanced(markup, label) {
  const stack = [];
  let i = 0;
  while (i < markup.length) {
    const lt = markup.indexOf('<', i);
    if (lt < 0) break;
    if (markup.startsWith('<!--', lt)) {
      const end = markup.indexOf('-->', lt);
      assert.ok(end > 0, `${label}: unterminated comment`);
      i = end + 3;
      continue;
    }
    if (markup.startsWith('<?', lt) || markup.startsWith('<!', lt)) {
      i = markup.indexOf('>', lt) + 1;
      continue;
    }
    if (markup.startsWith('</', lt)) {
      const end = markup.indexOf('>', lt);
      const name = markup.slice(lt + 2, end).trim();
      assert.equal(stack.pop(), name, `${label}: </${name}> closes the wrong element`);
      i = end + 1;
      continue;
    }
    // An opening tag: walk it attribute by attribute so a ">" inside a value cannot fool us.
    let j = lt + 1;
    while (j < markup.length && !/[\s/>]/.test(markup[j])) j += 1;
    const name = markup.slice(lt + 1, j);
    assert.ok(name.length > 0, `${label}: malformed tag`);
    let selfClosing = false;
    while (j < markup.length) {
      const ch = markup[j];
      if (ch === '"' || ch === "'") {
        const end = markup.indexOf(ch, j + 1);
        assert.ok(end > 0, `${label}: unterminated attribute value`);
        j = end + 1;
        continue;
      }
      if (ch === '>') { j += 1; break; }
      if (ch === '/' && markup[j + 1] === '>') { selfClosing = true; j += 2; break; }
      j += 1;
    }
    if (!selfClosing) stack.push(name);
    i = j;
  }
  assert.deepEqual(stack, [], `${label}: unclosed elements`);
}

test('the title screen is one SVG covering the visible field', () => {
  assert.ok(svg.startsWith('<svg'), 'the file must start with the root element, no XML prolog');
  assert.match(svg, /<svg[^>]*\swidth="600"/);
  assert.match(svg, /<svg[^>]*\sheight="450"/);
  assert.match(svg, /<svg[^>]*\sviewBox="200 110 600 450"/);
  assert.ok(svg.trimEnd().endsWith('</svg>'), 'the root element must be closed');
  assertBalanced(svg, 'titleBg.svg');
});

test('the file holds the whole animation and stays small enough to ship', () => {
  assert.equal([...svg.matchAll(/<!--frame:\d+-->/g)].length, FRAMES, 'frame count');
  // One request carries the whole title. The wire cost is a fifth of this (the host
  // gzips SVG), but the parsed document still has to fit on a phone.
  const bytes = fs.statSync(FILE).size;
  assert.ok(bytes < 5 * 1024 * 1024, `titleBg.svg is ${bytes} bytes`);
});

test('the frame markers are exactly one per frame and in order', () => {
  const markers = [...svg.matchAll(/<!--frame:(\d+)-->/g)].map((m) => Number(m[1]));
  assert.deepEqual(markers, Array.from({ length: FRAMES }, (_, n) => n));
  const end = svg.indexOf('<!--frames:end-->');
  assert.ok(end > markerAt(FRAMES - 1), 'the end marker must follow the last frame');
  assert.equal(svg.split('<!--frames:end-->').length - 1, 1, 'one end marker only');
  for (let n = 0; n < FRAMES; n += 1) {
    assert.match(sliceFrame(n), new RegExp(`^\\s*<g id="frame-${n}"`), `frame ${n} is not a single group`);
  }
});

test('every definition sits on a line of its own and carries an id', () => {
  // This is what lets the game hand a frame only the drawings it uses: the definitions
  // are indexed by id with plain line operations, no XML parser. One definition per line,
  // nothing else between <defs> and </defs>.
  // Trimmed, exactly as js/core/title-frames.js reads them: a repository checked out with
  // Windows line endings must work the same.
  const lines = defsBlock().slice('<defs>'.length).split('\n')
    .map((l) => l.trim()).filter((l) => l !== '');
  assert.ok(lines.length > 100, `only ${lines.length} definitions`);
  const ids = new Set();
  for (const line of lines) {
    const id = /^<(\w+) id="([^"]+)"/.exec(line);
    assert.ok(id, `not one complete definition: ${line.slice(0, 60)}`);
    assert.ok(!ids.has(id[2]), `id ${id[2]} is used twice`);
    ids.add(id[2]);
    assert.ok(line.endsWith(`</${id[1]}>`) || line.endsWith('/>'), `${id[2]} is not closed on its line`);
    assertBalanced(line, `definition ${id[2]}`);
  }
  assert.equal(ids.size, lines.length);
});

test('the white backdrop is the first drawable child', () => {
  const backdrop = '<rect x="200" y="110" width="600" height="450" fill="#ffffff"/>';
  const at = svg.indexOf(backdrop);
  assert.ok(at > 0, 'the backdrop rect is missing');
  assert.ok(at > svg.indexOf('</defs>'), 'the backdrop must come after the definitions');
  assert.ok(at < markerAt(0), 'the backdrop must come before the first frame');
  const drawable = /<(rect|use|g|path|image|circle|polygon)\b/.exec(svg.slice(svg.indexOf('</defs>')));
  assert.equal(drawable[1], 'rect', 'something is drawn before the backdrop');
});

test('frame 0 is visible and every other frame is hidden', () => {
  for (let n = 0; n < FRAMES; n += 1) {
    const open = /<g[^>]*>/.exec(sliceFrame(n))[0];
    if (n === 0) assert.ok(!open.includes('display="none"'), 'frame 0 must be the visible one');
    else assert.ok(open.includes('display="none"'), `frame ${n} must be hidden`);
  }
});

test('every reference resolves to a definition and no id is used twice', () => {
  const defs = defsBlock();
  const defined = new Set([...defs.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  assert.ok(defined.size > 0, 'the definitions are empty');
  for (const m of svg.matchAll(/(?:xlink:)?href="#([^"]+)"/g)) {
    assert.ok(defined.has(m[1]), `reference #${m[1]} resolves to nothing`);
  }
  for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) {
    assert.ok(defined.has(m[1]), `paint reference #${m[1]} resolves to nothing`);
  }
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'an id is used twice');
});

test('the baked-in captions and the exporter bookkeeping are gone', () => {
  assert.ok(!svg.includes('font_'), 'a glyph definition survived');
  // Only the SVG and xlink namespaces may appear: the exporter writes its own prefixed
  // attributes and none of them belong in a shipped file.
  for (const m of svg.matchAll(/[\s<]([A-Za-z_][\w.-]*):[\w.-]+\s*=/g)) {
    assert.ok(m[1] === 'xmlns' || m[1] === 'xlink', `foreign namespace prefix "${m[1]}:" survived`);
  }
});

test('a frame cut out of the file is complete markup on its own', () => {
  const defs = `${defsBlock()}</defs>`;
  for (const n of [0, 1, 15, FRAMES - 1]) {
    const frame = sliceFrame(n);
    const standalone = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`
      + ` width="600" height="450" viewBox="200 110 600 450">${defs}`
      + `<rect x="200" y="110" width="600" height="450" fill="#ffffff"/>${frame}</svg>`;
    assertBalanced(standalone, `frame ${n} standalone`);
    const defined = new Set([...defs.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of frame.matchAll(/(?:xlink:)?href="#([^"]+)"/g)) {
      assert.ok(defined.has(m[1]), `frame ${n}: reference #${m[1]} resolves to nothing`);
    }
  }
});
