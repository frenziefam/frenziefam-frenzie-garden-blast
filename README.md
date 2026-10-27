# Frenzie Garden Blast

A mobile puzzle game by Frenzie Fam Games: choose seeds, plant them on an 8×8 garden, grow them into botanical patterns, and protect the garden from invasive weeds.

The design lives in the Game Design Document v1.0 (Claude Doc). This repository holds **Prototype A: the core puzzle** and **Prototype B: weeds and tools**. Coins, cards, lives and the save system arrive in Prototype C.

## Run it

```bash
npm install
npm run dev      # play in a browser at the printed address; use phone-size or device emulation
npm test         # rules engine and level checks
npm run build    # production build in dist/
```

Add `?seed=1234` to the address to replay an exact seed sequence, and `?level=b3` (or `?level=endless`) to open a level directly. The seed and move number show at the bottom of the game screen.

## What Prototype A contains

- 8×8 board with blocked tiles for smaller early gardens.
- Three-seed conveyor: pick a slot, then tap soil. Unused seeds stay put. Compost discards the selected seed (limited charges, not a move).
- Growth exactly as approved: each successful planting grows every other immature plant one stage (seed → sprout → bloom); the new seed does not grow on its own move.
- Campaign blueprints (outlined slots) and free-form patterns (4+ matching flowers: line of 4 or 5, square, L, T, cross, ring). The biggest pattern wins when candidates overlap. Mature flowers never clear just by touching.
- Scoring with combo streaks, multi-pattern bonus and the Final Bloom bonus for unused moves; stars per level.
- Growth forecast: tiles that will bloom on your next planting pulse gold.
- Five test levels and a weed-free Endless Garden.

## What Prototype B adds

- **Creeping weeds** (green vines) spread one tile per group every few plantings. **Aggressive weeds** (red thorns) spread on a real-time timer that starts after the first planting and stops while paused or animating. A dashed tile shows where each group spreads next.
- **Choking:** a weed that reaches a plant infests it. The plant keeps growing (approved rule), and the red badge counts the plantings left before it is choked and turns into a weed.
- **Bloom Burst defence:** a burst clears weeds and cures infested plants on the tiles beside the pattern, plus diagonals for 5+ flowers. Cleared weeds score 10, saved flowers 50.
- **Root Nests** spawn a creeping weed every few plantings. Bursts beside them deal 1 damage (2 for 5+ flowers); Controlled Burn deals 1.
- **Tools** (none of them grow plants or use a move): Pull Weeds (one tile), Weed Spray (3×3, blocks spread there for 2 plantings), Controlled Burn (a row or column, destroys plants too, with a warning before you confirm). Tap a tool, tap a target to preview, then tap again or press Use.
- **Out of space:** if the board is full but a tool could clear space, the game prompts you instead of ending.
- Eight weed levels (6–13), one new idea each, and Endless now spawns weeds from move 10 and earns run-only tools from bursts.
- Pause hides the board and stops the weed timer.

## Code layout

| Folder | What it is |
| --- | --- |
| `src/core` | Pure TypeScript rules engine: no Phaser, no DOM. `resolve(state, action)` returns the new state and a list of events. |
| `src/game` | Phaser scenes. They send actions to the engine and animate the returned events. |
| `tests` | Vitest tests for the rules and weeds, plus a heuristic bot (`tests/bot.ts`) that plays every level across 60 seeds. |

Art is placeholder, drawn in code at start-up; Prototype D replaces it.
