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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'manifest.json'), 'utf8'));
const sprites = manifest.sprites;

/** Every file an entry refers to, whatever of the four forms it uses. */
function filesOf(entry) {
  if (typeof entry === 'string') return [entry];
  if (entry.frames) return entry.frames;
  if (entry.file) return [entry.file];
  return [];
}

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

test('the three HUD capsules are one size', () => {
  const fuel = pngHeader(path.join(ROOT, filesOf(sprites.fuelBar)[0]));
  const score = pngHeader(path.join(ROOT, filesOf(sprites.scoreBar)[0]));
  const combo = pngHeader(path.join(ROOT, filesOf(sprites.comboBar)[0]));
  assert.equal(combo.width, score.width, 'comboBar must match scoreBar in width');
  assert.equal(combo.height, score.height, 'comboBar must match scoreBar in height');
  assert.deepEqual(sprites.comboBar.anchor, sprites.scoreBar.anchor, 'comboBar must share the scoreBar anchor');
  assert.ok(Math.abs(fuel.width - combo.width) <= 1, 'fuelBar is the same capsule');
});
