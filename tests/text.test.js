import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineForCenter, CAP_HEIGHT_RATIO, drawText, measureText, FONT_FAMILY } from '../js/core/text.js';

// A 2D-context stand-in: records what drawText did, and can pretend to be an old canvas
// implementation that does not report actualBoundingBox* at all.
function fakeCtx({ ascent = 10, descent = 0, ink = true } = {}) {
  const calls = [];
  return {
    calls,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
    save() { calls.push({ op: 'save' }); },
    restore() { calls.push({ op: 'restore' }); },
    measureText(str) {
      const m = { width: String(str).length * 8 };
      if (ink) { m.actualBoundingBoxAscent = ascent; m.actualBoundingBoxDescent = descent; }
      return m;
    },
    fillText(str, x, y) {
      calls.push({ op: 'fillText', str, x, y, font: this.font, baseline: this.textBaseline, align: this.textAlign });
    },
  };
}

const drawn = (ctx) => ctx.calls.find((c) => c.op === 'fillText');

test('baselineForCenter puts the middle of the glyph box on y', () => {
  // A box 10 above and 4 below the baseline is 14 tall; its centre is 3 above the baseline.
  assert.equal(baselineForCenter(100, 10, 4), 103);
  assert.equal(baselineForCenter(0, 10, 4), 3);
  assert.equal(baselineForCenter(-20, 10, 4), -17);
});

test('baselineForCenter is symmetric: an equal ascent and descent leaves y alone', () => {
  assert.equal(baselineForCenter(50, 7, 7), 50);
  assert.equal(baselineForCenter(50.4, 7, 7), 50);
  assert.equal(baselineForCenter(0, 120, 120), 0);
});

test('baselineForCenter handles a zero-height box', () => {
  assert.equal(baselineForCenter(32, 0, 0), 32);
  assert.equal(baselineForCenter(32.5, 0, 0), 33);
});

test('baselineForCenter rounds to a whole logical pixel so the text cannot shimmer', () => {
  assert.equal(baselineForCenter(32.5, 10, 0), 38);   // 37.5 -> 38
  assert.equal(baselineForCenter(32, 10, 0), 37);
  assert.equal(baselineForCenter(0, 9, 0), 5);        // 4.5 -> 5
  for (const y of [10, 10.1, 10.24, 10.49]) {
    assert.equal(baselineForCenter(y, 5, 1), 12, `y=${y}`);
  }
});

test('drawText defaults to the alphabetic baseline and draws exactly at y', () => {
  const ctx = fakeCtx();
  drawText(ctx, 'SCORE', 300, 32, { size: 16 });
  const call = drawn(ctx);
  assert.equal(call.y, 32);
  assert.equal(call.x, 300);
  assert.equal(call.baseline, 'alphabetic');
  assert.equal(call.font, `16px ${FONT_FAMILY}`);
});

test('drawText rounds x and y', () => {
  const ctx = fakeCtx();
  drawText(ctx, 'X', 10.6, 20.4);
  assert.deepEqual([drawn(ctx).x, drawn(ctx).y], [11, 20]);
});

test("valign 'center' centres the measured ink box on y", () => {
  const ctx = fakeCtx({ ascent: 10, descent: 0 });
  drawText(ctx, '0000000', 300, 32.5, { size: 16, align: 'center', valign: 'center' });
  const call = drawn(ctx);
  // Digits of the pixel font are 10 px tall at size 16 and sit entirely above the baseline,
  // so the baseline must fall 5 px below the requested centre.
  assert.equal(call.y, 38);
  assert.equal(call.baseline, 'alphabetic');
  assert.equal(call.align, 'center');
});

test("valign 'center' accounts for descenders", () => {
  const ctx = fakeCtx({ ascent: 10, descent: 2 });
  drawText(ctx, 'gyp', 100, 50, { size: 16, valign: 'center' });
  assert.equal(drawn(ctx).y, 54);
});

test("valign 'center' falls back to the font's cap height without actualBoundingBox*", () => {
  const ctx = fakeCtx({ ink: false });
  drawText(ctx, '0000000', 300, 32.5, { size: 16, align: 'center', valign: 'center' });
  assert.equal(CAP_HEIGHT_RATIO, 0.625);                 // measured from assets/fonts/pixel.ttf
  assert.equal(drawn(ctx).y, baselineForCenter(32.5, 16 * CAP_HEIGHT_RATIO, 0));
  assert.equal(drawn(ctx).y, 38);
});

test('measureText reports the width at the requested size', () => {
  const ctx = fakeCtx();
  assert.equal(measureText(ctx, 'ABC', 16), 24);
});
