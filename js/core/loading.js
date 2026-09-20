// When the loading screen is up and how far along it is.
//
// Starting the game keeps the player waiting twice, and on a cold cache both waits are
// visible:
//
//   1. the manifest's sprite frames are fetched — countable, one frame at a time, so the
//      bar is driven by what has really arrived;
//   2. the title artwork is downloaded, sliced and its first keyframe rasterised. There is
//      nothing to count there, only "not yet" and "on screen", so the bar holds where the
//      first phase left it and the screen's own blink says the game is still working.
//
// Nothing here is ever driven by a timer pretending to be progress. The one thing the clock
// decides is when to stop waiting: the artwork is decoration, the menu works without it, so
// after `TITLE_TIMEOUT_MS` the player gets the menu on its flat backdrop rather than a
// loading screen that might never end.

/** How much of the bar the sprite phase owns; the title phase owns the rest. */
export const ASSET_SHARE = 0.6;

/**
 * How long the title artwork may keep the menu waiting once the sprites are in. Generous:
 * preparing the first keyframe takes well under a second on a warm connection, and the file
 * is 2.2 MB, so this is only ever reached by a connection that is barely there.
 */
export const TITLE_TIMEOUT_MS = 8000;

/** How many cells the bar is drawn as. */
export const BAR_CELLS = 20;

const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));

/**
 * loadingState({ assetsDone, assetsTotal, titleReady, titleFailed, msSinceAssets })
 *   -> { show, progress }
 *
 * `msSinceAssets` is null while the sprites are still loading and the milliseconds since
 * they finished afterwards — the caller is the only one who knows which phase it is in.
 *
 * `progress` never goes backwards over a boot and only reaches 1 together with `show`
 * turning false, so a full bar always means the menu is about to be on screen.
 */
export function loadingState({
  assetsDone = 0, assetsTotal = 0, titleReady = false, titleFailed = false, msSinceAssets = null,
} = {}) {
  // `null` is the sprite phase, not "zero milliseconds ago", so it is ruled out by hand.
  const elapsed = msSinceAssets === null || msSinceAssets === undefined ? Number.NaN : Number(msSinceAssets);
  if (!Number.isFinite(elapsed)) {
    const total = Math.max(0, Math.floor(assetsTotal) || 0);
    const done = Math.min(Math.max(0, Math.floor(assetsDone) || 0), total);
    return { show: true, progress: total > 0 ? ASSET_SHARE * (done / total) : 0 };
  }
  // The artwork is on screen, will never be, or has had its chance: either way the menu is
  // usable and nothing is gained by holding it back.
  if (titleReady || titleFailed || elapsed >= TITLE_TIMEOUT_MS) return { show: false, progress: 1 };
  return { show: true, progress: ASSET_SHARE };
}

/**
 * How many cells of the bar are full at `progress`. Floored, so the last cell lights up
 * only when the bar is genuinely full and never a fraction of a frame early.
 */
export function filledCells(progress, cells = BAR_CELLS) {
  const n = Math.max(1, Math.floor(cells) || 1);
  const p = Number(progress);
  return Math.floor(clamp01(Number.isFinite(p) ? p : 0) * n);
}
