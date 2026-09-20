// tests/captions.test.js — the pure parts of the runtime captions: the DANGER fade and
// the layout of the four straight strips and the four corner signs. The drawing itself
// needs a canvas and is not tested here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { W, H } from '../js/config.js';
import {
  dangerAlpha, dangerStackGlyphs, dangerBarBox, dangerCornerArms, dangerBoxes,
  DANGER_TEXT, DANGER_CORNER_TEXT, DANGER_SIZE, DANGER_FADE_PERIOD, DANGER_LAYOUT,
  DANGER_MAX_ADVANCE,
} from '../js/scenes/captions.js';

// The two bands a sign must stay out of: the HUD capsules along the top and the two
// buttons along the bottom.
const HUD_BOTTOM = 62;
const BUTTONS_TOP = 405;
const CAP = DANGER_SIZE * 0.625;        // the cap box every glyph is centred on

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('the DANGER fade is one cosine cycle every 100 frames, 1 -> 0.1 -> 1', () => {
  assert.equal(DANGER_FADE_PERIOD, 100);
  assert.equal(dangerAlpha(0), 1);
  assert.ok(near(dangerAlpha(50), 0.1));
  assert.ok(near(dangerAlpha(100), 1));
  assert.ok(near(dangerAlpha(25), 0.55));
  assert.ok(near(dangerAlpha(75), 0.55));
});

test('the fade never goes out and never overshoots, over a whole warning phase', () => {
  for (let t = 0; t <= 300; t++) {
    const a = dangerAlpha(t);
    assert.ok(a >= 0.1 - 1e-9 && a <= 1 + 1e-9, `alpha ${a} at ${t}`);
  }
  // Three full cycles fit into the 300-frame warning, and every one of them starts lit.
  for (const t of [0, 100, 200, 300]) assert.ok(near(dangerAlpha(t), 1), `lit at ${t}`);
});

test('the fade is smooth: no step between two frames is a flicker', () => {
  let prev = dangerAlpha(0);
  for (let t = 1; t <= 300; t++) {
    const a = dangerAlpha(t);
    assert.ok(Math.abs(a - prev) < 0.03, `jump of ${Math.abs(a - prev)} at ${t}`);
    prev = a;
  }
});

test('the fade survives a negative or broken tick', () => {
  assert.ok(Number.isFinite(dangerAlpha(-1)));
  assert.equal(dangerAlpha(-100), dangerAlpha(100));
  assert.equal(dangerAlpha(NaN), 1);
  assert.equal(dangerAlpha(undefined), 1);
});

test('the sign texts are the marks and the word, 24 px', () => {
  assert.equal(DANGER_TEXT, '*******  DANGER  *******');
  assert.equal(DANGER_CORNER_TEXT, '**** DANGER ****');
  assert.equal(DANGER_SIZE, 24);
});

// --- the four straight strips ----------------------------------------------------------

test('the layout table is symmetric about the centre of the field', () => {
  const { side, corner } = DANGER_LAYOUT;
  assert.equal(side.left.x + side.right.x, W);
  assert.equal(side.left.y, H / 2);
  assert.equal(side.right.y, H / 2);
  assert.equal(side.top.x, W / 2);
  assert.equal(side.bottom.x, W / 2);
  assert.equal(corner.tl.x + corner.tr.x, W);
  assert.equal(corner.bl.x + corner.br.x, W);
  assert.equal(corner.tl.y + corner.bl.y, H);
  assert.equal(corner.tr.y + corner.br.y, H);
  assert.equal(corner.tl.y, corner.tr.y);
  assert.equal(corner.bl.y, corner.br.y);
});

test('the left and right strips stack one character a line, marks closer than letters', () => {
  for (const side of ['left', 'right']) {
    const glyphs = dangerStackGlyphs(side);
    assert.equal(glyphs.length, 16);
    assert.equal(glyphs.map((g) => g.ch).join(''), '*****DANGER*****');
    assert.ok(glyphs.every((g) => g.x === DANGER_LAYOUT.side[side].x), `${side}: one column`);
    const pitch = (a, b) => glyphs[b].y - glyphs[a].y;
    for (let i = 1; i < 5; i++) assert.equal(pitch(i - 1, i), 14, `${side}: mark pitch`);
    for (let i = 6; i < 11; i++) assert.equal(pitch(i - 1, i), 19, `${side}: letter pitch`);
    for (let i = 12; i < 16; i++) assert.equal(pitch(i - 1, i), 14, `${side}: tail mark pitch`);
  }
});

test('the left and right strips are centred on the middle of the field', () => {
  for (const side of ['left', 'right']) {
    const ys = dangerStackGlyphs(side).map((g) => g.y);
    assert.equal((Math.min(...ys) + Math.max(...ys)) / 2, H / 2, `${side}: centred on y`);
    // and mirror-symmetric about it, line by line
    for (let i = 0; i < ys.length; i++) assert.equal(ys[i] + ys[ys.length - 1 - i], H, `${side}: line ${i}`);
  }
  // The two strips are each other's mirror image about the vertical axis.
  const left = dangerStackGlyphs('left');
  const right = dangerStackGlyphs('right');
  for (let i = 0; i < left.length; i++) {
    assert.equal(left[i].ch, right[i].ch);
    assert.equal(left[i].x + right[i].x, W);
    assert.equal(left[i].y, right[i].y);
  }
});

test('the top and bottom strips are centred on the vertical axis and clear of the HUD', () => {
  const top = dangerBarBox('top');
  const bottom = dangerBarBox('bottom');
  for (const [name, box] of [['top', top], ['bottom', bottom]]) {
    assert.equal(box.x + box.w / 2, W / 2, `${name}: centred on x`);
    assert.ok(box.x >= 0 && box.x + box.w <= W, `${name}: inside the field`);
  }
  assert.equal(top.w, bottom.w);
  assert.equal(top.h, bottom.h);
  // The lettering itself — the cap box around the strip's centre line — clears both bands.
  const band = (box) => [box.y + box.h / 2 - CAP / 2, box.y + box.h / 2 + CAP / 2];
  const [topInk] = [band(top)];
  assert.ok(topInk[0] > HUD_BOTTOM, `the top strip starts at ${topInk[0]}, under the HUD`);
  assert.ok(band(bottom)[1] < BUTTONS_TOP, 'the bottom strip clears the buttons');
});

test('every glyph of a straight strip is inside the field and out of both bands', () => {
  for (const side of ['left', 'right']) {
    for (const g of dangerStackGlyphs(side)) {
      assert.ok(g.x - CAP / 2 > 0 && g.x + CAP / 2 < W, `${side}: x ${g.x}`);
      assert.ok(g.y - CAP / 2 > HUD_BOTTOM, `${side}: y ${g.y} under the HUD`);
      assert.ok(g.y + CAP / 2 < BUTTONS_TOP, `${side}: y ${g.y} on the buttons`);
    }
  }
});

// --- the four corner signs --------------------------------------------------------------

const CORNERS = ['tl', 'tr', 'bl', 'br'];
const SIDES = ['left', 'right', 'top', 'bottom'];
const cornerSign = (c) => ({ kind: 'corner', corner: c });
const sideSign = (s) => ({ kind: 'side', side: s });

/** Do two boxes share any area? Touching edges do not count as an overlap. */
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The shortest distance between two boxes; 0 when they touch, negative when they meet. */
function gap(a, b) {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (dx >= 0 && dy >= 0) return Math.hypot(dx, dy);
  return Math.max(dx, dy);
}

test('a corner sign reads DANGER through its corner, one arm stacked and one a line', () => {
  for (const c of CORNERS) {
    const sign = dangerCornerArms(c);
    assert.equal(sign.arms.length, 2, `${c}: two arms`);
    assert.equal(sign.arms.map((a) => a.text).join(''), DANGER_CORNER_TEXT, `${c}: reading order`);
    assert.equal(sign.arms[0].text, '**** DAN');
    assert.equal(sign.arms[1].text, 'GER ****');
    // One arm is typeset like a left/right strip, the other like a top/bottom one.
    assert.deepEqual(sign.arms.map((a) => a.kind).sort(), ['line', 'stack'], `${c}: one of each`);
  }
});

test('at a left corner the DAN arm is the stacked one, at a right corner the line', () => {
  for (const c of CORNERS) {
    const sign = dangerCornerArms(c);
    const left = c === 'tl' || c === 'bl';
    assert.equal(sign.arms[0].kind, left ? 'stack' : 'line', `${c}: the DAN arm`);
    assert.equal(sign.arms[1].kind, left ? 'line' : 'stack', `${c}: the GER arm`);
    // A horizontal arm always reads left to right: it starts at the corner of a left sign
    // and ends at the corner of a right one.
    const line = sign.arms.find((a) => a.kind === 'line');
    assert.equal(line.align, left ? 'left' : 'right', `${c}: reading direction`);
    assert.equal(line.y, DANGER_LAYOUT.corner[c].y, `${c}: the line runs along the corner's row`);
    assert.equal(Math.abs(line.x - DANGER_LAYOUT.corner[c].x), DANGER_LAYOUT.cornerInset, `${c}: line inset`);
  }
});

test('the stacked arm of a corner sign is spaced exactly like a side strip', () => {
  const { letterPitch, markPitch, cornerGap, cornerInset } = DANGER_LAYOUT;
  assert.ok(cornerGap >= markPitch, 'the word is set off by at least one mark pitch');
  for (const c of CORNERS) {
    const stack = dangerCornerArms(c).arms.find((a) => a.kind === 'stack');
    assert.equal(stack.glyphs.length, 7, `${c}: three letters and four marks`);
    assert.ok(stack.glyphs.every((g) => g.x === DANGER_LAYOUT.corner[c].x), `${c}: one column`);
    // In reading order a stack may run either way, so measure along the arm instead.
    const d = stack.glyphs.map((g) => Math.abs(g.y - DANGER_LAYOUT.corner[c].y)).sort((a, b) => a - b);
    const steps = d.slice(1).map((v, i) => v - d[i]);
    assert.equal(d[0], cornerInset, `${c}: the first glyph sits one letter pitch from the corner`);
    assert.deepEqual(steps, [letterPitch, letterPitch, cornerGap, markPitch, markPitch, markPitch],
      `${c}: letters ${letterPitch} apart and marks ${markPitch}, exactly as on a side strip`);
    assert.ok(letterPitch >= 19 && markPitch >= 14, 'and those are the strip pitches');
  }
});

test('the stacked arm ends at the corner with the N, the line leaves it with the G', () => {
  const nearest = (glyphs, point) => glyphs.reduce((a, b) => (
    Math.hypot(a.x - point.x, a.y - point.y) <= Math.hypot(b.x - point.x, b.y - point.y) ? a : b));
  for (const c of CORNERS) {
    const sign = dangerCornerArms(c);
    const point = DANGER_LAYOUT.corner[c];
    const stack = sign.arms.find((a) => a.kind === 'stack');
    const stacksDan = sign.arms[0].kind === 'stack';
    assert.equal(nearest(stack.glyphs, point).ch, stacksDan ? 'N' : 'G', `${c}: the glyph next to the corner`);
    assert.equal(stack.glyphs.map((g) => g.ch).join(''), stacksDan ? '****DAN' : 'GER****', `${c}: reading order`);
  }
  // The stacked arm of a left sign reads towards the corner, of a right sign away from it.
  const glyphsOf = (c) => dangerCornerArms(c).arms.find((a) => a.kind === 'stack').glyphs;
  assert.ok(glyphsOf('tl')[0].y > glyphsOf('tl')[6].y, 'tl: the marks hang below the word');
  assert.ok(glyphsOf('bl')[0].y < glyphsOf('bl')[6].y, 'bl: the marks sit above the word');
  assert.ok(glyphsOf('tr')[0].y < glyphsOf('tr')[6].y, 'tr: GER leaves the corner downwards');
  assert.ok(glyphsOf('br')[0].y > glyphsOf('br')[6].y, 'br: GER leaves the corner upwards');
});

test('the two arms of a corner sign never overlap, and the corner cell stays empty', () => {
  // Inside one stacked column the spacing is the strip's own (19 px letters, 14 px marks,
  // checked above): the marks are set closer than the cap box is tall because their ink is
  // a small cross, which is exactly how the 2013 strip is set. What must not touch is one
  // arm against the other, and that is measured on the generous boxes.
  for (const c of CORNERS) {
    const sign = dangerCornerArms(c);
    // dangerBoxes lists the first arm's boxes and then the second's: seven for a stacked
    // arm, one for a line.
    const boxes = dangerBoxes(cornerSign(c));
    const split = sign.arms[0].kind === 'stack' ? 7 : 1;
    assert.equal(boxes.length, 8, `${c}: seven stacked glyphs and one line`);
    for (const a of boxes.slice(0, split)) {
      for (const b of boxes.slice(split)) assert.ok(!overlaps(a, b), `${c}: the arms run into each other`);
    }
  }
  for (const c of CORNERS) {
    const point = DANGER_LAYOUT.corner[c];
    for (const b of dangerBoxes(cornerSign(c))) {
      const inside = point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h;
      assert.ok(!inside, `${c}: a glyph covers the corner itself`);
    }
  }
});

test('a corner sign never touches a straight strip', () => {
  let smallest = Infinity;
  for (const c of CORNERS) {
    for (const s of SIDES) {
      for (const a of dangerBoxes(cornerSign(c))) {
        for (const b of dangerBoxes(sideSign(s))) {
          assert.ok(!overlaps(a, b), `${c} runs into the ${s} strip`);
          smallest = Math.min(smallest, gap(a, b));
        }
      }
    }
  }
  assert.ok(smallest > 0, `the closest a corner sign comes to a strip is ${smallest}`);
});

test('every box of every sign is inside the field and out of both bands', () => {
  for (const sign of [...CORNERS.map(cornerSign), ...SIDES.map(sideSign)]) {
    for (const b of dangerBoxes(sign)) {
      assert.ok(b.x >= 0 && b.x + b.w <= W, `${JSON.stringify(sign)}: x ${b.x}..${b.x + b.w}`);
      assert.ok(b.y > HUD_BOTTOM, `${JSON.stringify(sign)}: y ${b.y} under the HUD`);
      assert.ok(b.y + b.h < BUTTONS_TOP, `${JSON.stringify(sign)}: y ${b.y + b.h} on the buttons`);
    }
  }
});

test('a glyph box is the widest advance of the face on its cap height', () => {
  assert.equal(DANGER_MAX_ADVANCE, DANGER_SIZE * 0.625);
  for (const b of dangerBoxes(cornerSign('tl'))) assert.equal(b.h, CAP);
});

test('the four corner signs are each other mirror images', () => {
  const boxes = (c) => dangerBoxes(cornerSign(c)).map((b) => `${b.x},${b.y},${b.w},${b.h}`).sort();
  const mirrorX = (c) => dangerBoxes(cornerSign(c)).map((b) => `${W - b.x - b.w},${b.y},${b.w},${b.h}`).sort();
  const mirrorY = (c) => dangerBoxes(cornerSign(c)).map((b) => `${b.x},${H - b.y - b.h},${b.w},${b.h}`).sort();
  assert.deepEqual(mirrorX('tl'), boxes('tr'));
  assert.deepEqual(mirrorX('bl'), boxes('br'));
  assert.deepEqual(mirrorY('tl'), boxes('bl'));
  assert.deepEqual(mirrorY('tr'), boxes('br'));
});
