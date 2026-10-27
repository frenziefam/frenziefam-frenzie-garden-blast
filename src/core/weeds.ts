// Weed behaviour (GDD section G). Functions mutate the working copy of the state passed in;
// resolve() in rules.ts is the only caller and always passes a fresh clone.

import { nextRandom } from './rng';
import { BOARD_SIZE, Cell, GameEvent, GameState, SpreadSource, Telegraph, Tile, WeedType } from './types';

const DIRS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export const DEFAULT_CREEP_INTERVAL = 3;
export const DEFAULT_AGGRESSIVE_MS = 15000;
export const DEFAULT_NEST_INTERVAL = 2;
export const CHOKE_LIMIT = 2;

function inBoard(r: number, c: number) {
  return r >= 0 && c >= 0 && r < BOARD_SIZE && c < BOARD_SIZE;
}

function pick<T>(state: GameState, items: T[]): T {
  const [v, next] = nextRandom(state.rng);
  state.rng = next;
  return items[Math.floor(v * items.length)];
}

export function isProtected(state: GameState, tile: Tile) {
  return state.move <= tile.protectedUntil && tile.protectedUntil > 0;
}

/** A tile weeds may spread into: soil, not weed or nest, not sprayed, not already infested. */
export function spreadable(state: GameState, r: number, c: number): boolean {
  if (!inBoard(r, c)) return false;
  const t = state.tiles[r][c];
  if (t.blocked || t.weed || t.nest || isProtected(state, t)) return false;
  if (t.plant && t.plant.infested) return false;
  return true;
}

/** Orthogonally connected weed tiles of one type, in a stable order (top-left cell first). */
export function weedGroups(state: GameState): { type: WeedType; cells: Cell[] }[] {
  const seen = new Set<string>();
  const groups: { type: WeedType; cells: Cell[] }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const type = state.tiles[r][c].weed;
      if (!type || seen.has(`${r},${c}`)) continue;
      const cells: Cell[] = [];
      const queue: Cell[] = [{ r, c }];
      seen.add(`${r},${c}`);
      while (queue.length) {
        const cur = queue.shift()!;
        cells.push(cur);
        for (const [dr, dc] of DIRS) {
          const nr = cur.r + dr;
          const nc = cur.c + dc;
          if (!inBoard(nr, nc) || seen.has(`${nr},${nc}`) || state.tiles[nr][nc].weed !== type) continue;
          seen.add(`${nr},${nc}`);
          queue.push({ r: nr, c: nc });
        }
      }
      groups.push({ type, cells });
    }
  }
  return groups;
}

function candidates(state: GameState, cells: Cell[]): Cell[] {
  const out: Cell[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    for (const [dr, dc] of DIRS) {
      const r = cell.r + dr;
      const c = cell.c + dc;
      const k = `${r},${c}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (spreadable(state, r, c)) out.push({ r, c });
    }
  }
  return out.sort((a, b) => a.r - b.r || a.c - b.c);
}

/**
 * Gives every weed group and Root Nest exactly one telegraphed target. Existing targets are kept
 * while still valid, so the preview only changes when the board changes under it.
 */
export function refreshTelegraphs(state: GameState) {
  const old = state.telegraphs.slice();
  const next: Telegraph[] = [];
  const take = (type: WeedType, source: Telegraph['source'], cells: Cell[]) => {
    const options = candidates(state, cells);
    if (!options.length) return;
    const keepIdx = old.findIndex(
      (t) => t.type === type && t.source === source && options.some((o) => o.r === t.r && o.c === t.c),
    );
    if (keepIdx >= 0) {
      next.push(old[keepIdx]);
      old.splice(keepIdx, 1);
      return;
    }
    const target = pick(state, options);
    next.push({ ...target, type, source });
  };
  for (const g of weedGroups(state)) take(g.type, 'group', g.cells);
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) if (state.tiles[r][c].nest) take('creeping', 'nest', [{ r, c }]);
  }
  state.telegraphs = next;
}

/** Applies one spread to a tile: empty soil becomes weed, a healthy plant becomes infested. */
export function spreadInto(state: GameState, r: number, c: number, type: WeedType, source: SpreadSource, events: GameEvent[]) {
  if (!spreadable(state, r, c)) return;
  const tile = state.tiles[r][c];
  if (tile.plant) {
    tile.plant.infested = type;
    tile.plant.choke = 0;
    events.push({ type: 'infested', r, c, weed: type });
  } else {
    tile.weed = type;
    events.push({ type: 'spread', r, c, weed: type, source });
  }
}

/** Spreads every group of one type once, toward its telegraph. */
export function spreadGroups(state: GameState, type: WeedType, events: GameEvent[]) {
  const targets = state.telegraphs.filter((t) => t.type === type && t.source === 'group');
  for (const t of targets) spreadInto(state, t.r, t.c, type, type, events);
  if (targets.length) refreshTelegraphs(state);
}

/** Step 8.1: infested plants take one choke damage; at the limit they die and become weed. */
export function chokeTick(state: GameState, events: GameEvent[]) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const tile = state.tiles[r][c];
      const p = tile.plant;
      if (!p || !p.infested) continue;
      p.choke = (p.choke ?? 0) + 1;
      if (p.choke >= CHOKE_LIMIT) {
        if (p.id === state.guardedId) state.guardedLost = true;
        tile.weed = p.infested;
        tile.plant = null;
        events.push({ type: 'choked', r, c, species: p.species });
      }
    }
  }
}

/** Step 8.3: Root Nests count plantings and spawn a creeping weed toward their telegraph. */
export function nestTick(state: GameState, events: GameEvent[]) {
  const interval = state.level.nestInterval ?? DEFAULT_NEST_INTERVAL;
  let spawned = false;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const nest = state.tiles[r][c].nest;
      if (!nest) continue;
      nest.counter += 1;
      if (nest.counter < interval) continue;
      nest.counter = 0;
      const t = state.telegraphs.find((x) => x.source === 'nest' && Math.abs(x.r - r) + Math.abs(x.c - c) === 1);
      if (t) {
        spreadInto(state, t.r, t.c, 'creeping', 'nest', events);
        spawned = true;
      }
    }
  }
  if (spawned) refreshTelegraphs(state);
}

/** Removes the weed on a tile, or cures the infested plant on it. Returns what happened. */
export function clearTile(state: GameState, r: number, c: number): 'weed' | 'cured' | null {
  const tile = state.tiles[r][c];
  if (tile.weed) {
    tile.weed = null;
    state.stats.weedsRemoved += 1;
    return 'weed';
  }
  if (tile.plant?.infested) {
    tile.plant.infested = null;
    tile.plant.choke = 0;
    return 'cured';
  }
  return null;
}

/** Damages a Root Nest; at 0 hit points it becomes empty soil. */
export function hitNest(state: GameState, r: number, c: number, damage: number, events: GameEvent[]) {
  const nest = state.tiles[r][c].nest;
  if (!nest) return;
  nest.hp = Math.max(0, nest.hp - damage);
  events.push({ type: 'nestHit', r, c, hp: nest.hp });
  if (nest.hp === 0) state.tiles[r][c].nest = null;
}

/** Bloom Burst defence (GDD G4): tiles next to the pattern; diagonals too for 5+ flowers. */
export function burstZone(cells: Cell[]): Cell[] {
  const inPattern = new Set(cells.map((p) => `${p.r},${p.c}`));
  const reach: [number, number][] = cells.length >= 5
    ? [...DIRS, [-1, -1], [-1, 1], [1, -1], [1, 1]]
    : DIRS;
  const out = new Map<string, Cell>();
  for (const cell of cells) {
    for (const [dr, dc] of reach) {
      const r = cell.r + dr;
      const c = cell.c + dc;
      const k = `${r},${c}`;
      if (!inBoard(r, c) || inPattern.has(k)) continue;
      out.set(k, { r, c });
    }
  }
  return [...out.values()];
}

export function countWeeds(state: GameState): number {
  let n = 0;
  for (const row of state.tiles) for (const t of row) if (t.weed || t.plant?.infested) n++;
  return n;
}

export function countNests(state: GameState): number {
  let n = 0;
  for (const row of state.tiles) for (const t of row) if (t.nest) n++;
  return n;
}

// ---------- Endless difficulty (GDD D4) ----------

export interface EndlessTier {
  tier: number;
  creepInterval: number;
  spawnEvery: number;
  maxAggressive: number;
  aggressiveMs: number;
}

export function endlessTier(move: number): EndlessTier {
  if (move <= 25) return { tier: 1, creepInterval: 4, spawnEvery: 20, maxAggressive: 0, aggressiveMs: 20000 };
  if (move <= 50) return { tier: 2, creepInterval: 3, spawnEvery: 15, maxAggressive: 0, aggressiveMs: 20000 };
  if (move <= 75) return { tier: 3, creepInterval: 3, spawnEvery: 15, maxAggressive: 1, aggressiveMs: 20000 };
  if (move <= 100) return { tier: 4, creepInterval: 3, spawnEvery: 12, maxAggressive: 2, aggressiveMs: 15000 };
  return { tier: 5, creepInterval: 2, spawnEvery: 10, maxAggressive: 3, aggressiveMs: 12000 };
}

export const ENDLESS_FIRST_WEED_MOVE = 10;

/** Spawns a new weed group on a random empty edge tile when the Endless schedule says so. */
export function endlessSpawn(state: GameState, events: GameEvent[]) {
  const t = endlessTier(state.move);
  if (state.move < ENDLESS_FIRST_WEED_MOVE || (state.move - ENDLESS_FIRST_WEED_MOVE) % t.spawnEvery !== 0) return;
  const edge: Cell[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const onEdge = r === 0 || c === 0 || r === BOARD_SIZE - 1 || c === BOARD_SIZE - 1;
      const tile = state.tiles[r][c];
      if (onEdge && !tile.blocked && !tile.plant && !tile.weed && !tile.nest) edge.push({ r, c });
    }
  }
  if (!edge.length) return;
  const aggressiveGroups = weedGroups(state).filter((g) => g.type === 'aggressive').length;
  const type: WeedType = aggressiveGroups < t.maxAggressive ? 'aggressive' : 'creeping';
  const cell = pick(state, edge);
  state.tiles[cell.r][cell.c].weed = type;
  if (type === 'aggressive' && aggressiveGroups === 0) state.aggroMs = t.aggressiveMs;
  state.hadWeeds = true;
  events.push({ type: 'spread', r: cell.r, c: cell.c, weed: type, source: 'endless' });
  refreshTelegraphs(state);
}
