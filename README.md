# Fruit Madness Remastered

*A panda in a UFO, an endless swarm of very angry fruit, and one muffin between you and an empty tank.*

**[▶ Play now](https://leinstay.github.io/fruit-madness-remastered/)** — no install, no plugins, runs in any modern browser.

![Fruit Madness Remastered gameplay](assets/readme/gameplay.webp)

![License: MIT](https://img.shields.io/badge/license-MIT-blue) ![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)

## About

Fruit Madness is an endless arcade dodge-'em-up. You fly a small flying saucer across a 600×450 pixel
starfield while waves of fruit charge in from every side; your only job is to slip through the gaps and
keep collecting the muffins that refuel you. Pixel art, chiptune and a fixed 60 Hz step — the whole thing
is built in the spirit of NES-era arcade games.

The original *Fruit Madness* was a Flash game we made in 2013
([leinstay/fruitmadness](https://github.com/leinstay/fruitmadness), ActionScript 3). Flash is gone, so this
is a from-scratch HTML5 remaster: the same physics constants, the same artwork and the same music, rewritten
in plain JavaScript with no plugin, no build step and no dependencies. The playfield is drawn from the
original vector artwork at whatever resolution your display really has, and every caption is set in the
game's own pixel font, so the game stays sharp in any window.

![The title screen](assets/readme/title.webp)

## How to play

- **Move** — `W` `A` `S` `D` or the arrow keys. On a phone or tablet, touch anywhere on the field: a floating
  joystick appears under your thumb and steers exactly like the keys do.
- **Pause** — `P` or `Esc`, or the on-screen `PAUSE` button.
- **Fuel.** The tank holds 100 units and drains by 0.05 per frame — about 33 seconds of flight. Every muffin
  gives back 10. Run dry and the saucer does not die, it crawls: top speed drops from 6 to 0.5 px per frame
  and you are a sitting duck.
- **Combo.** Every muffin lights one of the four cells of the combo bar, and every lit cell raises the score
  multiplier (up to ×5). A muffin is worth 100 points times the multiplier it has just raised — 200 for the
  first one, 500 on a full bar. The bar does not last: cells burn down one at a time from the right, four
  seconds each, so keep the muffins coming. Missing one costs you nothing but the fuel.

## Run locally

```bash
git clone https://github.com/leinstay/fruit-madness-remastered.git
cd fruit-madness-remastered
python -m http.server 8080
```

Then open <http://localhost:8080>. A server is required because the game is made of ES modules, which
browsers refuse to load over `file://`.

### Tests

```bash
node --test tests/          # 255 tests, about two minutes
```

The long survivability proof is opt-in, because it is slow:

```bash
SOLVER_SEEDS=100 SOLVER_FRAMES=3600 node --test tests/solvability.test.js
```

`SOLVER_SEEDS` is how many worlds to check (12 by default) and `SOLVER_FRAMES` how many frames of each
(3600 = one minute of play).

## Project structure

```
index.html          the page: a canvas and the nickname field
css/                the page shell and the mobile layout
js/
  main.js           entry point and scene switching
  config.js         constants of the original, tuned in 2013
  core/             loop, input, audio, asset loading, seeded rng, sprite animation
  game/             player, enemies, formations, director, collisions, combo (pure logic)
  scenes/           menu, game, game over, leaderboard
  services/         the Firestore leaderboard client
assets/             the vector artwork, the pixel font, music and sound effects
tests/              node --test suites, including the survivability simulator
tools/              make-svg-sprites.mjs prepares the gameplay drawings, make-title.py
                    builds the title screen, and xfl2svg.py converts drawings from the
                    original 2013 Flash source document to SVG
firestore.rules     the leaderboard security rules
```
