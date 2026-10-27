# Frenzie Garden Blast: working notes

- Game rules live only in `src/core` and must stay free of Phaser and DOM imports, so they can be unit tested and replayed.
- `resolve()` must stay pure and deterministic: same state + action = same result. All randomness goes through the seeded RNG in `src/core/rng.ts`.
- Growth and turn order are owner-approved rules (GDD section C); do not change them without Frenzie's approval.
- Run `npm test` and `npm run build` before pushing.
