import { SPECIAL_KINDS, type PlayerView, type SpecialCounts, type SpecialKind, type SpecialSpace } from './types';

// Geometry of the board: a track of spaces numbered from 0 (start) to the goal (finish),
// laid out in rows that snake left-to-right, then right-to-left, like a board game path.

export type Side = 'left' | 'right' | 'up' | 'down';

export interface BoardCell {
  index: number;
  row: number;
  col: number;
  /** Sides on which the path continues to the previous / next space. */
  links: Side[];
}

export interface TokenPlace {
  player: PlayerView;
  row: number;
  col: number;
  /** Offset from the middle of the space, in pixels, so that tokens sharing a space stay visible. */
  dx: number;
  dy: number;
}

export function cellPosition(index: number, cols: number): { row: number; col: number } {
  const row = Math.floor(index / cols);
  const inRow = index % cols;
  return { row, col: row % 2 === 0 ? inRow : cols - 1 - inRow };
}

export function rowCount(goal: number, cols: number): number {
  return Math.ceil((goal + 1) / cols);
}

function sideTowards(from: { row: number; col: number }, to: { row: number; col: number }): Side {
  if (to.row > from.row) return 'down';
  if (to.row < from.row) return 'up';
  return to.col > from.col ? 'right' : 'left';
}

export function boardCells(goal: number, cols: number): BoardCell[] {
  const cells: BoardCell[] = [];
  for (let index = 0; index <= goal; index++) {
    const here = cellPosition(index, cols);
    const links: Side[] = [];
    if (index > 0) links.push(sideTowards(here, cellPosition(index - 1, cols)));
    if (index < goal) links.push(sideTowards(here, cellPosition(index + 1, cols)));
    cells.push({ index, ...here, links });
  }
  return cells;
}

/** Sizes, in pixels, that decide how tokens sharing a space are spread inside it. */
export interface SpaceSize {
  width: number;
  height: number;
  token: number;
}

export const DEFAULT_SPACE: SpaceSize = { width: 44, height: 44, token: 24 };

/**
 * Offsets for n tokens sharing one space: side by side, then on further lines. They are kept
 * inside the space, overlapping more the more of them there are.
 */
export function stackOffsets(n: number, space: SpaceSize = DEFAULT_SPACE): { dx: number; dy: number }[] {
  const perLine = n <= 2 ? n : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const lines = Math.ceil(n / perLine);
  const room = (size: number, count: number) => (count > 1 ? (size - space.token) / (count - 1) : 0);
  const stepX = Math.max(5, Math.min(space.token * 0.85, room(space.width, perLine)));
  const stepY = Math.max(4, Math.min(space.token * 0.6, room(space.height, lines)));
  return Array.from({ length: n }, (_, i) => {
    const line = Math.floor(i / perLine);
    const inThisLine = line === lines - 1 ? n - perLine * (lines - 1) : perLine;
    return {
      dx: ((i % perLine) - (inThisLine - 1) / 2) * stepX,
      dy: (line - (lines - 1) / 2) * stepY,
    };
  });
}

/** Where each player's token goes. Positions beyond the ends of the track are pulled back onto it. */
export function tokenPlaces(players: PlayerView[], goal: number, cols: number, size: SpaceSize = DEFAULT_SPACE): TokenPlace[] {
  const bySpace = new Map<number, PlayerView[]>();
  for (const p of players) {
    const space = Math.max(0, Math.min(goal, p.position));
    bySpace.set(space, [...(bySpace.get(space) ?? []), p]);
  }
  const places: TokenPlace[] = [];
  for (const [space, group] of bySpace) {
    const offsets = stackOffsets(group.length, size);
    group.forEach((player, i) => places.push({ player, ...cellPosition(space, cols), ...offsets[i] }));
  }
  // same order as the players, so a token keeps its element (and slides) when it moves
  return places.sort((a, b) => players.indexOf(a.player) - players.indexOf(b.player));
}

/**
 * How many spaces to put in a row: a number that suits the width of the screen and, within
 * that, the one that leaves the last row of the track fullest (so the finish is not left alone).
 */
export function columnsFor(width: number, goal: number): number {
  const [min, max] = width < 640 ? [7, 9] : width < 1024 ? [11, 14] : [17, 21];
  return bestColumns(min, max, goal);
}

/** Spaces per row for the board editor in the options window, which is narrower than the game board. */
export function editorColumnsFor(width: number, goal: number): number {
  const [min, max] = width < 640 ? [6, 8] : width < 1024 ? [8, 11] : [10, 14];
  return bestColumns(min, max, goal);
}

/** Of the column counts from min to max, the one that leaves the last row of the track fullest. */
export function bestColumns(min: number, max: number, goal: number): number {
  let best = max;
  let bestFill = -1;
  for (let cols = max; cols >= min; cols--) {
    const inLastRow = (goal + 1) % cols || cols;
    if (inLastRow / cols > bestFill) {
      best = cols;
      bestFill = inLastRow / cols;
    }
  }
  return best;
}

/** The kind a space becomes when clicked in the board editor: normal, then each special kind in turn, then normal again. */
export function nextKind(kind: SpecialKind | undefined): SpecialKind | undefined {
  const order: (SpecialKind | undefined)[] = [undefined, ...SPECIAL_KINDS];
  return order[(order.indexOf(kind) + 1) % order.length];
}

/** A board with the given numbers of special spaces placed at random on spaces 1 to goal-1. */
export function randomBoard(goal: number, counts: SpecialCounts, rng: () => number = Math.random): SpecialSpace[] {
  const spaces = Array.from({ length: Math.max(0, goal - 1) }, (_, i) => i + 1);
  for (let i = spaces.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [spaces[i], spaces[j]] = [spaces[j], spaces[i]];
  }
  const kinds = SPECIAL_KINDS.flatMap((kind) => Array<SpecialKind>(counts[kind]).fill(kind));
  return kinds
    .slice(0, spaces.length)
    .map((kind, i) => ({ index: spaces[i], kind }))
    .sort((a, b) => a.index - b.index);
}

/** How many special spaces of each kind a board has. */
export function countKinds(board: SpecialSpace[]): SpecialCounts {
  const counts = Object.fromEntries(SPECIAL_KINDS.map((k) => [k, 0])) as SpecialCounts;
  for (const s of board) counts[s.kind]++;
  return counts;
}
