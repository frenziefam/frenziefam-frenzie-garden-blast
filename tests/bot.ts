// A simple heuristic bot used to check levels are winnable. It is far weaker than the look-ahead
// solver planned for Prototype C (GDD E3), so a high win rate means a level is comfortably
// solvable, not that it is tuned.

import { plantable, resolve, toolArea } from '../src/core/rules';
import { countNests } from '../src/core/weeds';
import { Action, Cell, GameState, Species } from '../src/core/types';

function open(state: GameState): Cell[] {
  const out: Cell[] = [];
  state.tiles.forEach((row, r) => row.forEach((t, c) => plantable(t) && out.push({ r, c })));
  return out;
}

const ROWS: Species[][] = [['sunflower', 'lily'], ['daisy'], ['rose'], ['tulip']];

/** Each species gets its own band of rows for building free-form lines of 4. */
function lineSpot(state: GameState, species: Species): Cell | null {
  const band = ROWS.findIndex((b) => b.includes(species));
  if (band < 0) return null;
  for (const r of [7 - band, 3 - band].filter((x) => x >= 0)) {
    for (const c of [0, 1, 3, 2, 4, 5, 7, 6]) {
      const t = state.tiles[r][c];
      if (plantable(t) && !(t.slot && openBeds(state).some((b) => b.id === t.slot!.blueprintId)) && !state.telegraphs.some((x) => x.r === r && x.c === c)) return { r, c };
    }
  }
  return null;
}

function weedsIn(state: GameState, cells: Cell[]) {
  return cells.filter(({ r, c }) => state.tiles[r][c].weed || state.tiles[r][c].plant?.infested).length;
}

function toolMove(state: GameState): Action | null {
  const { tools, tiles, level } = state;
  // Save infested plants that matter: blueprint slots and the protected flower first.
  const clearing = level.objectives.some((o) => o.kind === 'clearWeeds');
  if (tools.pull > 0) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = tiles[r][c].plant;
        if (p?.infested && (tiles[r][c].slot || p.id === state.guardedId || (p.stage === 3 && !clearing))) {
          return { type: 'tool', tool: 'pull', r, c };
        }
      }
    }
    // Stop a weed that is about to reach the guarded flower or an unfinished blueprint slot.
    for (const t of state.telegraphs) {
      const tile = tiles[t.r][t.c];
      if (!(tile.slot || tile.plant?.id === state.guardedId)) continue;
      const src = [[-1, 0], [1, 0], [0, -1], [0, 1]]
        .map(([dr, dc]) => ({ r: t.r + dr, c: t.c + dc }))
        .find((p) => p.r >= 0 && p.c >= 0 && p.r < 8 && p.c < 8 && tiles[p.r][p.c].weed);
      if (src && (t.type === 'aggressive' || weedsIn(state, [src]) === 1)) return { type: 'tool', tool: 'pull', ...src };
    }
  }
  if (tools.spray > 0) {
    let best: Action | null = null;
    let most = 2;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const n = weedsIn(state, toolArea('spray', r, c));
        if (n > most) [most, best] = [n, { type: 'tool', tool: 'spray', r, c }];
      }
    }
    if (best) return best;
  }
  if (tools.burn > 0) {
    for (let i = 0; i < 8; i++) {
      for (const axis of ['row', 'col'] as const) {
        const cells = toolArea('burn', axis === 'row' ? i : 0, axis === 'row' ? 0 : i, axis);
        const plants = cells.filter(({ r, c }) => tiles[r][c].plant).length;
        const nests = cells.filter(({ r, c }) => tiles[r][c].nest).length;
        if (plants <= 1 && (weedsIn(state, cells) >= 4 || nests)) {
          return { type: 'tool', tool: 'burn', r: axis === 'row' ? i : 0, c: axis === 'row' ? 0 : i, axis };
        }
      }
    }
  }
  // Clear-the-weeds objective: once the beds are done, pull what is left.
  const bedsDone = openBeds(state).length === 0;
  if (clearing && (bedsDone || state.movesLeft! < 4) && tools.pull > 0) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (weedsIn(state, [{ r, c }])) return { type: 'tool', tool: 'pull', r, c };
  }
  return null;
}

/** Plants next to a Root Nest so bursts hit it. */
function nestSpot(state: GameState, species: Species): Cell | null {
  if (!countNests(state)) return null;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (!state.tiles[r][c].nest) continue;
      // Build a horizontal line of one species on the row below the nest, ending under it.
      const rr = r + 1;
      if (rr > 7) continue;
      const lineSpecies = state.tiles[rr].find((t) => t.plant)?.plant?.species ?? species;
      if (lineSpecies !== species) return null;
      for (const cc of [c, c - 1, c - 2, c - 3, c + 1]) {
        if (cc >= 0 && cc < 8 && plantable(state.tiles[rr][cc])) return { r: rr, c: cc };
      }
    }
  }
  return null;
}

/** Blueprints the objectives still need. Finished beds re-arm, but growing them again wastes moves. */
function openBeds(state: GameState) {
  return state.level.blueprints.filter((bp) => {
    const o = state.level.objectives.find((x) => x.kind === 'blueprint' && x.blueprintId === bp.id);
    const need = o && o.kind === 'blueprint' ? o.count : 1;
    return (state.progress[bp.id] ?? 0) < need;
  });
}

export function botMove(state: GameState): Action {
  const tool = toolMove(state);
  if (tool && resolve(state, tool).events[0].type !== 'rejected') return tool;
  // 1. Fill a blueprint slot with the right species if the conveyor has it.
  for (let i = 0; i < 3; i++) {
    const sp = state.conveyor[i];
    for (const bp of openBeds(state)) {
      const cell = bp.cells.find((c) => c.species === sp && plantable(state.tiles[c.r][c.c]));
      if (cell) return { type: 'plant', slot: i, r: cell.r, c: cell.c };
    }
  }
  // 2. Otherwise plant away from blueprint slots: next to a nest, or building lines.
  const beds = new Set(openBeds(state).map((b) => b.id));
  const spots = open(state).filter((c) => !beds.has(state.tiles[c.r][c.c].slot?.blueprintId ?? ''));
  for (let i = 0; i < 3; i++) {
    const sp = state.conveyor[i];
    const needed = openBeds(state).some((bp) => bp.cells.some((c) => c.species === sp && plantable(state.tiles[c.r][c.c])));
    if (needed) continue;
    const near = nestSpot(state, sp);
    if (near) return { type: 'plant', slot: i, ...near };
    if (state.level.freeform) {
      const spot = lineSpot(state, sp);
      if (spot) return { type: 'plant', slot: i, ...spot };
    }
  }
  if (state.compostLeft > 0) return { type: 'compost', slot: 0 };
  const any = spots[0] ?? open(state)[0];
  if (!any) {
    const t = state.tools;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (t.pull && weedsIn(state, [{ r, c }])) return { type: 'tool', tool: 'pull', r, c };
    return { type: 'tool', tool: 'burn', r: 0, c: 0, axis: 'row' };
  }
  return { type: 'plant', slot: 0, r: any.r, c: any.c };
}

/** Plays a level to the end. Aggressive weeds get 6 seconds of thinking time per planting. */
export function playOut(state: GameState): GameState {
  let s = state;
  for (let guard = 0; guard < 300 && s.status === 'playing'; guard++) {
    const action = botMove(s);
    const out = resolve(s, action);
    if (out.state === s) break; // rejected: the bot is stuck
    s = out.state;
    if (action.type === 'plant') s = resolve(s, { type: 'tick', ms: 6000 }).state;
  }
  return s;
}
