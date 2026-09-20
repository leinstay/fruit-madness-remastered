// tests/captions.test.js — the pure parts of the runtime captions: the DANGER fade and
// the layout of the four straight strips and the four corner signs. The drawing itself
// needs a canvas and is not tested here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { W, H } from '../js/config.js';
import {
  dangerAlpha, dangerStackGlyphs, dangerBarBox, dangerCornerGlyphs,
  DANGER_TEXT, DANGER_CORNER_TEXT, DANGER_SIZE, DANGER_FADE_PERIOD, DANGER_LAYOUT,
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

test('a corner sign reads DANGER through its corner, eight glyphs an arm', () => {
  for (const c of CORNERS) {
    const glyphs = dangerCornerGlyphs(c);
    assert.equal(glyphs.length, 16, `${c}: two arms of eight`);
    assert.equal(glyphs.map((g) => g.ch).join(''), DANGER_CORNER_TEXT, `${c}: reading order`);
  }
});

test('at a left corner the DAN arm is vertical, at a right corner it is horizontal', () => {
  const corner = DANGER_LAYOUT.corner;
  for (const c of CORNERS) {
    const glyphs = dangerCornerGlyphs(c);
    const into = glyphs.slice(0, 8);      // '**** DAN', reading into the corner
    const outOf = glyphs.slice(8);        // 'GER ****', leaving the corner
    const left = c === 'tl' || c === 'bl';
    const vertical = (arm) => arm.every((g) => g.x === corner[c].x);
    const horizontal = (arm) => arm.every((g) => g.y === corner[c].y);
    assert.ok(left ? vertical(into) : horizontal(into), `${c}: the DAN arm`);
    assert.ok(left ? horizontal(outOf) : vertical(outOf), `${c}: the GER arm`);
    // The N ends the first arm right next to the corner, the G starts the other one there.
    const pitch = DANGER_LAYOUT.armPitch;
    const dist = (g) => Math.abs(g.x - corner[c].x) + Math.abs(g.y - corner[c].y);
    assert.equal(into[7].ch, 'N');
    assert.equal(dist(into[7]), pitch, `${c}: the N sits one cell from the corner`);
    assert.equal(outOf[0].ch, 'G');
    assert.equal(dist(outOf[0]), pitch, `${c}: the G sits one cell from the corner`);
  }
});

test('horizontal arms always read left to right, vertical ones towards the corner', () => {
  // tl: the vertical arm reads upwards into the corner, the horizontal one leaves it right.
  const tl = dangerCornerGlyphs('tl');
  assert.deepEqual(tl[7], { ch: 'N', x: 45, y: 100 });
  assert.deepEqual(tl[8], { ch: 'G', x: 60, y: 85 });
  assert.ok(tl[0].y > tl[7].y, 'tl: the marks hang below the word');
  assert.ok(tl[15].x > tl[8].x, 'tl: the second arm runs to the right');
  // bl: the vertical arm reads downwards into the corner.
  const bl = dangerCornerGlyphs('bl');
  assert.deepEqual(bl[7], { ch: 'N', x: 45, y: 350 });
  assert.deepEqual(bl[8], { ch: 'G', x: 60, y: 365 });
  assert.ok(bl[0].y < bl[7].y, 'bl: the marks sit above the word');
  assert.ok(bl[15].x > bl[8].x, 'bl: the second arm runs to the right');
  // tr: the horizontal arm ends at the corner, the vertical one leaves it downwards.
  const tr = dangerCornerGlyphs('tr');
  assert.deepEqual(tr[7], { ch: 'N', x: 540, y: 85 });
  assert.deepEqual(tr[8], { ch: 'G', x: 555, y: 100 });
  assert.ok(tr[0].x < tr[7].x, 'tr: the first arm reads left to right');
  assert.ok(tr[15].y > tr[8].y, 'tr: the second arm runs downwards');
  // br: the horizontal arm ends at the corner, the vertical one leaves it upwards.
  const br = dangerCornerGlyphs('br');
  assert.deepEqual(br[7], { ch: 'N', x: 540, y: 365 });
  assert.deepEqual(br[8], { ch: 'G', x: 555, y: 350 });
  assert.ok(br[0].x < br[7].x, 'br: the first arm reads left to right');
  assert.ok(br[15].y < br[8].y, 'br: the second arm runs upwards');
});

test('both arms of a corner sign share one pitch and leave the corner cell empty', () => {
  const corner = DANGER_LAYOUT.corner;
  const pitch = DANGER_LAYOUT.armPitch;
  assert.ok(pitch >= 14 && pitch <= 16, `the arm pitch is ${pitch}`);
  for (const c of CORNERS) {
    const glyphs = dangerCornerGlyphs(c);
    const step = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    for (let i = 1; i < 8; i++) assert.equal(step(glyphs[i - 1], glyphs[i]), pitch, `${c}: DAN arm cell ${i}`);
    for (let i = 9; i < 16; i++) assert.equal(step(glyphs[i - 1], glyphs[i]), pitch, `${c}: GER arm cell ${i}`);
    // Nothing sits on the corner itself, and no two glyphs share a cell.
    const seen = new Set();
    for (const g of glyphs) {
      const key = `${g.x},${g.y}`;
      assert.ok(!seen.has(key), `${c}: two glyphs on ${key}`);
      seen.add(key);
      assert.ok(g.x !== corner[c].x || g.y !== corner[c].y, `${c}: a glyph on the corner cell`);
    }
    // An arm is 90-110 px of lettering, corner cell aside.
    const span = 7 * pitch;
    assert.ok(span >= 90 && span <= 110, `${c}: arm span ${span}`);
  }
});

test('the four corner signs are each other mirror images', () => {
  const cells = (c) => dangerCornerGlyphs(c).map((g) => `${g.x},${g.y}`).sort();
  const mirrorX = (c) => dangerCornerGlyphs(c).map((g) => `${W - g.x},${g.y}`).sort();
  const mirrorY = (c) => dangerCornerGlyphs(c).map((g) => `${g.x},${H - g.y}`).sort();
  assert.deepEqual(mirrorX('tl'), cells('tr'));
  assert.deepEqual(mirrorX('bl'), cells('br'));
  assert.deepEqual(mirrorY('tl'), cells('bl'));
  assert.deepEqual(mirrorY('tr'), cells('br'));
});

test('every glyph of a corner sign is inside the field and out of both bands', () => {
  for (const c of CORNERS) {
    for (const g of dangerCornerGlyphs(c)) {
      assert.ok(g.x - CAP / 2 > 0 && g.x + CAP / 2 < W, `${c}: x ${g.x}`);
      assert.ok(g.y - CAP / 2 > HUD_BOTTOM, `${c}: y ${g.y} under the HUD`);
      assert.ok(g.y + CAP / 2 < BUTTONS_TOP, `${c}: y ${g.y} on the buttons`);
    }
  }
});
