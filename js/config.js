export const W = 600, H = 450, STEP_MS = 1000 / 60;
export const PLAYER = { ACCEL: 0.5, MAX_SPEED: 6, FRICTION: 0.93, EMPTY_MAX_SPEED: 0.5, EMPTY_FRICTION: 0.99,
  HALF_W: 36, HALF_H: 35, HIT_R: 16 };           // HALF_* are half of the 72x70 ufo sprite (docs/assets-inventory.md)
export const FUEL = { MAX: 100, DRAIN: 0.05, MUFFIN: 10 };
export const SPEED = { h: 7, v: 5, d: 4 };
export const DIRECTOR = { ATTACK_FRAMES: 900, WARNING_FRAMES: 300, START_DIFFICULTY: 0.2, DIFFICULTY_STEP: 0.05,
  WAVE_INTERVAL_START: 60, WAVE_INTERVAL_MIN: 35, WAVE_INTERVAL_SHIFTS: 12,
  DOUBLE_FROM_SHIFT: 4, DOUBLE_MAX_CHANCE: 0.4, EVENT_MIN_GAP_SHIFTS: 3, EVENT_CHANCE: 0.25, EVENT_FRAMES: 540 };
export const SUGAR = { INTERVAL: 100, SPEED_MIN: 3, SPEED_MAX: 4, HIT_R: 12, SIZE: 24 };
export const ENEMY = { SIZE: 30, HIT_R: 13, BERRY_R: 5, BOSS_R: 60 };
export const COMBO = { CELLS: 4, FULL_BONUS: 500 };
export const NICK = { MIN: 3, MAX: 12, RE: /^[A-Za-z0-9А-Яа-яЁё_ -]+$/ };
export const SCORE_MAX = 9999999;
export const AUDIO_BASE_URL = 'assets/audio/';
export const FIREBASE_CONFIG = null; // filled in Task 13 with the value from the web console
