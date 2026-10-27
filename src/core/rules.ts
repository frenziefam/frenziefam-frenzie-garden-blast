// The rules engine. resolve(state, action) is pure: it never mutates its input and always gives the
// same result for the same state and action. The renderer animates from the returned events.
//
// A planting follows Frenzie's approved order of operations (GDD C3). Tools and compost are not
// plantings, so they never grow plants or advance move-based weeds. Real time reaches the engine
// only as 'tick' actions, which drive aggressive weeds (GDD C5).

import { drawSeed } from './conveyor';
import { detectPatterns } from './patterns';
import {
  Action,
  BOARD_SIZE,
  Cell,
  GameEvent,
  GameState,
  LevelDef,
  MATURE,
  Stage,
  Tile,
  ToolKind,
} from './types';
import {
  burstZone,
  chokeTick,
  clearTile,
  countNests,
  countWeeds,
  DEFAULT_AGGRESSIVE_MS,
  DEFAULT_CREEP_INTERVAL,
  endlessSpawn,
  endlessTier,
  hitNest,
  nestTick,
  refreshTelegraphs,
  spreadGroups,
} from './weeds';

export const FINAL_BLOOM_PER_MOVE = 100;
export const BIG_PATTERN_COINS = 15;
export const CLEAR_WEEDS_COINS = 25;
export const WEED_POINTS = 10;
export const RESCUE_POINTS = 50;
export const SPRAY_PROTECTION_MOVES = 2;
export const NEST_HP = 3;
/** Endless run tools: earned every N bursts, at most 3 of each held (GDD D4). */
export const ENDLESS_TOOL_EVERY: Record<ToolKind, number> = { pull: 3, spray: 10, burn: 20 };
export const ENDLESS_TOOL_MAX = 3;

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
      row.push({ blocked, plant: null, slot: null, weed: null, nest: null, protectedUntil: 0 });
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
  for (const w of level.weeds ?? []) tiles[w.r][w.c].weed = w.type;
  for (const n of level.nests ?? []) tiles[n.r][n.c].nest = { hp: n.hp ?? NEST_HP, counter: 0 };
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
    stats: { patterns: 0, flowersGrown: 0, largestCombo: 0, weedsRemoved: 0, playMs: 0 },
    tools: { pull: level.tools?.pull ?? 0, spray: level.tools?.spray ?? 0, burn: level.tools?.burn ?? 0 },
    telegraphs: [],
    aggroMs: level.aggressiveMs ?? DEFAULT_AGGRESSIVE_MS,
    guardedId: null,
    guardedLost: false,
    hadWeeds: (level.weeds?.length ?? 0) + (level.nests?.length ?? 0) > 0,
  };
  for (const p of level.plants ?? []) {
    const id = state.nextPlantId++;
    state.tiles[p.r][p.c].plant = { id, species: p.species, stage: p.stage, infested: null, choke: 0 };
  }
  const guard = level.objectives.find((o) => o.kind === 'protect');
  if (guard && guard.kind === 'protect') state.guardedId = state.tiles[guard.r][guard.c].plant?.id ?? null;
  for (let i = 0; i < 3; i++) state.conveyor.push(drawSeed(state, i));
  refreshTelegraphs(state);
  return state;
}

function clone(state: GameState): GameState {
  // The level definition is static data and is shared, not copied.
  const { level, ...rest } = state;
  return { level, ...structuredClone(rest) };
}

/** A tile a seed can go into right now. */
export function plantable(tile: Tile): boolean {
  return !tile.blocked && !tile.plant && !tile.weed && !tile.nest;
}

export function hasEmptySoil(state: GameState): boolean {
  return state.tiles.some((row) => row.some(plantable));
}

export function objectivesMet(state: GameState): boolean {
  if (state.level.objectives.length === 0) return false;
  return state.level.objectives.every((o) => {
    switch (o.kind) {
      case 'score':
        return state.score >= o.target;
      case 'blueprint':
        return (state.progress[o.blueprintId] ?? 0) >= o.count;
      case 'clearWeeds':
        return countWeeds(state) === 0 && countNests(state) === 0;
      case 'nests':
        return countNests(state) === 0;
      case 'protect':
        return !state.guardedLost;
    }
  });
}

export function starsFor(level: LevelDef, score: number): number {
  return Math.max(1, level.stars.filter((s) => score >= s).length);
}

function creepInterval(state: GameState): number {
  if (state.level.mode === 'endless') return endlessTier(state.move).creepInterval;
  return state.level.creepInterval ?? DEFAULT_CREEP_INTERVAL;
}

function aggressiveInterval(state: GameState): number {
  if (state.level.mode === 'endless') return endlessTier(state.move).aggressiveMs;
  return state.level.aggressiveMs ?? DEFAULT_AGGRESSIVE_MS;
}

export function hasAggressive(state: GameState): boolean {
  return state.tiles.some((row) => row.some((t) => t.weed === 'aggressive'));
}

/** Plantings until creeping weeds and Root Nests next act (for the HUD). */
export function movesUntilCreep(state: GameState): number {
  const n = creepInterval(state);
  return n - (state.move % n);
}

/** Can any held tool make space or remove a weed? Used for the "out of space" rule (GDD C3 step 10). */
function toolsCanHelp(state: GameState): boolean {
  const weeds = state.tiles.some((row) => row.some((t) => t.weed || t.plant?.infested));
  if ((state.tools.pull > 0 || state.tools.spray > 0) && weeds) return true;
  return state.tools.burn > 0 && state.tiles.some((row) => row.some((t) => t.plant || t.weed || t.nest));
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

/** Tiles a tool would touch, for the targeting preview (GDD G6). */
export function toolArea(tool: ToolKind, r: number, c: number, axis: 'row' | 'col' = 'row'): Cell[] {
  if (tool === 'pull') return [{ r, c }];
  if (tool === 'spray') {
    const out: Cell[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < BOARD_SIZE && cc < BOARD_SIZE) out.push({ r: rr, c: cc });
      }
    }
    return out;
  }
  return Array.from({ length: BOARD_SIZE }, (_, i) => (axis === 'row' ? { r, c: i } : { r: i, c }));
}

function reject(state: GameState, reason: string, r?: number, c?: number) {
  return { state, events: [{ type: 'rejected', reason, r, c } as GameEvent] };
}

/** Step 10 (and the same check after tools and timed weeds). Win is checked before loss. */
function checkEnd(state: GameState, events: GameEvent[], afterPlanting: boolean) {
  if (state.status !== 'playing') return;
  const end = (status: 'won' | 'lost', reason: string) => {
    state.status = status;
    state.endReason = reason;
    events.push({ type: 'ended', status, reason });
  };
  if (state.level.mode === 'campaign' && objectivesMet(state)) {
    const bonus = (state.movesLeft ?? 0) * FINAL_BLOOM_PER_MOVE;
    state.score += bonus;
    if (state.hadWeeds && countWeeds(state) === 0) {
      state.coins += CLEAR_WEEDS_COINS;
      events.push({ type: 'coins', amount: CLEAR_WEEDS_COINS, reason: 'Won with every weed cleared' });
    }
    state.stars = starsFor(state.level, state.score);
    return end('won', bonus ? `Final Bloom: +${bonus} for ${state.movesLeft} unused moves` : 'Garden complete');
  }
  if (state.guardedLost) return end('lost', 'The flower you were protecting was destroyed.');
  if (afterPlanting && state.movesLeft !== null && state.movesLeft <= 0) return end('lost', 'Out of moves.');
  if (!hasEmptySoil(state)) {
    if (toolsCanHelp(state)) {
      if (afterPlanting) events.push({ type: 'stuck' });
      return;
    }
    end('lost', state.level.mode === 'endless' ? 'The garden is full.' : 'No empty soil left to plant.');
  }
}

export function resolve(input: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  if (action.type === 'tick') return tick(input, action.ms);
  if (input.status !== 'playing') return reject(input, 'The level is over.');
  if (action.type === 'tool') return useTool(input, action.tool, action.r, action.c, action.axis ?? 'row');
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
  if (target.weed) return reject(input, 'Weeds are growing there. Clear them first.', r, c);
  if (target.nest) return reject(input, 'A Root Nest is there.', r, c);

  const state = clone(input);
  const events: GameEvent[] = [];
  state.move += 1;
  if (state.movesLeft !== null) state.movesLeft -= 1;

  // 4. Every existing immature plant grows one stage, infested or not.
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
  state.tiles[r][c].plant = { id: state.nextPlantId++, species, stage: 1, infested: null, choke: 0 };
  events.push({ type: 'planted', r, c, species, slot: action.slot });

  // 6. Detect completed patterns.
  const bursts = detectPatterns(state, matured);

  // 7. Resolve Bloom Bursts: score, clear the pattern, then hit weeds next to it.
  if (bursts.length) {
    state.combo += 1;
    state.stats.largestCombo = Math.max(state.stats.largestCombo, state.combo);
    const combo = comboMultiplier(state.combo);
    const multi = 1 + 0.25 * (bursts.length - 1);
    let raw = 0;
    let defence = 0;
    for (const b of bursts) {
      events.push({ type: 'burst', burst: b });
      raw += b.points;
      state.stats.patterns += 1;
      for (const cell of b.cells) state.tiles[cell.r][cell.c].plant = null;
      for (const s of b.species) if (!state.bloomed.includes(s)) state.bloomed.push(s);
      if (b.blueprintId) state.progress[b.blueprintId] = (state.progress[b.blueprintId] ?? 0) + 1;
      if (b.cells.length >= 5 && state.level.mode === 'campaign') {
        state.coins += BIG_PATTERN_COINS;
        events.push({ type: 'coins', amount: BIG_PATTERN_COINS, reason: 'Pattern of 5+ flowers' });
      }
      const cleared: Cell[] = [];
      const cured: Cell[] = [];
      for (const z of burstZone(b.cells)) {
        const res = clearTile(state, z.r, z.c);
        if (res === 'weed') cleared.push(z);
        if (res === 'cured') cured.push(z);
        if (state.tiles[z.r][z.c].nest) hitNest(state, z.r, z.c, b.cells.length >= 5 ? 2 : 1, events);
      }
      if (cleared.length || cured.length) events.push({ type: 'cleared', cells: cleared, cured, by: 'burst' });
      defence += cleared.length * WEED_POINTS + cured.length * RESCUE_POINTS;
      if (state.level.mode === 'endless') {
        // Endless earns one compost per 5 bursts and run-only tools (GDD D4).
        if (state.stats.patterns % 5 === 0) state.compostLeft += 1;
        for (const tool of ['pull', 'spray', 'burn'] as ToolKind[]) {
          if (state.stats.patterns % ENDLESS_TOOL_EVERY[tool] === 0 && state.tools[tool] < ENDLESS_TOOL_MAX) {
            state.tools[tool] += 1;
            events.push({ type: 'toolEarned', tool });
          }
        }
      }
    }
    const points = Math.round(raw * combo * multi) + defence;
    state.score += points;
    events.push({ type: 'scored', points, combo, multi });
    refreshTelegraphs(state);
  } else {
    state.combo = 0;
  }

  // 8. Move-based weeds: choke damage, creeping spread, Root Nests, Endless spawns.
  chokeTick(state, events);
  if (state.move % creepInterval(state) === 0) spreadGroups(state, 'creeping', events);
  nestTick(state, events);
  if (state.level.mode === 'endless') endlessSpawn(state, events);
  refreshTelegraphs(state);

  // 9. Refill the used conveyor slot. The other two stay as they are.
  const next = drawSeed(state, action.slot);
  state.conveyor[action.slot] = next;
  events.push({ type: 'conveyor', slot: action.slot, species: next });

  // 10. Check the end state, win before loss.
  checkEnd(state, events, true);
  return { state, events };
}

function useTool(input: GameState, tool: ToolKind, r: number, c: number, axis: 'row' | 'col') {
  if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) return reject(input, 'Off the board.');
  if (input.tools[tool] <= 0) return reject(input, 'You have none of that tool left.');
  const t = input.tiles[r][c];
  if (tool === 'pull' && !t.weed && !t.plant?.infested) return reject(input, 'Pull Weeds needs a weed or an infested plant.', r, c);

  const state = clone(input);
  const events: GameEvent[] = [];
  const cleared: Cell[] = [];
  const cured: Cell[] = [];
  const destroyed: Cell[] = [];
  for (const cell of toolArea(tool, r, c, axis)) {
    const tile = state.tiles[cell.r][cell.c];
    if (tool === 'burn') {
      if (tile.weed) {
        clearTile(state, cell.r, cell.c);
        cleared.push(cell);
      }
      if (tile.plant) {
        if (tile.plant.id === state.guardedId) state.guardedLost = true;
        tile.plant = null;
        destroyed.push(cell);
      }
      if (tile.nest) hitNest(state, cell.r, cell.c, 1, events);
    } else {
      const res = clearTile(state, cell.r, cell.c);
      if (res === 'weed') cleared.push(cell);
      if (res === 'cured') cured.push(cell);
      if (tool === 'spray' && !tile.blocked) tile.protectedUntil = state.move + SPRAY_PROTECTION_MOVES;
    }
  }
  state.tools[tool] -= 1;
  events.push({ type: 'toolUsed', tool });
  if (cleared.length || cured.length) events.push({ type: 'cleared', cells: cleared, cured, by: tool });
  if (destroyed.length) events.push({ type: 'destroyed', cells: destroyed });
  if (tool === 'spray') events.push({ type: 'protected', cells: toolArea('spray', r, c) });
  refreshTelegraphs(state);
  checkEnd(state, events, false);
  return { state, events };
}

/** Real time passing in the Input phase. The first planting starts the clock (GDD C2). */
function tick(input: GameState, ms: number) {
  if (input.status !== 'playing' || input.move === 0 || ms <= 0) return { state: input, events: [] as GameEvent[] };
  const state = clone(input);
  const events: GameEvent[] = [];
  state.stats.playMs += ms;
  if (!hasAggressive(state)) {
    state.aggroMs = aggressiveInterval(state);
    return { state, events };
  }
  state.aggroMs -= ms;
  if (state.aggroMs <= 0) {
    spreadGroups(state, 'aggressive', events);
    state.aggroMs += aggressiveInterval(state);
    if (state.aggroMs <= 0) state.aggroMs = aggressiveInterval(state);
    checkEnd(state, events, false);
  }
  return { state, events };
}
