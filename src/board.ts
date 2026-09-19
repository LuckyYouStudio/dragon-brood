// Pure match-3 rules. No rendering, no timing — the view animates what these return.

export const COLS = 7;
export const ROWS = 7;
export const COLORS = 6;

export type Cell = { c: number; r: number };
export type Grid = number[][]; // grid[r][c] = color 0..COLORS-1, -1 = empty

const rand = (n: number) => Math.floor(Math.random() * n);

export function findMatches(grid: Grid): Cell[] {
  const hit = new Set<number>();
  for (let r = 0; r < ROWS; r++) {
    let run = 1;
    for (let c = 1; c <= COLS; c++) {
      const same = c < COLS && grid[r][c] >= 0 && grid[r][c] === grid[r][c - 1];
      if (same) run++;
      else {
        if (run >= 3) for (let k = c - run; k < c; k++) hit.add(r * COLS + k);
        run = 1;
      }
    }
  }
  for (let c = 0; c < COLS; c++) {
    let run = 1;
    for (let r = 1; r <= ROWS; r++) {
      const same = r < ROWS && grid[r][c] >= 0 && grid[r][c] === grid[r - 1][c];
      if (same) run++;
      else {
        if (run >= 3) for (let k = r - run; k < r; k++) hit.add(k * COLS + c);
        run = 1;
      }
    }
  }
  return [...hit].map(i => ({ c: i % COLS, r: Math.floor(i / COLS) }));
}

export function swapCells(grid: Grid, a: Cell, b: Cell): void {
  const t = grid[a.r][a.c];
  grid[a.r][a.c] = grid[b.r][b.c];
  grid[b.r][b.c] = t;
}

export function findMove(grid: Grid): [Cell, Cell] | null {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      for (const [dc, dr] of [[1, 0], [0, 1]]) {
        const c2 = c + dc;
        const r2 = r + dr;
        if (c2 >= COLS || r2 >= ROWS) continue;
        const a = { c, r };
        const b = { c: c2, r: r2 };
        swapCells(grid, a, b);
        const ok = findMatches(grid).length > 0;
        swapCells(grid, a, b);
        if (ok) return [a, b];
      }
    }
  }
  return null;
}

/** A fresh board with no standing matches and at least one available move. */
export function newGrid(): Grid {
  for (;;) {
    const grid: Grid = [];
    for (let r = 0; r < ROWS; r++) {
      grid.push([]);
      for (let c = 0; c < COLS; c++) {
        let color: number;
        do color = rand(COLORS);
        while (
          (c >= 2 && grid[r][c - 1] === color && grid[r][c - 2] === color) ||
          (r >= 2 && grid[r - 1][c] === color && grid[r - 2][c] === color)
        );
        grid[r].push(color);
      }
    }
    if (findMove(grid)) return grid;
  }
}

export type Drop = { c: number; fromR: number; toR: number; color: number };

/** Collapses columns and refills from above. `fromR` is negative for new eggs. */
export function collapse(grid: Grid): Drop[] {
  const drops: Drop[] = [];
  for (let c = 0; c < COLS; c++) {
    let write = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (grid[r][c] < 0) continue;
      if (write !== r) {
        grid[write][c] = grid[r][c];
        grid[r][c] = -1;
        drops.push({ c, fromR: r, toR: write, color: grid[write][c] });
      }
      write--;
    }
    const missing = write + 1;
    for (let r = write; r >= 0; r--) {
      const color = rand(COLORS);
      grid[r][c] = color;
      drops.push({ c, fromR: r - missing, toR: r, color });
    }
  }
  return drops;
}

/** Heat one clear is worth: every egg counts once per chain step, long lines earn a bonus. */
export function heatFor(count: number, combo: number): number {
  return count * combo + (count >= 5 ? 5 : count === 4 ? 2 : 0);
}

export function adjacent(a: Cell, b: Cell): boolean {
  return Math.abs(a.c - b.c) + Math.abs(a.r - b.r) === 1;
}
