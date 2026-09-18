// Pixel-font text drawing. The face is declared in css/style.css as @font-face "PixelFont"
// (assets/fonts/pixel.ttf); monospace is the fallback if it fails to load.

export const FONT_FAMILY = "'PixelFont', monospace";

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

export function drawText(ctx, str, x, y, { size = 20, align = 'left', color = '#fff', baseline = 'alphabetic' } = {}) {
  ctx.save();
  ctx.font = `${size}px ${FONT_FAMILY}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillStyle = color;
  ctx.fillText(String(str), Math.round(x), Math.round(y));
  ctx.restore();
}

export function measureText(ctx, str, size = 20) {
  ctx.save();
  ctx.font = `${size}px ${FONT_FAMILY}`;
  const w = ctx.measureText(String(str)).width;
  ctx.restore();
  return w;
}
