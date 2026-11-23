import { boardCells, cellPosition, columnsFor, countKinds, editorColumnsFor, nextKind, randomBoard, rowCount, stackOffsets, tokenPlaces } from '../src/board';
import { initial, TOKEN_COLORS } from '../src/colors';
import { PLAYER_COLORS, MAX_PLAYERS } from '../src/types';
import { makeView } from './helpers';

describe('board layout', () => {
  it('snakes: first row left to right, second right to left', () => {
    expect(cellPosition(0, 10)).toEqual({ row: 0, col: 0 });
    expect(cellPosition(9, 10)).toEqual({ row: 0, col: 9 });
    expect(cellPosition(10, 10)).toEqual({ row: 1, col: 9 });
    expect(cellPosition(19, 10)).toEqual({ row: 1, col: 0 });
    expect(cellPosition(20, 10)).toEqual({ row: 2, col: 0 });
  });

  it('has one space for the start and one for every step up to the goal', () => {
    const cells = boardCells(60, 20);
    expect(cells).toHaveLength(61);
    expect(cells.map((c) => c.index)).toEqual(Array.from({ length: 61 }, (_, i) => i));
    expect(rowCount(60, 20)).toBe(4);
    expect(rowCount(59, 20)).toBe(3);
    // no two spaces in the same place
    expect(new Set(cells.map((c) => `${c.row}/${c.col}`)).size).toBe(61);
  });

  it('puts every space next to the one before it, and links them', () => {
    for (const cols of [8, 12, 20]) {
      const cells = boardCells(150, cols);
      for (let i = 1; i < cells.length; i++) {
        const distance = Math.abs(cells[i].row - cells[i - 1].row) + Math.abs(cells[i].col - cells[i - 1].col);
        expect(distance).toBe(1);
      }
    }
    const cells = boardCells(25, 10);
    expect(cells[0].links).toEqual(['right']);
    expect(cells[5].links).toEqual(['left', 'right']);
    expect(cells[9].links).toEqual(['left', 'down']);
    expect(cells[10].links).toEqual(['up', 'left']);
    expect(cells[15].links).toEqual(['right', 'left']);
    expect(cells[19].links).toEqual(['right', 'down']);
    expect(cells[25].links).toEqual(['left']);
  });

  it('uses fewer columns on narrow screens, and avoids leaving the finish alone on a row', () => {
    expect(columnsFor(375, 60)).toBe(9); // 61 spaces: 6 rows of 9 and a last row of 7
    expect(columnsFor(800, 60)).toBe(13);
    expect(columnsFor(1280, 60)).toBe(21); // rows of 21, 21 and 19
    expect(columnsFor(1280, 30)).toBe(17);
    expect(columnsFor(1280, 99)).toBe(20); // 100 spaces fill 5 rows of 20 exactly
    for (const goal of [20, 30, 60, 100, 150, 300]) {
      for (const width of [375, 800, 1280]) {
        const cols = columnsFor(width, goal);
        expect(((goal + 1) % cols || cols) / cols).toBeGreaterThanOrEqual(0.5);
      }
    }
  });
});

describe('tokens on the board', () => {
  it('puts each player on the space of their score', () => {
    const view = makeView(); // Ana 5, Bob 15, Cy 0
    const places = tokenPlaces(view.players, 60, 10);
    expect(places.map((p) => [p.player.name, p.row, p.col])).toEqual([
      ['Ana', 0, 5],
      ['Bob', 1, 4],
      ['Cy', 0, 0],
    ]);
    expect(places.every((p) => p.dx === 0 && p.dy === 0)).toBe(true);
  });

  it('spreads players who share a space so that all stay visible', () => {
    const view = makeView();
    view.players.forEach((p) => (p.position = 7));
    const places = tokenPlaces(view.players, 60, 10, { width: 50, height: 40, token: 20 });
    expect(places.map((p) => [p.dx, p.dy])).toEqual([
      [-8.5, -6],
      [8.5, -6],
      [0, 6],
    ]);
  });

  it('keeps a full room inside one space, never two tokens in the same spot', () => {
    const space = { width: 54, height: 40, token: 24 };
    for (let n = 1; n <= 12; n++) {
      const offsets = stackOffsets(n, space);
      expect(new Set(offsets.map((o) => `${o.dx}/${o.dy}`)).size).toBe(n);
      for (const o of offsets) {
        expect(Math.abs(o.dx) + space.token / 2).toBeLessThanOrEqual(space.width / 2 + 0.001);
        expect(Math.abs(o.dy) + space.token / 2).toBeLessThanOrEqual(space.height / 2 + 0.001);
      }
    }
    expect(stackOffsets(1, space)).toEqual([{ dx: 0, dy: 0 }]);
    expect(stackOffsets(2, space)).toEqual([
      { dx: -10.2, dy: 0 },
      { dx: 10.2, dy: 0 },
    ]);
    expect(new Set(stackOffsets(12, space).map((o) => o.dy)).size).toBe(3);
  });

  it('keeps a token on the track whatever the score says', () => {
    const view = makeView();
    view.players[0].position = 999;
    expect(tokenPlaces(view.players, 60, 10)[0]).toMatchObject(cellPosition(60, 10));
  });
});

describe('token colours', () => {
  it('has a paint for every colour the server knows, one per seat', () => {
    expect(Object.keys(TOKEN_COLORS).sort()).toEqual([...PLAYER_COLORS].sort());
    expect(PLAYER_COLORS).toHaveLength(MAX_PLAYERS);
    expect(new Set(Object.values(TOKEN_COLORS).map((c) => c.bg)).size).toBe(PLAYER_COLORS.length);
  });

  it('uses the first letter of the name, in capitals', () => {
    expect(initial('ana')).toBe('A');
    expect(initial('  érica')).toBe('É');
    expect(initial('')).toBe('?');
  });
});

describe('board editor helpers', () => {
  it('uses fewer, larger spaces per row in the options window on a small screen', () => {
    expect(editorColumnsFor(360, 60)).toBe(7); // 61 spaces: 8 rows of 7 and one of 5
    expect(editorColumnsFor(360, 30)).toBe(8); // 31: 3 rows of 8 and one of 7
    expect(editorColumnsFor(800, 60)).toBe(9); // 61 spaces: 6 rows of 9 and one of 7
    expect(editorColumnsFor(1280, 60)).toBe(13);
    for (const goal of [20, 30, 60, 100, 150, 300]) {
      for (const width of [360, 800, 1280]) {
        const cols = editorColumnsFor(width, goal);
        expect(((goal + 1) % cols || cols) / cols).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it('turns a space into the next kind on each click, and back to normal after the last', () => {
    const seen: (string | undefined)[] = [];
    let kind = nextKind(undefined);
    for (let i = 0; i < 6; i++) {
      seen.push(kind);
      kind = nextKind(kind);
    }
    expect(seen).toEqual(['individual', 'back', 'forward', 'dead', 'win', undefined]);
  });

  it('fills a board at random with the numbers asked, on different spaces between start and finish', () => {
    const board = randomBoard(30, { individual: 1, back: 1, forward: 1, dead: 1, win: 1 });
    expect(countKinds(board)).toEqual({ individual: 1, back: 1, forward: 1, dead: 1, win: 1 });
    expect(new Set(board.map((s) => s.index)).size).toBe(5);
    expect(board.every((s) => s.index >= 1 && s.index <= 29)).toBe(true);
    expect(board.map((s) => s.index)).toEqual([...board.map((s) => s.index)].sort((a, b) => a - b));
  });
});

