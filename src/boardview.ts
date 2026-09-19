import { ELEMENTS, makeEggSprites } from './art';
import { sfx, unlock } from './audio';
import {
  COLS,
  ROWS,
  adjacent,
  collapse,
  findMatches,
  findMove,
  heatFor,
  newGrid,
  swapCells,
  type Cell,
  type Grid,
} from './board';

type Piece = {
  color: number;
  c: number;
  r: number;
  x: number; // render position in cell units
  y: number;
  vy: number;
  falling: boolean;
  scale: number;
  clearing: number; // 0 = alive, >0 = seconds into the clear animation
  wiggle: number;
};

export type ClearEvent = { cells: Array<{ x: number; y: number; color: number }>; combo: number; count: number; heat: number };

type Popup = { x: number; y: number; text: string; color: string; age: number; big: boolean };

const CLEAR_TIME = 0.22;
const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

export class BoardView {
  private ctx: CanvasRenderingContext2D;
  private grid: Grid = newGrid();
  private pieces: Piece[] = [];
  private sprites: HTMLCanvasElement[] = [];
  private cell = 0;
  private sizePx = 0;
  private busy = false;
  private selected: Cell | null = null;
  private dragFrom: { cell: Cell; x: number; y: number } | null = null;
  private idle = 0;
  private hintShown = false;
  private settleWaiters: Array<() => void> = [];
  private t = 0;
  private popups: Popup[] = [];

  onClear: (event: ClearEvent) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.spawnAll(true);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.sizePx = rect.width;
    this.cell = rect.width / COLS;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sprites = makeEggSprites(Math.max(16, Math.round(this.cell * dpr)));
  }

  private spawnAll(fromAbove: boolean): void {
    this.pieces = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        this.pieces.push({
          color: this.grid[r][c],
          c,
          r,
          x: c,
          y: fromAbove ? r - ROWS - c * 0.35 : r,
          vy: 0,
          falling: fromAbove,
          scale: 1,
          clearing: 0,
          wiggle: 0,
        });
      }
    }
  }

  private pieceAt(cell: Cell): Piece | undefined {
    return this.pieces.find(p => p.c === cell.c && p.r === cell.r && p.clearing === 0);
  }

  private cellFromEvent(event: PointerEvent): Cell | null {
    const rect = this.canvas.getBoundingClientRect();
    const c = Math.floor(((event.clientX - rect.left) / rect.width) * COLS);
    const r = Math.floor(((event.clientY - rect.top) / rect.height) * ROWS);
    return c >= 0 && c < COLS && r >= 0 && r < ROWS ? { c, r } : null;
  }

  private onDown = (event: PointerEvent): void => {
    unlock();
    this.idle = 0;
    this.clearHint();
    if (this.busy) return;
    const cell = this.cellFromEvent(event);
    if (!cell) return;
    this.canvas.setPointerCapture(event.pointerId);
    if (this.selected && adjacent(this.selected, cell)) {
      const from = this.selected;
      this.selected = null;
      void this.trySwap(from, cell);
      return;
    }
    this.selected = cell;
    this.dragFrom = { cell, x: event.clientX, y: event.clientY };
    sfx.select();
  };

  private onMove = (event: PointerEvent): void => {
    if (!this.dragFrom || this.busy) return;
    const dx = event.clientX - this.dragFrom.x;
    const dy = event.clientY - this.dragFrom.y;
    const threshold = this.cell * 0.35;
    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
    const from = this.dragFrom.cell;
    const to =
      Math.abs(dx) > Math.abs(dy)
        ? { c: from.c + Math.sign(dx), r: from.r }
        : { c: from.c, r: from.r + Math.sign(dy) };
    this.dragFrom = null;
    this.selected = null;
    if (to.c < 0 || to.c >= COLS || to.r < 0 || to.r >= ROWS) return;
    void this.trySwap(from, to);
  };

  private onUp = (): void => {
    this.dragFrom = null;
  };

  private async trySwap(a: Cell, b: Cell): Promise<void> {
    const pa = this.pieceAt(a);
    const pb = this.pieceAt(b);
    if (!pa || !pb) return;
    this.busy = true;
    sfx.swap();
    await this.animateSwap(pa, pb);
    swapCells(this.grid, a, b);
    if (findMatches(this.grid).length === 0) {
      swapCells(this.grid, a, b);
      sfx.invalid();
      await this.animateSwap(pa, pb);
      this.busy = false;
      return;
    }
    await this.resolve();
    this.busy = false;
  }

  private animateSwap(pa: Piece, pb: Piece): Promise<void> {
    const [ac, ar, bc, br] = [pa.c, pa.r, pb.c, pb.r];
    pa.c = bc;
    pa.r = br;
    pb.c = ac;
    pb.r = ar;
    const start = performance.now();
    const duration = 130;
    return new Promise(resolve => {
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / duration);
        const e = k * k * (3 - 2 * k);
        pa.x = ac + (bc - ac) * e;
        pa.y = ar + (br - ar) * e;
        pb.x = bc + (ac - bc) * e;
        pb.y = br + (ar - br) * e;
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      };
      step();
    });
  }

  private async resolve(): Promise<void> {
    let combo = 0;
    for (;;) {
      const matches = findMatches(this.grid);
      if (matches.length === 0) break;
      combo++;
      const rect = this.canvas.getBoundingClientRect();
      const cells = matches.map(cell => {
        const piece = this.pieceAt(cell)!;
        piece.clearing = 0.0001;
        this.grid[cell.r][cell.c] = -1;
        return {
          x: rect.left + (cell.c + 0.5) * (rect.width / COLS),
          y: rect.top + (cell.r + 0.5) * (rect.height / ROWS),
          color: piece.color,
        };
      });
      sfx.match(combo, matches.length);
      const heat = heatFor(matches.length, combo);
      const cx = matches.reduce((sum, cell) => sum + cell.c, 0) / matches.length + 0.5;
      const cy = matches.reduce((sum, cell) => sum + cell.r, 0) / matches.length + 0.5;
      this.popups.push({ x: cx, y: cy, text: `+${heat}`, color: ELEMENTS[cells[0].color].light, age: 0, big: false });
      if (combo >= 2) this.popups.push({ x: cx, y: cy - 0.55, text: `×${combo}`, color: '#ffd24a', age: 0, big: true });
      this.onClear({ cells, combo, count: matches.length, heat });
      await wait(CLEAR_TIME * 1000);
      this.pieces = this.pieces.filter(p => p.clearing === 0);

      for (const drop of collapse(this.grid)) {
        if (drop.fromR >= 0) {
          const piece = this.pieces.find(p => p.c === drop.c && p.r === drop.fromR && !p.falling)!;
          piece.r = drop.toR;
          piece.falling = true;
        } else {
          this.pieces.push({
            color: drop.color,
            c: drop.c,
            r: drop.toR,
            x: drop.c,
            y: drop.fromR,
            vy: 0,
            falling: true,
            scale: 1,
            clearing: 0,
            wiggle: 0,
          });
        }
      }
      await this.settled();
    }
    if (!findMove(this.grid)) {
      await wait(250);
      sfx.shuffle();
      this.grid = newGrid();
      this.spawnAll(true);
      await this.settled();
    }
  }

  private settled(): Promise<void> {
    return new Promise(resolve => this.settleWaiters.push(resolve));
  }

  /** Wiggles one available move right away (the first-run coach asks for it). */
  showHint(): void {
    if (this.busy || this.hintShown) return;
    const move = findMove(this.grid);
    if (!move) return;
    this.hintShown = true;
    for (const cell of move) {
      const piece = this.pieceAt(cell);
      if (piece) piece.wiggle = 1;
    }
  }

  private clearHint(): void {
    if (!this.hintShown) return;
    this.hintShown = false;
    for (const piece of this.pieces) piece.wiggle = 0;
  }

  update(dt: number): void {
    this.t += dt;
    let moving = false;
    let landed = false;
    for (const piece of this.pieces) {
      if (piece.clearing > 0) {
        piece.clearing += dt;
        piece.scale = Math.max(0, 1 + 0.35 * Math.sin((piece.clearing / CLEAR_TIME) * Math.PI) - (piece.clearing / CLEAR_TIME) ** 2);
        continue;
      }
      if (piece.falling) {
        piece.vy += 46 * dt;
        piece.y += piece.vy * dt;
        if (piece.y >= piece.r) {
          piece.y = piece.r;
          if (piece.vy > 9) {
            piece.vy = -piece.vy * 0.18;
            landed = true;
          } else {
            piece.vy = 0;
            piece.falling = false;
          }
        }
        if (piece.falling) moving = true;
      }
    }
    for (const popup of this.popups) popup.age += dt;
    this.popups = this.popups.filter(popup => popup.age < 0.9);
    if (landed) sfx.land();
    if (!moving && this.settleWaiters.length) {
      const waiters = this.settleWaiters;
      this.settleWaiters = [];
      waiters.forEach(resolve => resolve());
    }

    if (!this.busy) {
      this.idle += dt;
      if (this.idle > 7 && !this.hintShown) {
        const move = findMove(this.grid);
        if (move) {
          this.hintShown = true;
          for (const cell of move) {
            const piece = this.pieceAt(cell);
            if (piece) piece.wiggle = 1;
          }
        }
      }
    } else this.idle = 0;
  }

  draw(): void {
    const ctx = this.ctx;
    const cell = this.cell;
    ctx.clearRect(0, 0, this.sizePx, this.sizePx);

    // slate tiles
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (r + c) % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.18)';
        roundRect(ctx, c * cell + 1.5, r * cell + 1.5, cell - 3, cell - 3, cell * 0.16);
        ctx.fill();
      }
    }

    if (this.selected && !this.busy) {
      const { c, r } = this.selected;
      const color = ELEMENTS[this.grid[r][c]]?.glow ?? '#fff';
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = cell * 0.3;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, cell * 0.05);
      roundRect(ctx, c * cell + 3, r * cell + 3, cell - 6, cell - 6, cell * 0.16);
      ctx.stroke();
      ctx.restore();
    }

    for (const piece of this.pieces) {
      const sprite = this.sprites[piece.color];
      if (!sprite) continue;
      const wobble = piece.wiggle ? Math.sin(this.t * 9) * 0.14 : 0;
      const s = cell * piece.scale;
      ctx.save();
      ctx.translate((piece.x + 0.5) * cell, (piece.y + 0.5) * cell);
      ctx.rotate(wobble);
      if (piece.clearing > 0) {
        ctx.globalAlpha = Math.max(0, 1 - (piece.clearing / CLEAR_TIME) ** 2);
        ctx.shadowColor = ELEMENTS[piece.color].glow;
        ctx.shadowBlur = cell * 0.5;
      }
      ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
      ctx.restore();
    }

    // heat numbers and chain multipliers float up off the clear
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const popup of this.popups) {
      const k = popup.age / 0.9;
      const pop = Math.min(1, popup.age / 0.12);
      const size = cell * (popup.big ? 0.62 : 0.42) * (0.6 + 0.4 * pop);
      ctx.globalAlpha = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      ctx.font = `900 ${size}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.strokeStyle = 'rgba(8,4,12,0.9)';
      ctx.fillStyle = popup.color;
      const px = Math.min(this.sizePx - size, Math.max(size, popup.x * cell));
      const py = Math.max(size * 0.6, popup.y * cell - k * cell * 0.7);
      ctx.strokeText(popup.text, px, py);
      ctx.fillText(popup.text, px, py);
    }
    ctx.globalAlpha = 1;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
