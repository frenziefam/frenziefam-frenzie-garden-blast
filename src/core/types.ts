// Shared types for the rules engine. Nothing in src/core may import Phaser or touch the DOM.

export const BOARD_SIZE = 8;

export type Species = 'rose' | 'daisy' | 'sunflower' | 'tulip' | 'lily' | 'orchid';
export const ALL_SPECIES: Species[] = ['rose', 'daisy', 'sunflower', 'tulip', 'lily', 'orchid'];

export type Rarity = 'common' | 'rare' | 'legendary';
export const RARITY: Record<Species, Rarity> = {
  rose: 'common',
  daisy: 'common',
  sunflower: 'common',
  tulip: 'common',
  lily: 'common',
  orchid: 'rare',
};

/** 1 = seed, 2 = sprout/bud, 3 = mature flower. */
export type Stage = 1 | 2 | 3;
export const MATURE: Stage = 3;

export interface Plant {
  id: number;
  species: Species;
  stage: Stage;
}

export interface BlueprintSlot {
  blueprintId: string;
  species: Species;
}

export interface Tile {
  blocked: boolean;
  plant: Plant | null;
  slot: BlueprintSlot | null;
}

export interface Cell {
  r: number;
  c: number;
}

export interface BlueprintDef {
  id: string;
  name: string;
  cells: (Cell & { species: Species })[];
}

export type Objective =
  | { kind: 'blueprint'; blueprintId: string; count: number }
  | { kind: 'score'; target: number };

export type Mode = 'campaign' | 'endless';

export interface LevelDef {
  id: string;
  name: string;
  mode: Mode;
  /** One-line goal shown on the intro card. */
  intro: string;
  /** Optional teaching tip shown on the intro card. */
  tip?: string;
  /** 8 strings of 8 chars: '.' playable soil, '#' blocked. Omit for a full board. */
  mask?: string[];
  blueprints: BlueprintDef[];
  objectives: Objective[];
  /** Relative frequency of each species in the seed bag. */
  weights: Partial<Record<Species, number>>;
  /** Authored seed order used before the bag takes over (tutorial levels). */
  script?: Species[];
  /** Number of plantings allowed. Omit for no limit (Endless). */
  moveLimit?: number;
  compost: number;
  /** Free-form patterns resolve outside blueprint slots. */
  freeform: boolean;
  /** Score needed for 1, 2 and 3 stars. */
  stars: [number, number, number];
}

export type Action =
  | { type: 'plant'; slot: number; r: number; c: number }
  | { type: 'compost'; slot: number };

export type PatternKind = 'ring' | 'cross' | 'line5' | 'lshape' | 'tshape' | 'square' | 'line4' | 'blueprint';

export interface Burst {
  kind: PatternKind;
  blueprintId?: string;
  species: Species[];
  cells: Cell[];
  points: number;
}

export type GameEvent =
  | { type: 'rejected'; reason: string; r?: number; c?: number }
  | { type: 'grew'; plants: { r: number; c: number; stage: Stage }[] }
  | { type: 'planted'; r: number; c: number; species: Species; slot: number }
  | { type: 'burst'; burst: Burst }
  | { type: 'scored'; points: number; combo: number; multi: number }
  | { type: 'coins'; amount: number; reason: string }
  | { type: 'conveyor'; slot: number; species: Species }
  | { type: 'composted'; slot: number }
  | { type: 'ended'; status: 'won' | 'lost'; reason: string };

export interface RunStats {
  patterns: number;
  flowersGrown: number;
  largestCombo: number;
}

export interface GameState {
  level: LevelDef;
  /** Seed for this attempt, kept for replays and bug reports. */
  seed: number;
  rng: number;
  tiles: Tile[][];
  conveyor: Species[];
  bag: Species[];
  scriptIndex: number;
  draws: number;
  lastDrawn: Partial<Record<Species, number>>;
  move: number;
  movesLeft: number | null;
  score: number;
  coins: number;
  combo: number;
  compostLeft: number;
  progress: Record<string, number>;
  /** Species consumed by a burst this attempt; decides card eligibility. */
  bloomed: Species[];
  nextPlantId: number;
  status: 'playing' | 'won' | 'lost';
  endReason: string | null;
  stars: number;
  stats: RunStats;
}
