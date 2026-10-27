import { ALL_LEVELS } from '../src/core/levels';
import { createGame } from '../src/core/rules';
import { playOut } from './bot';

// Garden basics must be easy for the bot. Weed levels expect the player to think, and the bot
// does not, so their bar is lower. Prototype C replaces this with a look-ahead solver.
const BAR: Record<string, number> = { b: 0.5 };

describe('level solvability (simple bot)', () => {
  for (const level of ALL_LEVELS) {
    it(`${level.name} is usually winnable`, () => {
      let wins = 0;
      const seeds = 60;
      for (let seed = 1; seed <= seeds; seed++) if (playOut(createGame(level, seed)).status === 'won') wins++;
      expect(wins / seeds).toBeGreaterThanOrEqual(BAR[level.id[0]] ?? 0.8);
    });
  }
});
