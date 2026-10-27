# Frenzie Garden Blast

A mobile puzzle game by Frenzie Fam Games: choose seeds, plant them on an 8×8 garden, grow them into botanical patterns, and protect the garden from invasive weeds.

The design lives in the Game Design Document v1.0 (Claude Doc). This repository currently holds **Prototype A: the core puzzle** (no weeds, tools, coins, cards or lives yet).

## Run it

```bash
npm install
npm run dev      # play in a browser at the printed address; use phone-size or device emulation
npm test         # rules engine and level checks
npm run build    # production build in dist/
```

Add `?seed=1234` to the address to replay an exact seed sequence. The seed and move number show at the bottom of the game screen.

## What Prototype A contains

- 8×8 board with blocked tiles for smaller early gardens.
- Three-seed conveyor: pick a slot, then tap soil. Unused seeds stay put. Compost discards the selected seed (limited charges, not a move).
- Growth exactly as approved: each successful planting grows every other immature plant one stage (seed → sprout → bloom); the new seed does not grow on its own move.
- Campaign blueprints (outlined slots) and free-form patterns (4+ matching flowers: line of 4 or 5, square, L, T, cross, ring). The biggest pattern wins when candidates overlap. Mature flowers never clear just by touching.
- Scoring with combo streaks, multi-pattern bonus and the Final Bloom bonus for unused moves; stars per level.
- Growth forecast: tiles that will bloom on your next planting pulse gold.
- Five test levels and a weed-free Endless Garden.

## Code layout

| Folder | What it is |
| --- | --- |
| `src/core` | Pure TypeScript rules engine: no Phaser, no DOM. `resolve(state, action)` returns the new state and a list of events. |
| `src/game` | Phaser scenes. They send actions to the engine and animate the returned events. |
| `tests` | Vitest tests for the rules, plus a bot that plays every level across 60 seeds. |

Art is placeholder, drawn in code at start-up; Prototype D replaces it.
