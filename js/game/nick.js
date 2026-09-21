// Nickname validation for the leaderboard. Pure, no DOM — the same rules run in the
// browser and in `tests/nick.test.js`. The character class and the length limits live in
// js/config.js (NICK) so the Firestore rules of Task 13 can mirror one source.
import { NICK } from '../config.js';

/**
 * validateNick(raw) -> { ok: true, value } | { ok: false, error: 'short'|'long'|'chars' }
 *
 * The raw text is only trimmed — inner whitespace is not collapsed, because a space is
 * itself an invalid character under the 3-6 ASCII letters/digits rule. The length is
 * judged on the trimmed value, before the character class, so "a_b_c_d" reads as 'long'.
 *
 * An accepted nickname is returned in capitals, the way an arcade cabinet spells a high
 * score, and that is the form that is stored and displayed. `toUpperCase` is the
 * locale-independent mapping (never `toLocaleUpperCase`, which would turn a Turkish 'i'
 * into a dotted capital), and it runs only *after* the checks have passed: by then the
 * value is plain [A-Za-z0-9], where casing is a one-to-one ASCII map that cannot change
 * the length. Upper-casing first would let 'ss' grow out of a 'ß' and sneak past the limit.
 */
export function validateNick(raw) {
  const value = String(raw ?? '').trim();
  if (value.length < NICK.MIN) return { ok: false, error: 'short' };
  if (value.length > NICK.MAX) return { ok: false, error: 'long' };
  if (!NICK.RE.test(value)) return { ok: false, error: 'chars' };
  return { ok: true, value: value.toUpperCase() };
}
