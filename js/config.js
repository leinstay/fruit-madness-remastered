export const W = 600, H = 450, STEP_MS = 1000 / 60;
export const PLAYER = { ACCEL: 0.5, MAX_SPEED: 6, FRICTION: 0.93, EMPTY_MAX_SPEED: 0.5, EMPTY_FRICTION: 0.99,
  HALF_W: 36, HALF_H: 35, HIT_R: 16 };           // HALF_* are half of the 72x70 ufo sprite (docs/assets-inventory.md)
export const FUEL = { MAX: 100, DRAIN: 0.05, MUFFIN: 10 };
export const SPEED = { h: 7, v: 5, d: 4 };
export const DIRECTOR = { ATTACK_FRAMES: 900, WARNING_FRAMES: 300, START_DIFFICULTY: 0.2, DIFFICULTY_STEP: 0.05,
  WAVE_INTERVAL_START: 60, WAVE_INTERVAL_MIN: 35, WAVE_INTERVAL_SHIFTS: 12,
  DOUBLE_FROM_SHIFT: 2, DOUBLE_CHANCE_STEP: 0.4, DOUBLE_MAX_CHANCE: 0.8 };
export const SUGAR = { INTERVAL: 100, SPEED_MIN: 3, SPEED_MAX: 4, HIT_R: 12, SIZE: 24 };
export const ENEMY = { SIZE: 30, HIT_R: 13 };
export const COMBO = { CELLS: 4, CELL_FRAMES: 240, MUFFIN_POINTS: 100 };
export const NICK = { MIN: 3, MAX: 6, RE: /^[A-Za-z0-9]+$/ };   // mirrors ^[A-Za-z0-9]{3,6}$ in firestore.rules
export const SCORE_MAX = 9999999;
export const AUDIO_BASE_URL = 'assets/audio/';
// The public web config of the Firebase project `fruit-madness-52222` (owner: leinstay@gmail.com).
// A Firebase web config is public by nature — it ships inside every Firebase web app and grants
// nothing on its own; what a client may read or write is decided solely by firestore.rules.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAGEpbUurZBgzybDEVkqKri-i20_R4z8FA",
  authDomain: "fruit-madness-52222.firebaseapp.com",
  projectId: "fruit-madness-52222",
  storageBucket: "fruit-madness-52222.firebasestorage.app",
  messagingSenderId: "278926995710",
  appId: "1:278926995710:web:f38b0dc86449e2492e35af"
};

// The owner created the Firestore database under the id `fruit-madness` rather than the
// usual `(default)`, and the database id is not part of the web config — so it is named
// here. Set it to null if a `(default)` database is ever created and used instead.
export const FIRESTORE_DB_ID = 'fruit-madness';
