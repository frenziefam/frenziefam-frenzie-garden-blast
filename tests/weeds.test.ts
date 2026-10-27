import { createGame, resolve, RESCUE_POINTS, WEED_POINTS } from '../src/core/rules';
import { ENDLESS } from '../src/core/levels';
import { Action, GameEvent, GameState, LevelDef, Species } from '../src/core/types';

const level = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 't',
  name: 'Test',
  mode: 'campaign',
  intro: '',
  blueprints: [],
  objectives: [{ kind: 'score', target: 999999 }],
  weights: { rose: 1, daisy: 1, tulip: 1 },
  moveLimit: 99,
  compost: 2,
  freeform: true,
  stars: [1, 2, 3],
  ...over,
});

const MIX: Species[] = ['rose', 'daisy', 'tulip', 'lily', 'sunflower', 'orchid'];

/** Plants a forced species at each cell. Species rotate so no pattern forms by accident. */
function plantAt(state: GameState, cells: [number, number][], species?: Species) {
  let s = state;
  const events: GameEvent[] = [];
  cells.forEach(([r, c], i) => {
    const sp = species ?? MIX[(s.move + i) % MIX.length];
    s = { ...s, conveyor: [sp, s.conveyor[1], s.conveyor[2]] };
    const out = resolve(s, { type: 'plant', slot: 0, r, c });
    expect(out.events[0].type).not.toBe('rejected');
    s = out.state;
    events.push(...out.events);
  });
  return { state: s, events };
}

const filler: [number, number][] = [
  [7, 7], [7, 5], [7, 3], [5, 7], [5, 5], [5, 3], [3, 7], [3, 5], [7, 1], [5, 1],
];

describe('creeping weeds', () => {
  it('spread one tile per group every 3 plantings, into the telegraphed tile', () => {
    const g = createGame(level({ weeds: [{ r: 0, c: 0, type: 'creeping' }] }), 7);
    expect(g.telegraphs).toHaveLength(1);
    const target = g.telegraphs[0];
    expect([[0, 1], [1, 0]]).toContainEqual([target.r, target.c]);

    const two = plantAt(g, filler.slice(0, 2)).state;
    expect(two.tiles[target.r][target.c].weed).toBeNull();
    expect(two.telegraphs[0]).toMatchObject({ r: target.r, c: target.c }); // preview is stable

    const three = plantAt(two, filler.slice(2, 3));
    expect(three.state.tiles[target.r][target.c].weed).toBe('creeping');
    expect(three.events).toContainEqual({ type: 'spread', r: target.r, c: target.c, weed: 'creeping', source: 'creeping' });
    const weeds = three.state.tiles.flat().filter((t) => t.weed).length;
    expect(weeds).toBe(2);
  });

  it('cannot be planted on', () => {
    const g = createGame(level({ weeds: [{ r: 2, c: 2, type: 'creeping' }] }), 1);
    const out = resolve(g, { type: 'plant', slot: 0, r: 2, c: 2 });
    expect(out.events[0].type).toBe('rejected');
    expect(out.state).toBe(g);
  });

  it('infest a plant, which keeps growing, then choke it after 2 plantings', () => {
    // Weed at (0,0); the only open neighbour is (0,1), which holds a seed.
    const g = createGame(
      level({
        mask: ['..######', '########', '########', '########', '########', '########', '########', '########'].map(
          (row, r) => (r >= 4 ? '........' : row),
        ),
        weeds: [{ r: 0, c: 0, type: 'creeping' }],
        creepInterval: 1,
      }),
      3,
    );
    const a = plantAt(g, [[0, 1]], 'rose');
    // Planted at move 1, spread happens on the same planting (interval 1).
    const plant = a.state.tiles[0][1].plant!;
    expect(plant.infested).toBe('creeping');
    expect(plant.stage).toBe(1);
    const b = plantAt(a.state, [[7, 7]]);
    expect(b.state.tiles[0][1].plant!.stage).toBe(2); // infested plants still grow (approved)
    expect(b.state.tiles[0][1].plant!.choke).toBe(1);
    const c = plantAt(b.state, [[7, 5]]);
    expect(c.state.tiles[0][1].plant).toBeNull();
    expect(c.state.tiles[0][1].weed).toBe('creeping');
    expect(c.events).toContainEqual({ type: 'choked', r: 0, c: 1, species: 'rose' });
  });
});

describe('tools', () => {
  const weedy = level({
    weeds: [
      { r: 2, c: 2, type: 'creeping' },
      { r: 2, c: 3, type: 'creeping' },
      { r: 3, c: 2, type: 'creeping' },
    ],
    tools: { pull: 1, spray: 1, burn: 1 },
  });

  it('Pull Weeds removes one weed and does not grow plants or use a move', () => {
    const g = plantAt(createGame(weedy, 1), [[6, 6]]).state;
    const out = resolve(g, { type: 'tool', tool: 'pull', r: 2, c: 2 });
    expect(out.state.tiles[2][2].weed).toBeNull();
    expect(out.state.tools.pull).toBe(0);
    expect(out.state.move).toBe(g.move);
    expect(out.state.movesLeft).toBe(g.movesLeft);
    expect(out.state.tiles[6][6].plant!.stage).toBe(1);
    expect(out.state.stats.weedsRemoved).toBe(1);
    expect(resolve(out.state, { type: 'tool', tool: 'pull', r: 2, c: 3 }).events[0].type).toBe('rejected');
  });

  it('Pull Weeds needs a weed or infested plant', () => {
    const out = resolve(createGame(weedy, 1), { type: 'tool', tool: 'pull', r: 6, c: 6 });
    expect(out.events[0].type).toBe('rejected');
  });

  it('Weed Spray clears 3x3 and protects it for 2 plantings', () => {
    const g = createGame(level({ weeds: [{ r: 0, c: 0, type: 'creeping' }, { r: 2, c: 2, type: 'creeping' }], tools: { spray: 1 }, creepInterval: 1 }), 2);
    const out = resolve(g, { type: 'tool', tool: 'spray', r: 2, c: 2 });
    expect(out.state.tiles[2][2].weed).toBeNull();
    let s = out.state;
    for (let i = 0; i < 2; i++) {
      s = plantAt(s, [filler[i]]).state;
      for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) expect(s.tiles[r][c].weed).toBeNull();
    }
  });

  it('Controlled Burn clears a row, destroys plants on it, and damages a nest by 1', () => {
    const g = createGame(level({ weeds: [{ r: 4, c: 0, type: 'creeping' }], nests: [{ r: 4, c: 7 }], tools: { burn: 1 } }), 1);
    const planted = plantAt(g, [[4, 3]]).state;
    const out = resolve(planted, { type: 'tool', tool: 'burn', r: 4, c: 3, axis: 'row' });
    expect(out.state.tiles[4][0].weed).toBeNull();
    expect(out.state.tiles[4][3].plant).toBeNull();
    expect(out.state.tiles[4][7].nest!.hp).toBe(2);
    expect(out.events).toContainEqual({ type: 'destroyed', cells: [{ r: 4, c: 3 }] });
  });

  it('burning a protected flower loses the level', () => {
    const g = createGame(
      level({
        plants: [{ r: 4, c: 4, species: 'lily', stage: 2 }],
        objectives: [{ kind: 'protect', r: 4, c: 4 }, { kind: 'score', target: 99999 }],
        tools: { burn: 1 },
      }),
      1,
    );
    const out = resolve(g, { type: 'tool', tool: 'burn', r: 4, c: 0, axis: 'row' });
    expect(out.state.status).toBe('lost');
  });
});

describe('Bloom Burst defence', () => {
  const roses = (n: number) => Array.from({ length: n }, (_, c) => ({ r: 4, c, species: 'rose' as const, stage: 2 as const }));

  it('clears orthogonal weeds and cures infested plants next to the pattern, but not diagonals', () => {
    const g = createGame(
      level({
        plants: [...roses(4), { r: 5, c: 2, species: 'daisy', stage: 3 }],
        weeds: [{ r: 3, c: 1, type: 'creeping' }, { r: 3, c: 4, type: 'creeping' }],
        creepInterval: 99,
      }),
      1,
    );
    g.tiles[5][2].plant!.infested = 'creeping';
    const out = plantAt(g, [[7, 7]], 'tulip');
    expect(out.events.find((e) => e.type === 'burst')).toBeDefined();
    expect(out.state.tiles[3][1].weed).toBeNull();
    expect(out.state.tiles[3][4].weed).toBe('creeping'); // diagonal of a 4-flower pattern
    expect(out.state.tiles[5][2].plant!.infested).toBeNull();
    const scored = out.events.find((e) => e.type === 'scored')!;
    expect(scored.type === 'scored' && scored.points).toBe(300 + WEED_POINTS + RESCUE_POINTS);
  });

  it('reaches diagonals for patterns of 5 or more', () => {
    const g = createGame(level({ plants: roses(5), weeds: [{ r: 3, c: 5, type: 'creeping' }], creepInterval: 99 }), 1);
    const out = plantAt(g, [[7, 7]], 'tulip');
    expect(out.state.tiles[3][5].weed).toBeNull();
  });
});

describe('Root Nest', () => {
  it('spawns a creeping weed every 2 plantings toward its telegraph', () => {
    const g = createGame(level({ nests: [{ r: 0, c: 0 }], creepInterval: 99 }), 4);
    const t = g.telegraphs.find((x) => x.source === 'nest')!;
    const one = plantAt(g, [filler[0]]).state;
    expect(one.tiles[t.r][t.c].weed).toBeNull();
    const two = plantAt(one, [filler[1]]);
    expect(two.state.tiles[t.r][t.c].weed).toBe('creeping');
    expect(two.events).toContainEqual({ type: 'spread', r: t.r, c: t.c, weed: 'creeping', source: 'nest' });
  });

  it('is destroyed by burns and wins a nests objective', () => {
    const g = createGame(level({ nests: [{ r: 0, c: 0, hp: 1 }], objectives: [{ kind: 'nests' }], tools: { burn: 1 } }), 1);
    const out = resolve(plantAt(g, [[7, 7]]).state, { type: 'tool', tool: 'burn', r: 0, c: 4, axis: 'row' });
    expect(out.state.tiles[0][0].nest).toBeNull();
    expect(out.state.status).toBe('won');
  });
});

describe('aggressive weeds and ticks', () => {
  const aggro = level({ weeds: [{ r: 0, c: 0, type: 'aggressive' }], aggressiveMs: 10000 });

  it('do nothing before the first planting', () => {
    const g = createGame(aggro, 1);
    const out = resolve(g, { type: 'tick', ms: 60000 });
    expect(out.state).toBe(g);
  });

  it('spread on the timer, without growing plants', () => {
    const g = plantAt(createGame(aggro, 1), [[7, 7]]).state;
    const t = g.telegraphs[0];
    const a = resolve(g, { type: 'tick', ms: 9000 }).state;
    expect(a.tiles[t.r][t.c].weed).toBeNull();
    const b = resolve(a, { type: 'tick', ms: 1000 });
    expect(b.state.tiles[t.r][t.c].weed).toBe('aggressive');
    expect(b.state.tiles[7][7].plant!.stage).toBe(1);
    expect(b.state.aggroMs).toBe(10000);
  });

  it('creeping weeds ignore the timer', () => {
    const g = plantAt(createGame(level({ weeds: [{ r: 0, c: 0, type: 'creeping' }] }), 1), [[7, 7]]).state;
    const out = resolve(g, { type: 'tick', ms: 60000 });
    expect(out.events).toHaveLength(0);
  });
});

describe('out of space', () => {
  const tiny = (tools: LevelDef['tools']) =>
    level({
      mask: ['..######', '########', '########', '########', '########', '########', '########', '########'],
      weeds: [{ r: 0, c: 0, type: 'creeping' }],
      creepInterval: 99,
      tools,
    });

  it('prompts for a tool instead of losing when one can help', () => {
    const out = plantAt(createGame(tiny({ pull: 1 }), 1), [[0, 1]]);
    expect(out.state.status).toBe('playing');
    expect(out.events).toContainEqual({ type: 'stuck' });
  });

  it('loses when no tool can help', () => {
    const out = plantAt(createGame(tiny({}), 1), [[0, 1]]);
    expect(out.state.status).toBe('lost');
  });
});

describe('protect objective', () => {
  it('loses when the guarded flower is choked', () => {
    const g = createGame(
      level({
        plants: [{ r: 0, c: 1, species: 'lily', stage: 1 }],
        weeds: [{ r: 0, c: 0, type: 'creeping' }],
        mask: ['..######', '########', '########', '########', '########', '########', '########', '########'].map(
          (row, r) => (r >= 4 ? '........' : row),
        ),
        objectives: [{ kind: 'protect', r: 0, c: 1 }, { kind: 'score', target: 99999 }],
        creepInterval: 1,
      }),
      1,
    );
    const out = plantAt(g, [[7, 7], [7, 5], [7, 3]]);
    expect(out.state.status).toBe('lost');
    expect(out.state.endReason).toMatch(/protecting/);
  });
});

describe('determinism with weeds', () => {
  function run(seed: number) {
    let s = createGame(ENDLESS, seed);
    const log: string[] = [];
    for (let i = 0; i < 120 && s.status === 'playing'; i++) {
      let action: Action;
      if (i % 5 === 4) action = { type: 'tick', ms: 4000 };
      else {
        const open: [number, number][] = [];
        s.tiles.forEach((row, r) => row.forEach((t, c) => !t.plant && !t.weed && !t.nest && open.push([r, c])));
        if (!open.length) break;
        const [r, c] = open[(i * 11) % open.length];
        action = { type: 'plant', slot: i % 3, r, c };
      }
      const before = JSON.stringify(s.tiles);
      const out = resolve(s, action);
      expect(JSON.stringify(s.tiles)).toBe(before); // input not mutated
      s = out.state;
      log.push(JSON.stringify(out.events));
    }
    return { s, log };
  }

  it('replays identically from the same seed', () => {
    const a = run(42);
    const b = run(42);
    expect(a.log).toEqual(b.log);
    expect(a.s.score).toBe(b.s.score);
    expect(a.s.hadWeeds).toBe(true); // Endless spawned weeds during the run
  });
});
