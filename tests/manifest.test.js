// tests/manifest.test.js — the asset manifest is the contract between the game logic,
// which only ever names a sprite, and the files on disk. These checks are filesystem-only
// (no DOM, no canvas) and catch the failure the loader cannot: a name the director or an
// event can emit that nothing in assets/ answers to.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FRUITS } from '../js/game/director.js';

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
  // The fruit the director hands to each attack wave.
  for (const fruit of FRUITS) assert.ok(fruit in sprites, `director can emit '${fruit}'`);
  // The events name their sprites as literals; read them out of the source so a new event
  // cannot quietly introduce a sprite that does not exist.
  const events = fs.readFileSync(path.join(ROOT, 'js', 'game', 'events.js'), 'utf8');
  const named = [...events.matchAll(/sprite:\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
  assert.ok(named.includes('berry') && named.includes('boss'), 'events still spawn berry and boss');
  for (const name of new Set(named)) assert.ok(name in sprites, `events can emit '${name}'`);
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

test('the fruit enemies are the same size as the cherry they join', () => {
  const cherry = pngHeader(path.join(ROOT, filesOf(sprites.cherry)[0]));
  for (const fruit of FRUITS) {
    for (const rel of filesOf(sprites[fruit])) {
      const h = pngHeader(path.join(ROOT, rel));
      // A wave mixes fruit freely, so they must all read at one scale. Half a cherry to
      // one and a half is as far apart as they may drift.
      assert.ok(h.width >= cherry.width * 0.5 && h.width <= cherry.width * 1.5, `${rel}: width ${h.width} vs cherry ${cherry.width}`);
      assert.ok(h.height >= cherry.height * 0.5 && h.height <= cherry.height * 1.5, `${rel}: height ${h.height} vs cherry ${cherry.height}`);
    }
  }
});

test('the event sprites are the size their hit radius implies', () => {
  // berry ~12x12 around ENEMY.BERRY_R = 5, boss ~120x120 around ENEMY.BOSS_R = 60.
  const berry = pngHeader(path.join(ROOT, filesOf(sprites.berry)[0]));
  assert.ok(berry.width >= 8 && berry.width <= 16, `berry width ${berry.width}`);
  assert.ok(berry.height >= 8 && berry.height <= 16, `berry height ${berry.height}`);
  for (const rel of filesOf(sprites.boss)) {
    const h = pngHeader(path.join(ROOT, rel));
    assert.ok(h.width >= 100 && h.width <= 140, `${rel}: width ${h.width}`);
    assert.ok(h.height >= 100 && h.height <= 140, `${rel}: height ${h.height}`);
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
