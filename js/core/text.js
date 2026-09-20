// Pixel-font text drawing. The face is declared in css/style.css as @font-face "PixelFont"
// (assets/fonts/pixel.ttf); monospace is the fallback if it fails to load.

export const FONT_FAMILY = "'PixelFont', monospace";

// The face has asymmetric vertical metrics, so "middle" is not the middle of its em box.
// Measured from assets/fonts/pixel.ttf (unitsPerEm 1024, hhea ascender 683, descender -256):
// every digit and every capital except Q spans yMin 0 .. yMax 640, i.e. the cap box is
// 640/1024 = 0.625 em tall and sits entirely above the baseline.
// Only a fallback: `valign: 'center'` uses the ink box the canvas reports whenever it can.
export const CAP_HEIGHT_RATIO = 0.625;

// Asks the browser to load the face before the first render. Resolves to true when the
// pixel font is available, false when we are falling back to monospace.
export async function ensurePixelFont(size = 20) {
  try {
    if (!document.fonts) return false;
    await document.fonts.load(`${size}px PixelFont`);
    await document.fonts.ready;
    return document.fonts.check(`${size}px PixelFont`);
  } catch (err) {
    console.warn('text: the pixel font failed to load, falling back to monospace:', err);
    return false;
  }
}

/**
 * The baseline that puts the vertical centre of a glyph box — `ascent` above the baseline,
 * `descent` below it — exactly on `y`. Pure, and rounded to a whole logical pixel so a
 * value that moves by fractions of a pixel cannot make the text shimmer between frames.
 */
export function baselineForCenter(y, ascent, descent) {
  return Math.round(y + (ascent - descent) / 2);
}

// The ink box of `str` in the font already set on `ctx`. Canvas implementations that do not
// report actualBoundingBox* (older Safari) fall back to the font's measured cap box, which
// is exact for digits and capitals and ignores descenders otherwise.
function glyphBox(ctx, str, size) {
  const m = ctx.measureText(str);
  const ascent = m ? m.actualBoundingBoxAscent : undefined;
  const descent = m ? m.actualBoundingBoxDescent : undefined;
  if (Number.isFinite(ascent) && Number.isFinite(descent)) return { ascent, descent };
  return { ascent: size * CAP_HEIGHT_RATIO, descent: 0 };
}

/**
 * Draws `str` at (x, y). `valign` selects what `y` means vertically:
 *   'alphabetic' (default) — y is the baseline, exactly as `baseline` says;
 *   'center'               — y is the vertical centre of the text's actual glyph box,
 *                            which is what you want inside a frame or a capsule.
 * 'center' always draws from the alphabetic baseline, because that is what the measured
 * ascent and descent are relative to.
 */
export function drawText(ctx, str, x, y, {
  size = 20, align = 'left', color = '#fff', baseline = 'alphabetic', valign = 'alphabetic',
} = {}) {
  const s = String(str);
  const centred = valign === 'center';
  ctx.save();
  ctx.font = `${size}px ${FONT_FAMILY}`;
  ctx.textAlign = align;
  ctx.textBaseline = centred ? 'alphabetic' : baseline;
  ctx.fillStyle = color;
  let drawY = y;
  if (centred) {
    const box = glyphBox(ctx, s, size);
    drawY = baselineForCenter(y, box.ascent, box.descent);
  }
  ctx.fillText(s, Math.round(x), Math.round(drawY));
  ctx.restore();
}

export function measureText(ctx, str, size = 20) {
  ctx.save();
  ctx.font = `${size}px ${FONT_FAMILY}`;
  const w = ctx.measureText(String(str)).width;
  ctx.restore();
  return w;
}
