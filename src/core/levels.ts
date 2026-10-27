// Prototype A test levels. Each level is plain data, so new levels need no new code.

import { LevelDef } from './types';

const SMALL = ['########', '#......#', '#......#', '#......#', '#......#', '#......#', '#......#', '########'];
const MEDIUM = ['.......#', '.......#', '.......#', '.......#', '.......#', '.......#', '.......#', '########'];

export const LEVELS: LevelDef[] = [
  {
    id: 'a1',
    name: 'First Bloom',
    mode: 'campaign',
    intro: 'Grow 3 roses in the marked row.',
    tip: 'Every planting grows your other plants one stage. A seed blooms two plantings later.',
    mask: SMALL,
    blueprints: [
      { id: 'roses', name: 'Rose row', cells: [2, 3, 4].map((c) => ({ r: 3, c, species: 'rose' as const })) },
    ],
    objectives: [{ kind: 'blueprint', blueprintId: 'roses', count: 1 }],
    weights: { rose: 3, daisy: 2 },
    script: ['rose', 'daisy', 'rose', 'rose', 'daisy', 'daisy', 'rose', 'daisy'],
    moveLimit: 10,
    compost: 0,
    freeform: false,
    stars: [100, 400, 600],
  },
  {
    id: 'a2',
    name: 'Sunflower Column',
    mode: 'campaign',
    intro: 'Grow the sunflower column twice.',
    tip: 'The outline stays after it blooms. Grow it again.',
    mask: SMALL,
    blueprints: [
      { id: 'sun', name: 'Sunflower column', cells: [2, 3, 4].map((r) => ({ r, c: 3, species: 'sunflower' as const })) },
    ],
    objectives: [{ kind: 'blueprint', blueprintId: 'sun', count: 2 }],
    weights: { sunflower: 3, daisy: 2 },
    script: ['sunflower', 'daisy', 'sunflower', 'sunflower', 'daisy', 'daisy', 'sunflower', 'sunflower', 'sunflower'],
    moveLimit: 16,
    compost: 0,
    freeform: false,
    stars: [200, 500, 700],
  },
  {
    id: 'a3',
    name: 'Daisy Square',
    mode: 'campaign',
    intro: 'Grow a 2×2 square of daisies.',
    tip: 'Plants outside the outline still grow. Use them to time your blooms.',
    mask: SMALL,
    blueprints: [
      {
        id: 'sq',
        name: 'Daisy square',
        cells: [
          { r: 3, c: 3, species: 'daisy' },
          { r: 3, c: 4, species: 'daisy' },
          { r: 4, c: 3, species: 'daisy' },
          { r: 4, c: 4, species: 'daisy' },
        ],
      },
    ],
    objectives: [{ kind: 'blueprint', blueprintId: 'sq', count: 1 }],
    weights: { daisy: 3, rose: 2 },
    script: ['daisy', 'rose', 'daisy', 'daisy', 'rose', 'daisy', 'rose'],
    moveLimit: 12,
    compost: 0,
    freeform: false,
    stars: [300, 700, 900],
  },
  {
    id: 'a4',
    name: 'Two Beds',
    mode: 'campaign',
    intro: 'Grow the rose row and the tulip column.',
    tip: 'Seeds you skip stay on the conveyor. Hold a seed until you need it, or compost one you do not want.',
    mask: MEDIUM,
    blueprints: [
      { id: 'roses', name: 'Rose row', cells: [1, 2, 3].map((c) => ({ r: 1, c, species: 'rose' as const })) },
      { id: 'tulips', name: 'Tulip column', cells: [3, 4, 5].map((r) => ({ r, c: 5, species: 'tulip' as const })) },
    ],
    objectives: [
      { kind: 'blueprint', blueprintId: 'roses', count: 1 },
      { kind: 'blueprint', blueprintId: 'tulips', count: 1 },
    ],
    weights: { rose: 3, tulip: 3, daisy: 2 },
    moveLimit: 16,
    compost: 2,
    freeform: false,
    stars: [200, 700, 1000],
  },
  {
    id: 'a5',
    name: 'Keystone',
    mode: 'campaign',
    intro: 'Grow the tulip T and reach 1,200 points.',
    tip: 'Outside the outline, 4 or more matching flowers in a shape also bloom. Plant the middle of a line last so it blooms as one big pattern.',
    blueprints: [
      {
        id: 'tee',
        name: 'Tulip T',
        cells: [
          { r: 1, c: 2, species: 'tulip' },
          { r: 1, c: 3, species: 'tulip' },
          { r: 1, c: 4, species: 'tulip' },
          { r: 2, c: 3, species: 'tulip' },
          { r: 3, c: 3, species: 'tulip' },
        ],
      },
    ],
    objectives: [
      { kind: 'blueprint', blueprintId: 'tee', count: 1 },
      { kind: 'score', target: 1200 },
    ],
    weights: { tulip: 3, rose: 3, daisy: 3 },
    moveLimit: 22,
    compost: 2,
    freeform: true,
    stars: [1200, 2200, 3200],
  },
];

export const ENDLESS: LevelDef = {
  id: 'endless',
  name: 'Endless Garden',
  mode: 'endless',
  intro: 'Bloom patterns of 4 or more anywhere. The run ends when the garden is full.',
  tip: 'New species join as you go. Weeds arrive in the next prototype.',
  blueprints: [],
  objectives: [],
  weights: { rose: 3, daisy: 3, sunflower: 3, tulip: 3, lily: 3, orchid: 1 },
  compost: 3,
  freeform: true,
  stars: [0, 0, 0],
};
