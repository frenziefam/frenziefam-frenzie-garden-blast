// Pattern recognition (GDD section F): blueprint checks plus free-form shape templates.

import { BOARD_SIZE, Burst, Cell, GameState, MATURE, PatternKind, RARITY, Species, Tile } from './types';

interface Template {
  kind: Exclude<PatternKind, 'blueprint'>;
  base: number;
  /** Lower = preferred when scores tie. Matches the GDD F1 table order. */
  priority: number;
  shapes: Cell[][];
}

const RAW: { kind: Template['kind']; base: number; cells: [number, number][] }[] = [
  { kind: 'ring', base: 1500, cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]] },
  { kind: 'cross', base: 700, cells: [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]] },
  { kind: 'line5', base: 600, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
  { kind: 'lshape', base: 600, cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]] },
  { kind: 'tshape', base: 600, cells: [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]] },
  { kind: 'square', base: 300, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  { kind: 'line4', base: 300, cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
];

export const PATTERN_NAMES: Record<PatternKind, string> = {
  ring: 'Ring',
  cross: 'Cross',
  line5: 'Line of 5',
  lshape: 'L-shape',
  tshape: 'T-shape',
  square: 'Square',
  line4: 'Line of 4',
  blueprint: 'Blueprint',
};

function normalize(cells: Cell[]): Cell[] {
  const minR = Math.min(...cells.map((p) => p.r));
  const minC = Math.min(...cells.map((p) => p.c));
  return cells
    .map((p) => ({ r: p.r - minR, c: p.c - minC }))
    .sort((a, b) => a.r - b.r || a.c - b.c);
}

function key(cells: Cell[]): string {
  return cells.map((p) => `${p.r},${p.c}`).join(';');
}

/** All distinct rotations and reflections of a shape. */
export function orientations(cells: Cell[]): Cell[][] {
  const seen = new Map<string, Cell[]>();
  let current = cells;
  for (let flip = 0; flip < 2; flip++) {
    for (let rot = 0; rot < 4; rot++) {
      const n = normalize(current);
      seen.set(key(n), n);
      current = current.map((p) => ({ r: p.c, c: -p.r }));
    }
    current = cells.map((p) => ({ r: p.r, c: -p.c }));
  }
  return [...seen.values()];
}

export const TEMPLATES: Template[] = RAW.map((t, i) => ({
  kind: t.kind,
  base: t.base,
  priority: i,
  shapes: orientations(t.cells.map(([r, c]) => ({ r, c }))),
}));

const RARITY_MULT = { common: 1, rare: 1.5, legendary: 2 } as const;

export function rarityMultiplier(species: Species[]): number {
  return Math.max(...species.map((s) => RARITY_MULT[RARITY[s]]));
}

/** Score for a blueprint by size, using the free-form table as the guide. */
export function blueprintBase(size: number): number {
  if (size <= 3) return 100;
  if (size === 4) return 300;
  if (size <= 7) return 600;
  return 1500;
}

function isCorrectSlot(tile: Tile): boolean {
  return !!(tile.slot && tile.plant && tile.plant.species === tile.slot.species);
}

/**
 * Finds the patterns to resolve this move (GDD F2, F3). `matured` holds plants that
 * reached stage 3 this move; only placements that include one of them are considered.
 */
export function detectPatterns(state: GameState, matured: Set<number>): Burst[] {
  const tiles = state.tiles;
  const used = new Set<string>();
  const bursts: Burst[] = [];

  // Blueprints first: every slot holds the right species at maturity.
  for (const bp of state.level.blueprints) {
    const complete = bp.cells.every((cell) => {
      const p = tiles[cell.r][cell.c].plant;
      return p && p.species === cell.species && p.stage === MATURE;
    });
    if (!complete) continue;
    const touchesNew = bp.cells.some((cell) => matured.has(tiles[cell.r][cell.c].plant!.id));
    if (!touchesNew) continue;
    bp.cells.forEach((cell) => used.add(`${cell.r},${cell.c}`));
    const species = bp.cells.map((cell) => cell.species);
    bursts.push({
      kind: 'blueprint',
      blueprintId: bp.id,
      species,
      cells: bp.cells.map(({ r, c }) => ({ r, c })),
      points: Math.round(blueprintBase(bp.cells.length) * rarityMultiplier(species)),
    });
  }

  if (!state.level.freeform) return bursts;

  interface Candidate {
    t: Template;
    cells: Cell[];
    species: Species;
  }
  const candidates: Candidate[] = [];
  for (const t of TEMPLATES) {
    for (const shape of t.shapes) {
      const h = Math.max(...shape.map((p) => p.r)) + 1;
      const w = Math.max(...shape.map((p) => p.c)) + 1;
      for (let r = 0; r + h <= BOARD_SIZE; r++) {
        for (let c = 0; c + w <= BOARD_SIZE; c++) {
          const cells = shape.map((p) => ({ r: r + p.r, c: c + p.c }));
          let species: Species | null = null;
          let ok = true;
          let touchesNew = false;
          for (const cell of cells) {
            const tile = tiles[cell.r][cell.c];
            const p = tile.plant;
            if (tile.blocked || !p || p.stage !== MATURE || isCorrectSlot(tile)) {
              ok = false;
              break;
            }
            if (species === null) species = p.species;
            else if (p.species !== species) {
              ok = false;
              break;
            }
            if (matured.has(p.id)) touchesNew = true;
          }
          if (ok && touchesNew && species) candidates.push({ t, cells, species });
        }
      }
    }
  }

  const topLeft = (cells: Cell[]) => {
    const r = Math.min(...cells.map((p) => p.r));
    const c = Math.min(...cells.filter((p) => p.r === r).map((p) => p.c));
    return { r, c };
  };
  candidates.sort((a, b) => {
    if (b.t.base !== a.t.base) return b.t.base - a.t.base;
    if (b.cells.length !== a.cells.length) return b.cells.length - a.cells.length;
    if (a.t.priority !== b.t.priority) return a.t.priority - b.t.priority;
    const ta = topLeft(a.cells);
    const tb = topLeft(b.cells);
    return ta.r - tb.r || ta.c - tb.c;
  });

  for (const cand of candidates) {
    if (cand.cells.some((p) => used.has(`${p.r},${p.c}`))) continue;
    cand.cells.forEach((p) => used.add(`${p.r},${p.c}`));
    const species = cand.cells.map(() => cand.species);
    bursts.push({
      kind: cand.t.kind,
      species,
      cells: cand.cells,
      points: Math.round(cand.t.base * rarityMultiplier(species)),
    });
  }
  return bursts;
}
