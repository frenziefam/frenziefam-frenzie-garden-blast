import { createGame, forecast, resolve } from '../src/core/rules';
import { LEVELS, ENDLESS } from '../src/core/levels';
import { orientations, TEMPLATES, detectPatterns } from '../src/core/patterns';
import { Action, GameState, LevelDef, Species } from '../src/core/types';

const open = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 't',
  name: 'Test',
  mode: 'campaign',
  intro: '',
  blueprints: [],
  objectives: [{ kind: 'score', target: 999999 }],
  weights: { rose: 1 },
  moveLimit: 99,
  compost: 2,
  freeform: true,
  stars: [1, 2, 3],
  ...over,
});

/** Plants the given species at each cell in order, forcing the conveyor so tests control the seed. */
function play(state: GameState, steps: [Species, number, number][]) {
  let s = state;
  const all = [];
  for (const [sp, r, c] of steps) {
    s = { ...s, conveyor: [sp, s.conveyor[1], s.conveyor[2]] };
    const out = resolve(s, { type: 'plant', slot: 0, r, c });
    s = out.state;
    all.push(...out.events);
  }
  return { state: s, events: all };
}

describe('growth (approved rules)', () => {
  it('follows the approved example sequence', () => {
    const g = createGame(open({ freeform: false }), 1);
    const { state } = play(g, [
      ['rose', 0, 0],
      ['sunflower', 0, 2],
      ['tulip', 0, 4],
    ]);
    expect(state.tiles[0][0].plant!.stage).toBe(3);
    expect(state.tiles[0][2].plant!.stage).toBe(2);
    expect(state.tiles[0][4].plant!.stage).toBe(1);
    const next = play(state, [
      ['daisy', 7, 7],
      ['daisy', 7, 5],
    ]).state;
    expect([next.tiles[0][0], next.tiles[0][2], next.tiles[0][4]].map((t) => t.plant!.stage)).toEqual([3, 3, 3]);
  });

  it('does not grow plants on rejected placements or compost', () => {
    const g = play(createGame(open(), 1), [['rose', 0, 0]]).state;
    const bad = resolve(g, { type: 'plant', slot: 1, r: 0, c: 0 });
    expect(bad.events[0].type).toBe('rejected');
    expect(bad.state).toBe(g);
    const comp = resolve(g, { type: 'compost', slot: 1 });
    expect(comp.state.tiles[0][0].plant!.stage).toBe(1);
    expect(comp.state.move).toBe(1);
    expect(comp.state.compostLeft).toBe(1);
  });

  it('never mutates the input state', () => {
    const g = createGame(open(), 7);
    const before = JSON.stringify(g);
    resolve(g, { type: 'plant', slot: 0, r: 3, c: 3 });
    expect(JSON.stringify(g)).toBe(before);
  });

  it('rejects blocked tiles', () => {
    const g = createGame(LEVELS[0], 1);
    expect(resolve(g, { type: 'plant', slot: 0, r: 0, c: 0 }).events[0].type).toBe('rejected');
  });
});

describe('patterns', () => {
  it('has the expected orientation counts', () => {
    const counts = Object.fromEntries(TEMPLATES.map((t) => [t.kind, t.shapes.length]));
    expect(counts).toEqual({ ring: 1, cross: 1, line5: 2, lshape: 4, tshape: 4, square: 1, line4: 2 });
    expect(orientations([{ r: 0, c: 0 }, { r: 0, c: 1 }]).length).toBe(2);
  });

  it('mature flowers merely touching do not clear (3 in a row free-form)', () => {
    const { state, events } = play(createGame(open(), 1), [
      ['rose', 0, 0],
      ['rose', 0, 1],
      ['rose', 0, 2],
      ['daisy', 7, 7],
      ['daisy', 7, 5],
    ]);
    expect(events.some((e) => e.type === 'burst')).toBe(false);
    expect(state.tiles[0][2].plant!.stage).toBe(3);
  });

  it('a line of 4 bursts when its last flower matures', () => {
    const { state, events } = play(createGame(open(), 1), [
      ['rose', 0, 0],
      ['rose', 0, 1],
      ['rose', 0, 2],
      ['rose', 0, 3],
      ['daisy', 7, 7],
      ['daisy', 7, 5],
    ]);
    const bursts = events.filter((e) => e.type === 'burst');
    expect(bursts).toHaveLength(1);
    expect(state.tiles[0][0].plant).toBeNull();
    expect(state.score).toBe(300);
  });

  it('keystone planting turns a line of 5 into one big pattern', () => {
    const { events } = play(createGame(open(), 1), [
      ['rose', 0, 0],
      ['rose', 0, 1],
      ['rose', 0, 3],
      ['rose', 0, 4],
      ['rose', 0, 2], // keystone last
      ['daisy', 7, 7],
      ['daisy', 7, 5],
    ]);
    const bursts = events.flatMap((e) => (e.type === 'burst' ? [e.burst] : []));
    expect(bursts.map((b) => b.kind)).toEqual(['line5']);
  });

  it('chooses the bigger pattern when candidates overlap', () => {
    // An L-shape and a line of 4 sharing flowers mature together: the L wins.
    const g = createGame(open(), 1);
    const tiles = g.tiles;
    const put = (r: number, c: number, stage: 1 | 2 | 3, id: number) => (tiles[r][c].plant = { id, species: 'rose', stage });
    put(0, 0, 3, 1);
    put(1, 0, 3, 2);
    put(2, 0, 3, 3);
    put(2, 1, 3, 4);
    put(2, 2, 3, 5);
    put(2, 3, 3, 6);
    const bursts = detectPatterns(g, new Set([5]));
    expect(bursts[0].kind).toBe('lshape');
    expect(bursts).toHaveLength(1);
  });

  it('completes a campaign blueprint and wins with the Final Bloom bonus', () => {
    const g = createGame(LEVELS[0], 1);
    const { state } = play(g, [
      ['rose', 3, 2],
      ['rose', 3, 3],
      ['rose', 3, 4],
      ['daisy', 1, 1],
      ['daisy', 1, 2],
    ]);
    expect(state.status).toBe('won');
    expect(state.score).toBe(100 + 5 * 100);
    expect(state.stars).toBe(3);
    expect(state.bloomed).toEqual(['rose']);
  });

  it('wrong species in a blueprint slot grows but does not complete it', () => {
    const { state } = play(createGame(LEVELS[0], 1), [
      ['daisy', 3, 2],
      ['rose', 3, 3],
      ['rose', 3, 4],
      ['daisy', 1, 1],
      ['daisy', 1, 2],
    ]);
    expect(state.tiles[3][2].plant!.stage).toBe(3);
    expect(state.status).toBe('playing');
  });

  it('forecast marks tiles that bloom on the next planting', () => {
    const { state } = play(createGame(LEVELS[0], 1), [
      ['rose', 3, 2],
      ['rose', 3, 3],
      ['rose', 3, 4],
      ['daisy', 1, 1],
    ]);
    expect([...forecast(state)].sort()).toEqual(['3,2', '3,3', '3,4']);
  });
});

describe('conveyor and determinism', () => {
  it('only refills the used slot', () => {
    const g = createGame(LEVELS[3], 42);
    const out = resolve(g, { type: 'plant', slot: 1, r: 6, c: 0 });
    expect(out.state.conveyor[0]).toBe(g.conveyor[0]);
    expect(out.state.conveyor[2]).toBe(g.conveyor[2]);
  });

  it('same seed and actions give the same game', () => {
    const actions: Action[] = [
      { type: 'plant', slot: 0, r: 0, c: 0 },
      { type: 'plant', slot: 2, r: 0, c: 1 },
      { type: 'compost', slot: 1 },
      { type: 'plant', slot: 1, r: 4, c: 4 },
    ];
    const run = () => actions.reduce((s, a) => resolve(s, a).state, createGame(ENDLESS, 99));
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('never shows the same species in all three slots (bag levels)', () => {
    let s = createGame(ENDLESS, 5);
    for (let i = 0; i < 60 && s.status === 'playing'; i++) {
      expect(new Set(s.conveyor).size).toBeGreaterThan(1);
      const empty: [number, number][] = [];
      s.tiles.forEach((row, r) => row.forEach((t, c) => !t.plant && empty.push([r, c])));
      const [r, c] = empty[(i * 7) % empty.length];
      s = resolve(s, { type: 'plant', slot: i % 3, r, c }).state;
    }
  });

  it('drought guarantee brings a needed species within 6 draws', () => {
    const level = open({
      freeform: false,
      weights: { daisy: 20, rose: 1 },
      blueprints: [{ id: 'b', name: 'b', cells: [{ r: 0, c: 0, species: 'rose' }] }],
      objectives: [{ kind: 'blueprint', blueprintId: 'b', count: 1 }],
    });
    for (let seed = 1; seed <= 30; seed++) {
      let s = createGame(level, seed);
      let seen = s.conveyor.includes('rose');
      for (let i = 0; i < 6 && !seen; i++) {
        s = resolve(s, { type: 'plant', slot: 0, r: 7, c: i }).state;
        seen = s.conveyor.includes('rose');
      }
      expect(seen).toBe(true);
    }
  });

  it('runs out of moves into a loss', () => {
    let s = createGame(open({ moveLimit: 2, freeform: false }), 1);
    s = resolve(s, { type: 'plant', slot: 0, r: 0, c: 0 }).state;
    const out = resolve(s, { type: 'plant', slot: 0, r: 0, c: 1 });
    expect(out.state.status).toBe('lost');
  });

  it('ends an Endless run when the garden is full', () => {
    let s = createGame({ ...ENDLESS, mask: ['#.######', ...Array(7).fill('########')] }, 1);
    s = resolve(s, { type: 'plant', slot: 0, r: 0, c: 1 }).state;
    expect(s.status).toBe('lost');
    expect(s.endReason).toBe('The garden is full.');
  });
});
