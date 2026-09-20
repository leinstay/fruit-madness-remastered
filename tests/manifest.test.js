// tests/manifest.test.js — the asset manifest is the contract between the game logic,
// which only ever names a sprite, and the files on disk. These checks are filesystem-only
// (no DOM, no canvas) and catch the failure the loader cannot: a name the director can
// emit that nothing in assets/ answers to.
//
// The game draws one set of art: the vector drawings of the 2013 symbols. The manifest has
// a single `sprites` map, every entry of which names SVG files, states the exact logical
// viewport of the symbol (`size`) and pins its registration point (`anchor`).
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

/** Every file an entry refers to, whatever of the four frame forms it uses. */
function filesOf(entry) {
  if (typeof entry === 'string') return [entry];
  if (entry.frames) return entry.frames;
  if (entry.file) return [entry.file];
  return [];
}

/**
 * A `layered` sprite is one file holding every frame at once, so it plays by its own
 * rules: its viewport is the field rather than a symbol's box, and its frame count is a
 * number in the entry instead of a list of files.
 */
const layeredOf = (entry) => (typeof entry === 'object' ? layeredEntry(entry) : null);

test('every file named by the manifest exists', () => {
  for (const group of ['sprites', 'audio', 'fonts']) {
    for (const [name, entry] of Object.entries(manifest[group])) {
      const files = group === 'sprites' ? filesOf(entry) : [entry];
      assert.ok(files.length > 0, `${group}.${name} names no file`);
      if (group === 'sprites' && entry.notext) files.push(entry.notext);
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
  // And the pieces the combo bar is assembled from: the score capsule, because the 2013
  // combo symbol has its muffins and its "not working yet :(" line baked in, plus the
  // muffin itself, which is the cell icon at half size.
  for (const name of ['scoreBar', 'muffin']) assert.ok(name in sprites, `the combo bar needs '${name}'`);
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

test('every sprite file is vector art', () => {
  for (const [name, entry] of Object.entries(sprites)) {
    const files = filesOf(entry);
    if (entry.notext) files.push(entry.notext);
    for (const rel of files) {
      assert.ok(rel.endsWith('.svg'), `sprites.${name}: ${rel} is not an SVG`);
      svgRoot(path.join(ROOT, rel));
    }
  }
});

test('assets/sprites holds no raster art but the title tool input', () => {
  // The 2013 renders were reference only and are gone; the one raster left is the rainbow
  // banner of the title artwork, which tools/make-title.py embeds and the game never fetches.
  const raster = fs.readdirSync(path.join(ROOT, 'assets', 'sprites'))
    .filter((f) => !f.endsWith('.svg')).sort();
  assert.deepEqual(raster, ['titleBanner.png'], 'assets/sprites must hold nothing but SVG');
  assert.ok(!JSON.stringify(manifest).includes('titleBanner'), 'the banner is tool input, not an asset');
});

test('the cherry is the size its hit radius implies', () => {
  // ENEMY.SIZE = 30 around a hit radius of 13; the drawing is a 48x48 viewport whose
  // anchor puts the fruit on the lane centre.
  const [w, h] = sprites.cherry.size;
  assert.ok(w >= ENEMY.SIZE && w <= 2 * ENEMY.SIZE, `cherry width ${w}`);
  assert.ok(h >= ENEMY.SIZE && h <= 2 * ENEMY.SIZE, `cherry height ${h}`);
});

test('every sprite declares the viewport the manifest states', () => {
  for (const [name, entry] of Object.entries(sprites)) {
    if (layeredOf(entry)) continue;   // checked on its own terms below
    const files = filesOf(entry);
    assert.ok(files.length > 0, `sprites.${name} names no file`);
    assert.ok(Array.isArray(entry.size) && entry.size.length === 2, `sprites.${name}: needs a size`);
    if (entry.notext) files.push(entry.notext);
    for (const rel of files) {
      const { root } = svgRoot(path.join(ROOT, rel));
      const width = attrOf(root, 'width');
      const height = attrOf(root, 'height');
      const viewBox = attrOf(root, 'viewBox');
      assert.ok(width && height && viewBox, `${rel}: needs width, height and viewBox`);
      const box = viewBox.trim().split(/[\s,]+/).map(Number);
      assert.equal(box.length, 4, `${rel}: malformed viewBox`);
      assert.deepEqual([box[0], box[1]], [0, 0], `${rel}: the viewBox must start at the origin`);
      assert.deepEqual([box[2], box[3]], [Number(width), Number(height)], `${rel}: viewBox and width/height disagree`);
      assert.deepEqual([box[2], box[3]], entry.size, `${rel}: viewBox does not match sprites.${name}.size`);
    }
  }
});

test('every sprite entry pins its registration point inside the frame', () => {
  for (const [name, entry] of Object.entries(sprites)) {
    assert.ok(Array.isArray(entry.anchor) && entry.anchor.length === 2, `sprites.${name}: needs an explicit anchor`);
    const [x, y] = entry.anchor;
    const [w, h] = entry.size;
    assert.ok(x >= 0 && x <= w, `sprites.${name}: anchor x ${x} outside 0..${w}`);
    assert.ok(y >= 0 && y <= h, `sprites.${name}: anchor y ${y} outside 0..${h}`);
    if (Array.isArray(entry.durations) && !layeredOf(entry)) {
      assert.equal(entry.durations.length, entry.frames.length, `sprites.${name}: durations do not match frames`);
    }
  }
  assert.deepEqual(sprites.panda.anchor, [13.5, 12.5]);
  assert.deepEqual(sprites.ufo.anchor, [35.5, 34.5]);
});

test('the layered title sprite agrees with the file it names', () => {
  const layered = layeredOf(sprites.titleBg);
  assert.ok(layered, 'sprites.titleBg must be a layered entry');
  assert.deepEqual(layered.size, [600, 450], 'the title covers the whole field');
  assert.deepEqual(layered.anchor, [0, 0], 'it is drawn from the top-left corner');

  const text = fs.readFileSync(path.join(ROOT, layered.file), 'utf8');
  const markers = [...text.matchAll(/<!--frame:\d+-->/g)].length;
  assert.equal(layered.frameCount, markers, 'frameCount must match the markers in the file');

  // One turn of the title animation is 40 ticks, two thirds of a second, exactly as the
  // 2013 timeline recorded it.
  assert.equal(layered.durations.length, layered.frameCount, 'one duration per frame');
  assert.equal(layered.durations.reduce((a, b) => a + b, 0), 40, 'the loop is 40 ticks');

  // The viewport is the field; unlike the per-symbol drawings it does not start at the
  // origin, because it is the visible window onto a much larger drawing.
  const root = text.slice(0, text.indexOf('>') + 1);
  assert.equal(attrOf(root, 'width'), '600');
  assert.equal(attrOf(root, 'height'), '450');
  const box = attrOf(root, 'viewBox').trim().split(/[\s,]+/).map(Number);
  assert.deepEqual([box[2], box[3]], layered.size, 'the viewBox is the size the manifest states');
});

test('the sprite files carry nothing but drawable SVG', () => {
  const ALLOWED_PREFIXED = new Set(['xmlns:xlink', 'xlink:href']);
  for (const [name, entry] of Object.entries(sprites)) {
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
  // The combo capsule is drawn from the score capsule, so there are two files for three
  // bars and they have to stay interchangeable.
  const fuel = sprites.fuelBar.size;
  const score = sprites.scoreBar.size;
  assert.ok(Math.abs(fuel[0] - score[0]) <= 1, 'fuelBar is the same capsule as scoreBar');
  assert.ok(Math.abs(fuel[1] - score[1]) <= 1, 'fuelBar is the same height as scoreBar');
  assert.ok(Math.abs(sprites.fuelBar.anchor[0] - sprites.scoreBar.anchor[0]) <= 0.1, 'and sits on the same anchor');
  assert.equal(sprites.fuelBar.anchor[1], sprites.scoreBar.anchor[1]);
  // The fill is narrower than the capsule it slides inside.
  assert.ok(sprites.fuelFill.size[0] < fuel[0], 'the fuel fill fits inside the capsule');
});
