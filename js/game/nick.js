// Nickname validation for the leaderboard. Pure, no DOM — the same rules run in the
// browser and in `tests/nick.test.js`. The character class and the length limits live in
// js/config.js (NICK) so the Firestore rules of Task 13 can mirror one source.
import { NICK } from '../config.js';

/**
 * validateNick(raw) -> { ok: true, value } | { ok: false, error: 'short'|'long'|'chars' }
 *
 * The raw text is trimmed and its runs of whitespace are collapsed to single spaces
 * first, so "  Lein  " and "a  b" are accepted as "Lein" and "a b". The length is then
 * judged on the collapsed value, not on what was typed.
 */
export function validateNick(raw) {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (value.length < NICK.MIN) return { ok: false, error: 'short' };
  if (value.length > NICK.MAX) return { ok: false, error: 'long' };
  if (!NICK.RE.test(value)) return { ok: false, error: 'chars' };
  return { ok: true, value };
}
