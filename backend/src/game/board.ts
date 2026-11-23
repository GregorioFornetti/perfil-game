import { Rng, shuffle } from './shuffle';
import { defaultSpecialCounts, SPECIAL_KINDS, SpecialCounts, SpecialKind, SpecialSpace } from '../types';

/** The default number of special spaces of each kind (see defaultSpecialCounts). */
export const specialCounts = defaultSpecialCounts;

/** Places the given numbers of special spaces at random on the track (spaces 1 to goal-1), sorted by space. */
export function randomLayout(goal: number, rng: Rng, counts: SpecialCounts = defaultSpecialCounts(goal)): SpecialSpace[] {
  const kinds = SPECIAL_KINDS.flatMap((kind) => Array<SpecialKind>(counts[kind]).fill(kind));
  const spaces = shuffle(
    Array.from({ length: Math.max(0, goal - 1) }, (_, i) => i + 1),
    rng,
  );
  return kinds
    .slice(0, spaces.length)
    .map((kind, i) => ({ index: spaces[i], kind }))
    .sort((a, b) => a.index - b.index);
}

export type Layout = (goal: number, rng: Rng, counts: SpecialCounts) => SpecialSpace[];
