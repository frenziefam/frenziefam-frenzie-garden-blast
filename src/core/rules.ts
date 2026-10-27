// The rules engine. resolve(state, action) is pure: it never mutates its input and always gives the
// same result for the same state and action. The renderer animates from the returned events.
//
// Turn order follows Frenzie's approved order of operations (GDD C3). Weeds arrive in Prototype B,
// so step 8 is a no-op for now.

import { drawSeed } from './conveyor';
import { detectPatterns } from './patterns';
import { Action, BOARD_SIZE, GameEvent, GameState, LevelDef, MATURE, Stage, Tile } from './types';

export const FINAL_BLOOM_PER_MOVE = 100;
export const BIG_PATTERN_COINS = 15;

export function comboMultiplier(streak: number): number {
  if (streak <= 1) return 1;
  if (streak === 2) return 1.5;
  if (streak === 3) return 2;
  return 2.5;
}

function buildTiles(level: LevelDef): Tile[][] {
  const tiles: Tile[][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row: Tile[] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      const blocked = level.mask ? level.mask[r][c] === '#' : false;
      row.push({ blocked, plant: null, slot: null });
    }
    tiles.push(row);
  }
  for (const bp of level.blueprints) {
    for (const cell of bp.cells) {
      const tile = tiles[cell.r][cell.c];
      if (tile.blocked) throw new Error(`Blueprint ${bp.id} uses blocked tile ${cell.r},${cell.c}`);
      if (tile.slot) throw new Error(`Blueprints overlap at ${cell.r},${cell.c}`);
      tile.slot = { blueprintId: bp.id, species: cell.species };
    }
  }
  return tiles;
}

export function createGame(level: LevelDef, seed: number): GameState {
  const state: GameState = {
    level,
    seed: seed >>> 0,
    rng: seed >>> 0,
    tiles: buildTiles(level),
    conveyor: [],
    bag: [],
    scriptIndex: 0,
    draws: 0,
    lastDrawn: {},
    move: 0,
    movesLeft: level.moveLimit ?? null,
    score: 0,
    coins: 0,
    combo: 0,
    compostLeft: level.compost,
    progress: Object.fromEntries(level.blueprints.map((b) => [b.id, 0])),
    bloomed: [],
    nextPlantId: 1,
    status: 'playing',
    endReason: null,
    stars: 0,
    stats: { patterns: 0, flowersGrown: 0, largestCombo: 0 },
  };
  for (let i = 0; i < 3; i++) state.conveyor.push(drawSeed(state, i));
  return state;
}

function clone(state: GameState): GameState {
  // The level definition is static data and is shared, not copied.
  const { level, ...rest } = state;
  return { level, ...structuredClone(rest) };
}

export function hasEmptySoil(state: GameState): boolean {
  return state.tiles.some((row) => row.some((t) => !t.blocked && !t.plant));
}

export function objectivesMet(state: GameState): boolean {
  if (state.level.objectives.length === 0) return false;
  return state.level.objectives.every((o) =>
    o.kind === 'score' ? state.score >= o.target : (state.progress[o.blueprintId] ?? 0) >= o.count,
  );
}

export function starsFor(level: LevelDef, score: number): number {
  return Math.max(1, level.stars.filter((s) => score >= s).length);
}

/** Tiles that would complete a pattern if any seed were planted next (growth forecast, GDD F6). */
export function forecast(state: GameState): Set<string> {
  const out = new Set<string>();
  if (state.status !== 'playing') return out;
  const sim = clone(state);
  const matured = new Set<number>();
  for (const row of sim.tiles) {
    for (const t of row) {
      if (t.plant && t.plant.stage < MATURE) {
        t.plant.stage = (t.plant.stage + 1) as Stage;
        if (t.plant.stage === MATURE) matured.add(t.plant.id);
      }
    }
  }
  for (const b of detectPatterns(sim, matured)) b.cells.forEach((p) => out.add(`${p.r},${p.c}`));
  return out;
}

function reject(state: GameState, reason: string, r?: number, c?: number) {
  return { state, events: [{ type: 'rejected', reason, r, c } as GameEvent] };
}

export function resolve(input: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  if (input.status !== 'playing') return reject(input, 'The level is over.');
  if (action.slot < 0 || action.slot > 2) return reject(input, 'No such seed.');

  if (action.type === 'compost') {
    if (input.compostLeft <= 0) return reject(input, 'No compost left.');
    const state = clone(input);
    state.compostLeft -= 1;
    const species = drawSeed(state, action.slot);
    state.conveyor[action.slot] = species;
    return {
      state,
      events: [
        { type: 'composted', slot: action.slot },
        { type: 'conveyor', slot: action.slot, species },
      ],
    };
  }

  // 1-3. Select seed, select tile, validate.
  const { r, c } = action;
  if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) return reject(input, 'Off the board.');
  const target = input.tiles[r][c];
  if (target.blocked) return reject(input, 'That tile cannot be planted.', r, c);
  if (target.plant) return reject(input, 'That tile is already planted.', r, c);

  const state = clone(input);
  const events: GameEvent[] = [];
  state.move += 1;
  if (state.movesLeft !== null) state.movesLeft -= 1;

  // 4. Every existing immature plant grows one stage.
  const grew: { r: number; c: number; stage: Stage }[] = [];
  const matured = new Set<number>();
  for (let rr = 0; rr < BOARD_SIZE; rr++) {
    for (let cc = 0; cc < BOARD_SIZE; cc++) {
      const p = state.tiles[rr][cc].plant;
      if (p && p.stage < MATURE) {
        p.stage = (p.stage + 1) as Stage;
        grew.push({ r: rr, c: cc, stage: p.stage });
        if (p.stage === MATURE) {
          matured.add(p.id);
          state.stats.flowersGrown += 1;
        }
      }
    }
  }
  if (grew.length) events.push({ type: 'grew', plants: grew });

  // 5. Place the new seed at stage 1. It does not grow this move.
  const species = state.conveyor[action.slot];
  state.tiles[r][c].plant = { id: state.nextPlantId++, species, stage: 1 };
  events.push({ type: 'planted', r, c, species, slot: action.slot });

  // 6. Detect completed patterns.
  const bursts = detectPatterns(state, matured);

  // 7. Resolve Bloom Bursts.
  if (bursts.length) {
    state.combo += 1;
    state.stats.largestCombo = Math.max(state.stats.largestCombo, state.combo);
    const combo = comboMultiplier(state.combo);
    const multi = 1 + 0.25 * (bursts.length - 1);
    let raw = 0;
    for (const b of bursts) {
      events.push({ type: 'burst', burst: b });
      raw += b.points;
      state.stats.patterns += 1;
      // Endless earns one compost charge per 5 bursts (GDD D4).
      if (state.level.mode === 'endless' && state.stats.patterns % 5 === 0) state.compostLeft += 1;
      for (const cell of b.cells) state.tiles[cell.r][cell.c].plant = null;
      for (const s of b.species) if (!state.bloomed.includes(s)) state.bloomed.push(s);
      if (b.blueprintId) state.progress[b.blueprintId] = (state.progress[b.blueprintId] ?? 0) + 1;
      if (b.cells.length >= 5 && state.level.mode === 'campaign') {
        state.coins += BIG_PATTERN_COINS;
        events.push({ type: 'coins', amount: BIG_PATTERN_COINS, reason: 'Pattern of 5+ flowers' });
      }
    }
    const points = Math.round(raw * combo * multi);
    state.score += points;
    events.push({ type: 'scored', points, combo, multi });
  } else {
    state.combo = 0;
  }

  // 8. Move-based weeds: none until Prototype B.

  // 9. Refill the used conveyor slot. The other two stay as they are.
  const next = drawSeed(state, action.slot);
  state.conveyor[action.slot] = next;
  events.push({ type: 'conveyor', slot: action.slot, species: next });

  // 10. Check the end state, win before loss.
  if (state.level.mode === 'campaign' && objectivesMet(state)) {
    const bonus = (state.movesLeft ?? 0) * FINAL_BLOOM_PER_MOVE;
    state.score += bonus;
    state.status = 'won';
    state.endReason = bonus ? `Final Bloom: +${bonus} for ${state.movesLeft} unused moves` : 'Garden complete';
    state.stars = starsFor(state.level, state.score);
    events.push({ type: 'ended', status: 'won', reason: state.endReason });
  } else if (state.movesLeft !== null && state.movesLeft <= 0) {
    state.status = 'lost';
    state.endReason = 'Out of moves.';
    events.push({ type: 'ended', status: 'lost', reason: state.endReason });
  } else if (!hasEmptySoil(state)) {
    state.status = 'lost';
    state.endReason = state.level.mode === 'endless' ? 'The garden is full.' : 'No empty soil left to plant.';
    events.push({ type: 'ended', status: 'lost', reason: state.endReason });
  }

  return { state, events };
}
