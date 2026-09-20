// tests/fruits.test.js — the restored title-screen cast.
//
// The 2013 title screen shows six fruit; only the cherry ever flew at the player.
// The other five are drawn from the same artwork and enter the game as enemies, so
// their manifest entries have to obey the same contract the cherry always did: one
// viewport per fruit shared by all of its frames, one anchor that puts the 13 px hit
// circle on the body, and per-frame holds that play the title's own cycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { frameAt } from '../js/core/anim.js';
import { normalizeSpriteEntry, spriteSource } from '../js/core/assets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sprites = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'manifest.json'), 'utf8')).sprites;

// The five drawings restored from the title screen, with the number of distinct files
// each one is made of. The cherry is not here: it has been in the manifest since the
// first commit and is checked by tests/manifest.test.js.
const RESTORED = { apple: 2, pear: 2, pomegranate: 2, lime: 3, banana: 4 };

// The longer side of every drawing in the cast, in logical pixels. One scale for all of
// them, so a pear and an apple keep the relative sizes the title screen gives them.
const LONG_SIDE = 48;

test('every restored fruit is an animated sprite of its own files', () => {
  for (const [name, fileCount] of Object.entries(RESTORED)) {
    const entry = sprites[name];
    assert.ok(entry, `sprites.${name} is missing`);
    assert.ok(Array.isArray(entry.frames), `sprites.${name}: needs a frame list`);
    assert.equal(new Set(entry.frames).size, fileCount, `sprites.${name}: expected ${fileCount} distinct files`);
    for (const rel of entry.frames) {
      assert.match(rel, new RegExp(`^assets/sprites/${name}_\\d+\\.svg$`), `sprites.${name}: odd file ${rel}`);
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `sprites.${name}: missing ${rel}`);
    }
  }
});

test('the cast is drawn to one scale', () => {
  for (const name of [...Object.keys(RESTORED), 'cherry']) {
    const [w, h] = sprites[name].size;
    assert.equal(Math.max(w, h), LONG_SIDE, `sprites.${name}: ${w}x${h} is not drawn at the cast's scale`);
    assert.ok(w > 0 && h > 0, `sprites.${name}: empty viewport`);
  }
});

test('every restored fruit pins its anchor on the body', () => {
  // The anchor is where the enemy's hit circle sits, so it must be well inside the
  // drawing rather than on its border, where a stem or a peel tip would be.
  for (const name of Object.keys(RESTORED)) {
    const [x, y] = sprites[name].anchor;
    const [w, h] = sprites[name].size;
    assert.ok(x > w * 0.15 && x < w * 0.85, `sprites.${name}: anchor x ${x} is not on the body`);
    assert.ok(y > h * 0.15 && y < h * 0.85, `sprites.${name}: anchor y ${y} is not on the body`);
  }
});

test('the banana plays its five-step cycle from four drawings', () => {
  // The title swings it k0 k1 k2 k1 k3, so the second drawing is shown twice a loop.
  const entry = sprites.banana;
  const files = entry.frames.map((rel) => rel.replace(/^.*banana_(\d+)\.svg$/, '$1'));
  assert.deepEqual(files, ['0', '1', '2', '1', '3'], 'the banana cycle is k0 k1 k2 k1 k3');
  assert.equal(entry.durations.length, 5, 'one hold per step of the cycle');
});

test('a repeated frame survives the loader untouched', () => {
  // A file named twice in `frames` is simply loaded twice and indexed twice: nothing in
  // the sprite pipeline deduplicates, so the cycle keeps its order.
  const spec = normalizeSpriteEntry(sprites.banana);
  assert.equal(spec.frames.length, 5);
  assert.equal(spec.frames[1], spec.frames[3], 'step 1 and step 3 are the same drawing');
  assert.deepEqual(spec.timing, sprites.banana.durations);
  const source = spriteSource(spec);
  assert.equal(source.kind, 'vector');
  assert.deepEqual(source.frames, spec.frames);
});

test('every fruit animates on its own timing', () => {
  for (const name of [...Object.keys(RESTORED), 'cherry']) {
    const { frames, durations } = sprites[name];
    assert.ok(Array.isArray(durations), `sprites.${name}: needs per-frame holds`);
    assert.equal(durations.length, frames.length, `sprites.${name}: a hold per frame`);
    const loop = durations.reduce((a, b) => a + b, 0);
    // Walk one whole loop and check every step is reached, in order, for its own hold.
    const seen = [];
    for (let t = 0; t < loop; t++) {
      const i = frameAt(durations, frames.length, t);
      if (seen.length === 0 || seen[seen.length - 1] !== i) seen.push(i);
    }
    assert.deepEqual(seen, frames.map((_, i) => i), `sprites.${name}: the cycle does not play in order`);
    assert.equal(frameAt(durations, frames.length, loop), 0, `sprites.${name}: the loop does not close`);
  }
});

test('an enemy phase offset lands somewhere inside every cycle', () => {
  // Enemies are given animOffset = rng.int(0, 59) at spawn; that has to desynchronise a
  // wave for every fruit, so no cycle may be so long that 0..59 is a single frame.
  for (const name of [...Object.keys(RESTORED), 'cherry']) {
    const { frames, durations } = sprites[name];
    const reached = new Set();
    for (let off = 0; off <= 59; off++) reached.add(frameAt(durations, frames.length, off));
    assert.ok(reached.size >= 2, `sprites.${name}: a spawn offset never changes its frame`);
  }
});
