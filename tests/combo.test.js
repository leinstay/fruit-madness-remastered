import test from 'node:test';
import assert from 'node:assert/strict';
import { COMBO } from '../js/config.js';
import {
  createCombo, comboCollect, stepCombo, comboMultiplier, comboDrain, drainSplitY,
} from '../js/game/combo.js';

/** Steps the combo n times. */
const run = (c, n) => { for (let i = 0; i < n; i++) stepCombo(c); };

test('a fresh combo is empty: no cells, multiplier 1, nothing draining', () => {
  const c = createCombo();
  assert.equal(c.cells, 0);
  assert.equal(comboMultiplier(c), 1);
  assert.equal(comboDrain(c), 0);
});

test('every muffin pays 100 x the multiplier after the pickup, cells cap at 4', () => {
  const c = createCombo();
  assert.equal(comboCollect(c), 200);
  assert.equal(comboCollect(c), 300);
  assert.equal(comboCollect(c), 400);
  assert.equal(comboCollect(c), 500);
  assert.equal(c.cells, COMBO.CELLS);
  assert.equal(comboCollect(c), 500);
  assert.equal(c.cells, COMBO.CELLS);
  assert.equal(comboMultiplier(c), 5);
});

test('a single cell lives exactly CELL_FRAMES frames', () => {
  const c = createCombo();
  comboCollect(c);
  run(c, COMBO.CELL_FRAMES - 1);
  assert.equal(c.cells, 1);
  stepCombo(c);
  assert.equal(c.cells, 0);
  assert.equal(comboMultiplier(c), 1);
  assert.equal(comboDrain(c), 0);
});

test('cells burn down one after another, right to left', () => {
  const c = createCombo();
  for (let i = 0; i < 3; i++) comboCollect(c);
  assert.equal(c.cells, 3);
  run(c, COMBO.CELL_FRAMES);
  assert.equal(c.cells, 2);
  assert.equal(comboMultiplier(c), 3);
  run(c, COMBO.CELL_FRAMES);
  assert.equal(c.cells, 1);
  assert.equal(comboMultiplier(c), 2);
  run(c, COMBO.CELL_FRAMES);
  assert.equal(c.cells, 0);
  assert.equal(comboMultiplier(c), 1);
});

test('a pickup refills the draining cell and the new one gets a full life', () => {
  const c = createCombo();
  comboCollect(c);
  run(c, 200);
  assert.ok(comboDrain(c) < 1);
  assert.equal(comboCollect(c), 300);
  assert.equal(c.cells, 2);
  assert.equal(comboDrain(c), 1);
  run(c, COMBO.CELL_FRAMES - 1);
  assert.equal(c.cells, 2);
  stepCombo(c);
  assert.equal(c.cells, 1);
});

test('a pickup on a full bar resets the timer but keeps four cells', () => {
  const c = createCombo();
  for (let i = 0; i < COMBO.CELLS; i++) comboCollect(c);
  run(c, COMBO.CELL_FRAMES - 1);
  assert.equal(c.cells, COMBO.CELLS);
  assert.equal(comboCollect(c), 500);
  assert.equal(c.cells, COMBO.CELLS);
  assert.equal(comboDrain(c), 1);
  run(c, COMBO.CELL_FRAMES - 1);
  assert.equal(c.cells, COMBO.CELLS);
});

test('comboDrain runs from 1 down to 0 and never goes negative', () => {
  const c = createCombo();
  comboCollect(c);
  assert.equal(comboDrain(c), 1);
  run(c, COMBO.CELL_FRAMES / 2);
  assert.equal(comboDrain(c), 0.5);
  run(c, COMBO.CELL_FRAMES * 2);
  assert.equal(comboDrain(c), 0);
  assert.ok(comboDrain(c) >= 0);
});

test('stepping an empty combo does nothing', () => {
  const c = createCombo();
  stepCombo(c);
  assert.deepEqual(c, { cells: 0, timer: 0 });
  assert.equal(comboDrain(c), 0);
});

test('drainSplitY: full, empty, midpoint, integers and monotonicity', () => {
  assert.equal(drainSplitY(10, 20, 1), 10);
  assert.equal(drainSplitY(10, 20, 0), 30);
  assert.equal(drainSplitY(10, 20, 0.5), 20);
  assert.equal(drainSplitY(0, 21, 0.5), 11);
  let previous = drainSplitY(7, 19, 0);
  for (let i = 1; i <= 100; i++) {
    const y = drainSplitY(7, 19, i / 100);
    assert.equal(Number.isInteger(y), true);
    assert.ok(y >= 7 && y <= 26);
    assert.ok(y <= previous);
    previous = y;
  }
});
