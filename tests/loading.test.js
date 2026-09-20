// What the loading screen shows, and when it gets out of the way.
//
// Starting the game has two waits the player can see: the manifest's sprites are fetched,
// and then the title artwork is sliced and its first keyframe rasterised. The screen covers
// both, and the decision itself is pure — a plain state in, a flag and a fraction out — so
// every rule below is checked without a canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadingState, filledCells, ASSET_SHARE, TITLE_TIMEOUT_MS, BAR_CELLS,
} from '../js/core/loading.js';

// While the sprites are still loading the caller cannot say how long ago they finished.
const loadingSprites = (done, total) => loadingState({ assetsDone: done, assetsTotal: total });
// Once they have, the wait is measured from that moment.
const waitingForTitle = (ms, extra = {}) => loadingState({
  assetsDone: 8, assetsTotal: 8, msSinceAssets: ms, ...extra,
});

test('the screen is up from the very first frame, before anything is known', () => {
  const state = loadingState({});
  assert.equal(state.show, true);
  assert.equal(state.progress, 0);
});

test('the sprite phase drives the bar by frames actually loaded', () => {
  assert.equal(loadingSprites(0, 8).progress, 0);
  assert.equal(loadingSprites(4, 8).progress, ASSET_SHARE / 2);
  assert.equal(loadingSprites(8, 8).progress, ASSET_SHARE);
  for (const done of [0, 3, 8]) assert.equal(loadingSprites(done, 8).show, true, `${done}/8 still loads`);
});

test('the bar never runs past the phase it is measuring', () => {
  assert.equal(loadingSprites(12, 8).progress, ASSET_SHARE, 'more than every frame is still every frame');
  assert.equal(loadingSprites(-3, 8).progress, 0);
  // A manifest that could not be read leaves nothing to count: the bar simply waits.
  assert.equal(loadingSprites(0, 0).progress, 0);
  assert.equal(loadingSprites(0, 0).show, true);
});

test('the screen stays up while the title is being prepared', () => {
  const state = waitingForTitle(1200);
  assert.equal(state.show, true);
  assert.equal(state.progress, ASSET_SHARE, 'the sprite phase is done, the title one is not');
});

test('the menu is revealed the moment the title has its first keyframe', () => {
  assert.deepEqual(waitingForTitle(1200, { titleReady: true }), { show: false, progress: 1 });
});

test('a title that cannot be shown never traps the player', () => {
  assert.deepEqual(waitingForTitle(300, { titleFailed: true }), { show: false, progress: 1 });
});

test('a title that is simply too slow gives up after the timeout', () => {
  assert.equal(waitingForTitle(TITLE_TIMEOUT_MS - 1).show, true);
  assert.deepEqual(waitingForTitle(TITLE_TIMEOUT_MS), { show: false, progress: 1 });
  assert.deepEqual(waitingForTitle(TITLE_TIMEOUT_MS * 4), { show: false, progress: 1 });
});

test('progress only ever grows over a whole boot', () => {
  const steps = [];
  for (let done = 0; done <= 8; done += 1) steps.push(loadingSprites(done, 8));
  for (let ms = 0; ms < TITLE_TIMEOUT_MS; ms += 500) steps.push(waitingForTitle(ms));
  steps.push(waitingForTitle(2500, { titleReady: true }));
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i].progress >= steps[i - 1].progress,
      `step ${i} went backwards: ${steps[i - 1].progress} -> ${steps[i].progress}`);
  }
});

test('a full bar means the menu, and nothing else does', () => {
  const states = [
    loadingState({}), loadingSprites(0, 8), loadingSprites(7, 8), loadingSprites(8, 8),
    waitingForTitle(0), waitingForTitle(TITLE_TIMEOUT_MS - 1),
    waitingForTitle(1000, { titleReady: true }), waitingForTitle(1000, { titleFailed: true }),
    waitingForTitle(TITLE_TIMEOUT_MS),
  ];
  for (const state of states) {
    assert.equal(state.progress === 1, state.show === false, JSON.stringify(state));
    assert.ok(state.progress >= 0 && state.progress <= 1, JSON.stringify(state));
  }
});

test('the bar fills a whole cell at a time and only fills the last one at the end', () => {
  assert.equal(filledCells(0), 0);
  assert.equal(filledCells(1), BAR_CELLS);
  assert.equal(filledCells(0.5), BAR_CELLS / 2);
  assert.ok(filledCells(0.999) < BAR_CELLS, 'almost there is not there');
  assert.equal(filledCells(-1), 0);
  assert.equal(filledCells(4), BAR_CELLS);
  assert.equal(filledCells(Number.NaN), 0);
  let previous = 0;
  for (let p = 0; p <= 1; p += 0.01) {
    const cells = filledCells(p);
    assert.ok(cells >= previous && cells <= BAR_CELLS);
    previous = cells;
  }
});
