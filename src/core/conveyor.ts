// Seed generation (GDD section E2): authored script first, then a seeded weighted bag
// with a drought guarantee and a no-triples rule. Functions mutate the working state passed in.

import { shuffle } from './rng';
import { ALL_SPECIES, GameState, Species } from './types';

export const CAMPAIGN_DROUGHT = 5;
export const ENDLESS_DROUGHT = 6;

/** Species in play. Endless adds one species per difficulty tier (GDD D4). */
export function activeSpecies(state: GameState): Species[] {
  const listed = ALL_SPECIES.filter((s) => (state.level.weights[s] ?? 0) > 0);
  if (state.level.mode !== 'endless') return listed;
  const m = state.move;
  const count = m <= 25 ? 3 : m <= 75 ? 4 : m <= 100 ? 5 : 6;
  return listed.slice(0, Math.max(1, Math.min(count, listed.length)));
}

function refillBag(state: GameState): void {
  const tokens: Species[] = [];
  for (const s of activeSpecies(state)) {
    const w = state.level.weights[s] ?? 0;
    for (let i = 0; i < w; i++) tokens.push(s);
  }
  const [bag, rng] = shuffle(tokens, state.rng);
  state.bag = bag;
  state.rng = rng;
}

function takeFromBag(state: GameState): Species {
  if (state.bag.length === 0) refillBag(state);
  return state.bag.shift() as Species;
}

/** Species still needed by an unfinished blueprint slot, in blueprint order. */
export function neededSpecies(state: GameState): Species[] {
  const out: Species[] = [];
  for (const bp of state.level.blueprints) {
    for (const cell of bp.cells) {
      const plant = state.tiles[cell.r][cell.c].plant;
      if (plant && plant.species === cell.species) continue;
      if (!out.includes(cell.species)) out.push(cell.species);
    }
  }
  return out;
}

function droughtPick(state: GameState, slot: number): Species | null {
  const campaign = state.level.mode === 'campaign';
  const limit = campaign ? CAMPAIGN_DROUGHT : ENDLESS_DROUGHT;
  const candidates = campaign ? neededSpecies(state) : activeSpecies(state);
  const onConveyor = state.conveyor.filter((_, i) => i !== slot);
  for (const s of candidates) {
    if (onConveyor.includes(s)) continue;
    const last = state.lastDrawn[s] ?? -1;
    if (last < state.draws - limit) return s;
  }
  return null;
}

/** Draws the next seed for a conveyor slot. */
export function drawSeed(state: GameState, slot: number): Species {
  let species: Species;
  const script = state.level.script;
  if (script && state.scriptIndex < script.length) {
    species = script[state.scriptIndex++];
  } else {
    species = droughtPick(state, slot) ?? takeFromBag(state);
    const others = state.conveyor.filter((_, i) => i !== slot);
    if (others.length === 2 && others.every((o) => o === species)) {
      species = takeFromBag(state);
    }
  }
  state.lastDrawn[species] = state.draws;
  state.draws += 1;
  return species;
}
