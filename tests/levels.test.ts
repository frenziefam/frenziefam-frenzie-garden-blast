// A simple bot plays every Prototype A level across many seeds. It is far weaker than the
// look-ahead solver planned for Prototype C (GDD E3), so a high win rate here means the
// levels are comfortably solvable, not that they are tuned.

import { LEVELS } from '../src/core/levels';
import { createGame, resolve } from '../src/core/rules';
import { Cell, GameState, Species } from '../src/core/types';

function empty(state: GameState): Cell[] {
  const out: Cell[] = [];
  state.tiles.forEach((row, r) => row.forEach((t, c) => !t.blocked && !t.plant && out.push({ r, c })));
  return out;
}

/** Each species gets its own free row for building free-form lines of 4. */
function lineSpot(state: GameState, species: Species): Cell | null {
  const rows: Partial<Record<Species, number>> = { daisy: 5, rose: 6, tulip: 7, sunflower: 4, lily: 4 };
  const r = rows[species];
  if (r === undefined) return null;
  for (const c of [0, 1, 3, 2, 4, 5, 7, 6]) {
    const t = state.tiles[r][c];
    if (!t.blocked && !t.plant && !t.slot) return { r, c };
  }
  return null;
}

function botMove(state: GameState) {
  // 1. Fill a blueprint slot with the right species if the conveyor has it.
  for (let i = 0; i < 3; i++) {
    const sp = state.conveyor[i];
    for (const bp of state.level.blueprints) {
      const cell = bp.cells.find((c) => c.species === sp && !state.tiles[c.r][c.c].plant);
      if (cell) return { type: 'plant' as const, slot: i, r: cell.r, c: cell.c };
    }
  }
  // 2. Otherwise plant away from blueprint slots: build lines on free-form levels.
  const spots = empty(state).filter((c) => !state.tiles[c.r][c.c].slot);
  for (let i = 0; i < 3; i++) {
    const sp = state.conveyor[i];
    const needed = state.level.blueprints.some((bp) => bp.cells.some((c) => c.species === sp && !state.tiles[c.r][c.c].plant));
    if (needed) continue;
    if (state.level.freeform) {
      const spot = lineSpot(state, sp);
      if (spot) return { type: 'plant' as const, slot: i, ...spot };
    }
    if (spots.length) return { type: 'plant' as const, slot: i, ...spots[0] };
  }
  if (state.compostLeft > 0) return { type: 'compost' as const, slot: 0 };
  const any = spots[0] ?? empty(state)[0];
  return { type: 'plant' as const, slot: 0, r: any.r, c: any.c };
}

describe('level solvability (simple bot)', () => {
  for (const level of LEVELS) {
    it(`${level.name} is usually winnable`, () => {
      let wins = 0;
      const seeds = 60;
      for (let seed = 1; seed <= seeds; seed++) {
        let s = createGame(level, seed);
        for (let guard = 0; guard < 200 && s.status === 'playing'; guard++) s = resolve(s, botMove(s)).state;
        if (s.status === 'won') wins++;
      }
      expect(wins / seeds).toBeGreaterThanOrEqual(0.8);
    });
  }
});
