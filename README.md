# INNBC STARFIGHTER

**A high-performance JavaScript game engine developed for INNBC STARFIGHTER — a shoot ’em up shipped on Steam, packaged with Electron, integrated with Steam APIs, and built for responsive arcade gameplay. Developed by Jonathan Fior, published by Innovative Bioresearch**

This repository is public because I want studios, publishers, and technical teams to be able to inspect the architecture and code quality directly.

The core idea behind this project is simple:

**You should be able to build and ship a serious desktop action game in JavaScript without having to move your core gameplay codebase to C++.**

This engine combines a JavaScript gameplay layer, an Electron desktop runtime, Steam achievements, Steam matchmaking, Steam P2P networking, full gamepad support, and a custom in-game multiplayer UI for lobby creation and joining.

---

## Why this engine matters

A lot of developers love JavaScript because it is fast to iterate in, easy to read, and productive for solo development. The usual concern is performance.

For arcade games, especially fast 2D shooters, the biggest problem is not “JavaScript is too slow” in the abstract. The real problem is usually **runtime allocation pressure, repeated asset work during gameplay, and the garbage collection spikes that follow**.

I designed this engine around that constraint.

Instead of treating asset preparation as something that happens opportunistically during gameplay, I built a **warm-up and render-ready caching pipeline** that prepares assets up front and keeps them ready for rendering. That means the engine is not constantly doing expensive decode, resize, and conversion work in the middle of a firefight.

The result is an engine designed for **stable 60 FPS+ gameplay**, with substantially more headroom on stronger hardware.

---

## Technical strengths

### 1. Asset warm-up and render-ready caching

The engine includes a dedicated `AssetsLoading` pipeline that:

- Preloads and decodes DOM image assets before gameplay
- Uses `OffscreenCanvas` when available, with a canvas fallback when it is not
- Converts assets into render-ready cached bitmap sources
- Pre-scales sprite sheets, particles, static props, and large background images up front
- Stores sprite-sheet sampling metadata so rendering code does not have to recompute crop and stride details at runtime
- Avoids unnecessary duplication by skipping raw bitmap caching when a scaled cache is already the intended runtime source

This is one of the most important parts of the engine because it treats JavaScript game rendering more like an old console pipeline:

- prepare early
- reuse aggressively
- keep runtime work predictable

That design is what makes JavaScript viable here for fast arcade gameplay.

---

### 2. Multiplayer built for arcade shooters, pixel precision gameplay

This engine does not stop at local play. It includes a fully integrated multiplayer stack using Steam matchmaking and Steam P2P networking.

The architecture is designed for a very specific problem:

**fast old-school shoot 'em up gameplay with lots of active objects, tight collision timing, and a presentation style where jerky movement or frequent correction is immediately visible**.

Instead of taking the simplest route and just rendering entities at raw packet positions, the multiplayer layer uses a **hybrid authority model**:

- The **host owns the shared game state** for the match-critical world simulation, including enemy motion, score, ammo, shield state, timer, win/loss state, and authoritative snapshot generation
- The **client renders from authoritative snapshots** rather than deciding match outcomes locally
- The **client keeps local visual projectile maps** and advances them with local delta-time stepping between host updates so projectile motion stays fluid
- Gameplay-relevant moments such as hits, state changes, and special effects are mirrored with **explicit compact binary opcodes** rather than relying only on broad snapshots
- Snapshot processing is monotonic, so outdated duplicate states are ignored

For this game, that tradeoff matters. In a dense shooter, visible corrections and hard snapping are much more damaging to feel than they would be in many slower genres.

This engine is therefore not just “multiplayer enabled.” It is **multiplayer designed around the needs of precision arcade gameplay**.

---

### 3. Deep Steam integration

The project is not using Steam as an afterthought.

It integrates Steam features directly into the desktop game loop and UI, including:

- Steam achievements
- Steam lobby creation
- Steam lobby discovery
- Steam lobby joining and leaving
- Friendly lobby naming
- Steam P2P packet transport
- Explicit session open/close handling
- In-game multiplayer flow connected to the Steam layer instead of a separate launcher or debug-only menu

The Steam module used here is also based on a **customized Steamworks.js-derived binding** that I extended for my own logging and integration needs.

---

### 4. Full gamepad support with rebinding

The engine includes direct gamepad support through the browser Gamepad API inside the Electron runtime, with:

- controller connection and disconnection detection
- polling-based gameplay input
- menu navigation support
- analog and D-pad edge handling
- rebinding support
- conflict detection for bindings
- separate handling for gameplay input vs. binding capture

That means the project is not “keyboard-first with controller added later.” It is built to behave like a real desktop action game.

---

### 5. JavaScript-first desktop game development

This engine is especially valuable for developers who:

- are highly productive in JavaScript
- want to build desktop games without rewriting their gameplay systems in C++
- want an inspectable codebase with extensive commenting they can learn from
- want Steam features and multiplayer already solved inside a real shipped project

In other words, this is not just a game.

It is a **working reference architecture for shipping action games in JavaScript**.

---

### 6. Setup and development

To run the project locally, install the dependencies and start the Electron development build:

```bash
npm install
npm start
```

This launches the game through **Electron Forge** using the entry point defined in `src/index.js`.

## Build and Packaging

To create a packaged version of the game:

```bash
npm run package
```

To generate distributable build artifacts:

```bash
npm run make
```

## Available Scripts

- `npm start` — run the game locally in development mode
- `npm run package` — package the Electron application
- `npm run make` — generate distributable builds

## Requirements and Notes

- Built with **Electron** and **Electron Forge**
- Main Electron entry point: `src/index.js`
- Uses a customized `steamworkswinx64-withlogs` module for Steam integration
- `package.json` is currently marked as `UNLICENSED`, while the repository itself is distributed under the custom source-available commercial terms described in `LICENSE.md`
- Steam functionality may require the correct native module setup and Steam runtime environment depending on the target system

---

## Architecture overview

### Runtime

- JavaScript gameplay code
- HTML5 Canvas rendering
- Electron desktop packaging
- Steam integration through a customized Steamworks.js-derived module

### Engine systems

- asset warm-up and bitmap caching
- sprite-sheet metadata caching
- delta-time gameplay updates
- Steam achievements
- Steam matchmaking and lobbies
- binary P2P networking
- custom multiplayer UI
- keyboard + gamepad input stack
- fullscreen state synchronization through Electron IPC

---

## What makes this codebase useful to other developers

If you are a developer or studio evaluating this repository, the value is not only the finished game.

The value is that the hard parts are already solved in a real project:

- how to structure a JavaScript/Electron action game for performance
- how to warm and cache assets for stable runtime behavior
- how to integrate Steam APIs directly into an Electron application
- how to build a custom in-game lobby flow instead of relying on mock menus
- how to approach multiplayer for a fast shooter without settling for obvious stutter
- how to support gamepads properly in a desktop-focused JavaScript game

This can save a team a substantial amount of time compared with building the same stack from scratch.

---

## 7. Repository purpose

This repository is public for **portfolio, technical review, and evaluation**.

It exists so companies can inspect the code and see the engineering quality directly.

It is **not open source**.

See the license section below.

---

## License

This repository is **source-available** but **not open source**.

That means:

- the source is visible for review
- the source is **not** open source
- copying, reuse, modification, redistribution, or commercial use is **not allowed** unless separately authorized
- companies interested in using the engine should contact the author for a **commercial license agreement**

If you want to allow noncommercial tinkering, research, and hobby experimentation, you can instead use a noncommercial source-available license.

If you want all reuse restricted unless you personally approve it, use a custom proprietary license.

---

## Commercial licensing

For commercial licensing, engine licensing, collaboration, or technical consulting, contact:

**[administrator@innovativebioresearch.com]**

---

## Final note

This project demonstrates that JavaScript can be used for more than casual browser prototypes.

With the right architecture, careful asset handling, and a disciplined runtime model, it can power a real desktop action game with Steam integration, multiplayer, and controller support.

That is what this engine was built to prove.
