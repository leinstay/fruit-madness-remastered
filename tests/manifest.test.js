// tests/manifest.test.js — the asset manifest is the contract between the game logic,
// which only ever names a sprite, and the files on disk. These checks are filesystem-only
// (no DOM, no canvas) and catch the failure the loader cannot: a name the director can
// emit that nothing in assets/ answers to.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ENEMY } from '../js/config.js';
import { FRUIT } from '../js/game/director.js';
import { MODES } from '../js/game/modes.js';
import { layeredEntry } from '../js/core/assets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'manifest.json'), 'utf8'));
const sprites = manifest.sprites;
const vectors = manifest.vectors;

/** Every file an entry refers to, whatever of the four forms it uses. */
function filesOf(entry) {
  if (typeof entry === 'string') return [entry];
  if (entry.frames) return entry.frames;
  if (entry.file) return [entry.file];
  return [];
}

/**
 * A `layered` vector is one file holding every frame at once, so it plays by its own
 * rules: its viewport is the field rather than a symbol's box, and its frame count is a
 * number in the entry instead of a list of files.
 */
const layeredOf = (entry) => (typeof entry === 'object' ? layeredEntry(entry) : null);

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Reads width, height and colour type straight out of the IHDR chunk. */
function pngHeader(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(33);
  fs.readSync(fd, head, 0, 33, 0);
  fs.closeSync(fd);
  assert.ok(head.subarray(0, 8).equals(PNG_MAGIC), `${file}: not a PNG`);
  assert.equal(head.toString('ascii', 12, 16), 'IHDR', `${file}: IHDR is not the first chunk`);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20), depth: head[24], color: head[25] };
}

test('every file named by the manifest exists', () => {
  for (const group of ['sprites', 'audio', 'fonts']) {
    for (const [name, entry] of Object.entries(manifest[group])) {
      const files = group === 'sprites' ? filesOf(entry) : [entry];
      assert.ok(files.length > 0, `${group}.${name} names no file`);
      for (const rel of files) {
        assert.ok(fs.existsSync(path.join(ROOT, rel)), `${group}.${name}: missing ${rel}`);
      }
    }
  }
});

test('every animated sprite has timing for exactly its frames', () => {
  for (const [name, entry] of Object.entries(sprites)) {
    if (typeof entry === 'string' || !entry.frames) continue;
    assert.ok(entry.frames.length >= 1, `${name}: empty frame list`);
    const hasFps = typeof entry.fps === 'number';
    const hasDurations = Array.isArray(entry.durations);
    assert.ok(hasFps !== hasDurations, `${name}: needs exactly one of fps / durations`);
    if (hasFps) assert.ok(entry.fps > 0, `${name}: fps must be positive`);
    else {
      assert.equal(entry.durations.length, entry.frames.length, `${name}: durations do not match frames`);
      for (const d of entry.durations) assert.ok(Number.isInteger(d) && d > 0, `${name}: bad duration ${d}`);
    }
  }
});

test('every sprite the game logic can name is in the manifest', () => {
  // The one fruit the director hands to every attack wave.
  assert.ok(FRUIT in sprites, `director can emit '${FRUIT}'`);
  // The DANGER sign each of the eight attack modes announces itself with.
  for (const [id, mode] of Object.entries(MODES)) {
    assert.ok(mode.danger.sprite in sprites, `mode ${id} warns with '${mode.danger.sprite}'`);
  }
  // And the HUD pieces the combo bar is assembled from.
  for (const name of ['comboBar', 'comboCell']) assert.ok(name in sprites, `HUD needs '${name}'`);
});

test('every sprite file is a readable 8-bit PNG', () => {
  for (const entry of Object.values(sprites)) {
    for (const rel of filesOf(entry)) {
      const h = pngHeader(path.join(ROOT, rel));
      assert.equal(h.depth, 8, `${rel}: expected 8 bits per sample`);
      assert.ok(h.width > 0 && h.height > 0, `${rel}: empty image`);
    }
  }
});

test('the cherry is the size its hit radius implies', () => {
  // ENEMY.SIZE = 30 around a hit radius of 13; the extracted art is a 46x46 frame whose
  // anchor puts the fruit on the lane centre.
  for (const rel of filesOf(sprites.cherry)) {
    const h = pngHeader(path.join(ROOT, rel));
    assert.ok(h.width >= ENEMY.SIZE && h.width <= 2 * ENEMY.SIZE, `${rel}: width ${h.width}`);
    assert.ok(h.height >= ENEMY.SIZE && h.height <= 2 * ENEMY.SIZE, `${rel}: height ${h.height}`);
  }
});

/** The opening tag of an SVG file, where the viewport is declared. */
function svgRoot(file) {
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('<svg'), `${file}: must start with <svg`);
  return { text, root: text.slice(0, text.indexOf('>') + 1) };
}

const attrOf = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};

test('every vector file exists and declares the viewport the manifest states', () => {
  for (const [name, entry] of Object.entries(vectors)) {
    if (layeredOf(entry)) continue;   // checked on its own terms below
    const files = filesOf(entry);
    assert.ok(files.length > 0, `vectors.${name} names no file`);
    assert.ok(Array.isArray(entry.size) && entry.size.length === 2, `vectors.${name}: needs a size`);
    if (entry.notext) files.push(entry.notext);
    for (const rel of files) {
      assert.ok(rel.endsWith('.svg'), `vectors.${name}: ${rel} is not an SVG`);
      const file = path.join(ROOT, rel);
      assert.ok(fs.existsSync(file), `vectors.${name}: missing ${rel}`);
      const { root } = svgRoot(file);
      const width = attrOf(root, 'width');
      const height = attrOf(root, 'height');
      const viewBox = attrOf(root, 'viewBox');
      assert.ok(width && height && viewBox, `${rel}: needs width, height and viewBox`);
      const box = viewBox.trim().split(/[\s,]+/).map(Number);
      assert.equal(box.length, 4, `${rel}: malformed viewBox`);
      assert.deepEqual([box[0], box[1]], [0, 0], `${rel}: the viewBox must start at the origin`);
      assert.deepEqual([box[2], box[3]], [Number(width), Number(height)], `${rel}: viewBox and width/height disagree`);
      assert.deepEqual([box[2], box[3]], entry.size, `${rel}: viewBox does not match vectors.${name}.size`);
    }
  }
});

test('every vector entry pins its registration point inside the frame', () => {
  for (const [name, entry] of Object.entries(vectors)) {
    assert.ok(Array.isArray(entry.anchor) && entry.anchor.length === 2, `vectors.${name}: needs an explicit anchor`);
    const [x, y] = entry.anchor;
    const [w, h] = entry.size;
    assert.ok(x >= 0 && x <= w, `vectors.${name}: anchor x ${x} outside 0..${w}`);
    assert.ok(y >= 0 && y <= h, `vectors.${name}: anchor y ${y} outside 0..${h}`);
    if (Array.isArray(entry.durations) && !layeredOf(entry)) {
      assert.equal(entry.durations.length, entry.frames.length, `vectors.${name}: durations do not match frames`);
    }
  }
  assert.deepEqual(vectors.panda.anchor, [13.5, 12.5]);
  assert.deepEqual(vectors.ufo.anchor, [35.5, 34.5]);
});

test('every vector mirrors the sprite of the same name, frame for frame', () => {
  for (const [name, entry] of Object.entries(vectors)) {
    assert.ok(name in sprites, `vectors.${name} has no sprite to replace`);
    const sprite = sprites[name];
    const layered = layeredOf(entry);
    const count = layered ? layered.frameCount : filesOf(entry).length;
    assert.equal(count, filesOf(sprite).length, `vectors.${name}: frame count differs from the sprite`);
    assert.equal(entry.fps ?? null, sprite.fps ?? null, `vectors.${name}: fps differs from the sprite`);
    assert.deepEqual(entry.durations ?? null, sprite.durations ?? null, `vectors.${name}: durations differ from the sprite`);
  }
});

test('the layered title vector agrees with the file it names', () => {
  const layered = layeredOf(vectors.titleBg);
  assert.ok(layered, 'vectors.titleBg must be a layered entry');
  assert.deepEqual(layered.size, [600, 450], 'the title covers the whole field');
  assert.deepEqual(layered.anchor, [0, 0], 'it is drawn from the top-left corner');

  const text = fs.readFileSync(path.join(ROOT, layered.file), 'utf8');
  const markers = [...text.matchAll(/<!--frame:\d+-->/g)].length;
  assert.equal(layered.frameCount, markers, 'frameCount must match the markers in the file');

  // One turn of the title animation is 40 ticks, two thirds of a second, exactly as the
  // 2013 timeline recorded it.
  assert.equal(layered.durations.length, layered.frameCount, 'one duration per frame');
  assert.equal(layered.durations.reduce((a, b) => a + b, 0), 40, 'the loop is 40 ticks');

  // The viewport is the field; unlike the per-symbol vectors it does not start at the
  // origin, because it is the visible window onto a much larger drawing.
  const root = text.slice(0, text.indexOf('>') + 1);
  assert.equal(attrOf(root, 'width'), '600');
  assert.equal(attrOf(root, 'height'), '450');
  const box = attrOf(root, 'viewBox').trim().split(/[\s,]+/).map(Number);
  assert.deepEqual([box[2], box[3]], layered.size, 'the viewBox is the size the manifest states');
});

test('the vector files carry nothing but drawable SVG', () => {
  const ALLOWED_PREFIXED = new Set(['xmlns:xlink', 'xlink:href']);
  for (const [name, entry] of Object.entries(vectors)) {
    const files = filesOf(entry);
    if (entry.notext) files.push(entry.notext);
    for (const rel of files) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const [, attr] of text.matchAll(/\s([a-zA-Z][\w.-]*:[\w.-]+)=/g)) {
        assert.ok(ALLOWED_PREFIXED.has(attr), `${rel}: unexpected namespaced attribute ${attr}`);
      }
      if (rel.endsWith('.notext.svg')) {
        assert.ok(!text.includes('font_'), `${rel}: still carries baked-in glyphs`);
      }
    }
  }
});

test('the three HUD capsules are one size', () => {
  const fuel = pngHeader(path.join(ROOT, filesOf(sprites.fuelBar)[0]));
  const score = pngHeader(path.join(ROOT, filesOf(sprites.scoreBar)[0]));
  const combo = pngHeader(path.join(ROOT, filesOf(sprites.comboBar)[0]));
  assert.equal(combo.width, score.width, 'comboBar must match scoreBar in width');
  assert.equal(combo.height, score.height, 'comboBar must match scoreBar in height');
  assert.deepEqual(sprites.comboBar.anchor, sprites.scoreBar.anchor, 'comboBar must share the scoreBar anchor');
  assert.ok(Math.abs(fuel.width - combo.width) <= 1, 'fuelBar is the same capsule');
});
