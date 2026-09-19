import { ELEMENTS } from './art';
import type { Dragon, HatchEdge } from './dragon';

type Spark = {
  sx: number; sy: number; cx: number; cy: number; tx: number; ty: number;
  t: number; dur: number; delay: number; color: string; done: () => void;
};

type Flake = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; w: number; h: number; color: string; sway: number };

type Coin = {
  delay: number; t: number; dur: number; started: boolean; spin: number; spinRate: number;
  sx: number; sy: number; cx: number; cy: number; index: number;
};

/** Heat sparks that fly from cleared eggs to the nest, drawn over the whole shell. */
export class SparkLayer {
  private ctx: CanvasRenderingContext2D;
  private sparks: Spark[] = [];
  private flakes: Flake[] = [];
  private dragon: Dragon | null = null;
  private coins: Coin[] = [];
  private coinTarget: (() => { x: number; y: number }) | null = null;
  private onCoin: ((index: number) => void) | null = null;
  private fallbackMouth: (() => { x: number; y: number }) | null = null;
  private edge: (() => HatchEdge) | null = null;
  private rain = { left: 0, rate: 0, carry: 0, colors: ['#ffd24a'] };
  private w = 0;
  private h = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Coordinates are client-space; they are mapped into the layer here. */
  emit(from: { x: number; y: number }, to: { x: number; y: number }, color: number, delay: number, done: () => void): void {
    const rect = this.canvas.getBoundingClientRect();
    const sx = from.x - rect.left;
    const sy = from.y - rect.top;
    const tx = to.x - rect.left;
    const ty = to.y - rect.top;
    const bend = (Math.random() - 0.5) * 220;
    this.sparks.push({
      sx, sy, tx, ty,
      cx: (sx + tx) / 2 + bend,
      cy: Math.min(sy, ty) - 60 - Math.random() * 80,
      t: 0,
      dur: 0.5 + Math.random() * 0.25,
      delay,
      color: ELEMENTS[color].glow,
      done,
    });
  }

  /** The hatchling is drawn here, over the whole game, so its wings can leave the nest panel. */
  setDragon(dragon: Dragon, edge: () => HatchEdge): void {
    this.dragon = dragon;
    this.edge = edge;
  }

  /**
   * The dragon coughs up the win: `count` coins leave its mouth over `seconds` and home in on the
   * balance. `onArrive` fires once per coin as it lands. Points are client-space.
   */
  spitCoins(
    count: number,
    seconds: number,
    target: () => { x: number; y: number },
    fallbackMouth: () => { x: number; y: number },
    onArrive: (index: number) => void,
  ): void {
    this.coinTarget = target;
    this.fallbackMouth = fallbackMouth;
    this.onCoin = onArrive;
    for (let i = 0; i < count; i++) {
      this.coins.push({
        delay: (i / count) * seconds,
        t: 0,
        dur: 0.7 + Math.random() * 0.35,
        started: false,
        spin: Math.random() * 6,
        spinRate: 9 + Math.random() * 8,
        sx: 0, sy: 0, cx: 0, cy: 0,
        index: i,
      });
    }
  }

  /** Drops whatever is still in the air without crediting it (the caller settles the rest). */
  clearCoins(): void {
    this.coins = [];
  }

  dismissDragon(): void {
    this.dragon?.leave();
  }

  /** A shower of gold scales over the whole game, for the hatches worth shouting about. */
  celebrate(seconds: number, rate: number, color: string): void {
    this.rain = { left: seconds, rate, carry: 0, colors: ['#ffd24a', '#fff1b8', '#f09a2a', color] };
    for (let i = 0; i < rate * 0.4; i++) this.spawnFlake(Math.random() * this.h * 0.5);
  }

  stopCelebration(): void {
    this.rain.left = 0;
  }

  private spawnFlake(y = -20): void {
    const size = 6 + Math.random() * 9;
    this.flakes.push({
      x: Math.random() * this.w,
      y,
      vx: (Math.random() - 0.5) * 60,
      vy: 140 + Math.random() * 220,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 9,
      w: size,
      h: size * (0.55 + Math.random() * 0.4),
      color: this.rain.colors[Math.floor(Math.random() * this.rain.colors.length)],
      sway: Math.random() * 6,
    });
  }

  update(dt: number): void {
    if (this.dragon) {
      this.dragon.update(dt);
      if (this.dragon.dead) this.dragon = null;
    }
    if (this.coins.length) {
      const rect = this.canvas.getBoundingClientRect();
      for (const coin of this.coins) {
        if (coin.delay > 0) {
          coin.delay -= dt;
          continue;
        }
        if (!coin.started) {
          coin.started = true;
          // leave from the mouth, thrown along where the head points, then curl toward the balance
          const mouth = this.dragon?.mouth;
          const from = mouth ?? (() => {
            const p = this.fallbackMouth!();
            return { x: p.x - rect.left, y: p.y - rect.top, angle: -0.6 };
          })();
          const a = from.angle + (Math.random() - 0.5) * 0.9;
          const throwDist = 90 + Math.random() * 130;
          coin.sx = from.x;
          coin.sy = from.y;
          coin.cx = from.x + Math.cos(a) * throwDist;
          coin.cy = from.y + Math.sin(a) * throwDist - 40 - Math.random() * 60;
        }
        coin.t += dt / coin.dur;
        coin.spin += coin.spinRate * dt;
        if (coin.t >= 1) this.onCoin?.(coin.index);
      }
      this.coins = this.coins.filter(coin => coin.t < 1);
    }
    if (this.rain.left > 0) {
      this.rain.left -= dt;
      this.rain.carry += this.rain.rate * dt;
      while (this.rain.carry >= 1) {
        this.rain.carry -= 1;
        this.spawnFlake();
      }
    }
    for (const flake of this.flakes) {
      flake.sway += dt * 3;
      flake.x += (flake.vx + Math.sin(flake.sway) * 40) * dt;
      flake.y += flake.vy * dt;
      flake.rot += flake.vr * dt;
    }
    this.flakes = this.flakes.filter(flake => flake.y < this.h + 30);
    for (const spark of this.sparks) {
      if (spark.delay > 0) {
        spark.delay -= dt;
        continue;
      }
      spark.t += dt / spark.dur;
      if (spark.t >= 1) spark.done();
    }
    this.sparks = this.sparks.filter(s => s.t < 1);
  }

  draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.dragon && this.edge) {
      // the nest reports its broken shell edge in client space; bring it into this layer
      const rect = this.canvas.getBoundingClientRect();
      const edge = this.edge();
      this.dragon.draw(ctx, {
        ...edge,
        top: edge.top - rect.top,
        points: edge.points.map(p => ({ x: p.x - rect.left, y: p.y - rect.top })),
      });
    }
    for (const flake of this.flakes) {
      ctx.save();
      ctx.translate(flake.x, flake.y);
      ctx.rotate(flake.rot);
      ctx.scale(1, Math.cos(flake.sway * 1.7)); // tumbling
      ctx.fillStyle = flake.color;
      ctx.beginPath();
      ctx.moveTo(0, -flake.h);
      ctx.quadraticCurveTo(flake.w, -flake.h * 0.2, 0, flake.h);
      ctx.quadraticCurveTo(-flake.w, -flake.h * 0.2, 0, -flake.h);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const spark of this.sparks) {
      if (spark.delay > 0) continue;
      for (let trail = 0; trail < 5; trail++) {
        const k = Math.max(0, spark.t - trail * 0.035);
        const e = k * k;
        const u = 1 - e;
        const x = u * u * spark.sx + 2 * u * e * spark.cx + e * e * spark.tx;
        const y = u * u * spark.sy + 2 * u * e * spark.cy + e * e * spark.ty;
        ctx.globalAlpha = (1 - trail / 5) * 0.9;
        ctx.fillStyle = spark.color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1, 5 - trail), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (this.coins.length && this.coinTarget) {
      const rect = this.canvas.getBoundingClientRect();
      const target = this.coinTarget();
      const tx = target.x - rect.left;
      const ty = target.y - rect.top;
      const radius = this.w < 520 ? 5.5 : 7.5;
      for (const coin of this.coins) {
        if (!coin.started) continue;
        for (let ghost = 2; ghost >= 0; ghost--) {
          const k = Math.max(0, coin.t - ghost * 0.05);
          const e = k * k * (3 - 2 * k);
          const u = 1 - e;
          const x = u * u * coin.sx + 2 * u * e * coin.cx + e * e * tx;
          const y = u * u * coin.sy + 2 * u * e * coin.cy + e * e * ty;
          const r = radius * (1 - e * 0.35);
          if (ghost > 0) {
            ctx.globalAlpha = 0.18 / ghost;
            ctx.fillStyle = '#ffd24a';
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
            continue;
          }
          ctx.globalAlpha = 1;
          const face = Math.max(0.18, Math.abs(Math.cos(coin.spin)));
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(face, 1);
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          const gold = ctx.createLinearGradient(-r, -r, r, r);
          gold.addColorStop(0, '#fff3b0');
          gold.addColorStop(0.5, '#ffc83a');
          gold.addColorStop(1, '#b8740c');
          ctx.fillStyle = gold;
          ctx.fill();
          ctx.lineWidth = Math.max(1, r * 0.22);
          ctx.strokeStyle = '#7a4a06';
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(122,74,6,0.55)';
          ctx.lineWidth = Math.max(1, r * 0.14);
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    }
  }
}
