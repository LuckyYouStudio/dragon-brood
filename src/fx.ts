import { ELEMENTS } from './art';

type Spark = {
  sx: number; sy: number; cx: number; cy: number; tx: number; ty: number;
  t: number; dur: number; delay: number; color: string; done: () => void;
};

type Flake = { x: number; y: number; vx: number; vy: number; rot: number; vr: number; w: number; h: number; color: string; sway: number };

/** Heat sparks that fly from cleared eggs to the nest, drawn over the whole shell. */
export class SparkLayer {
  private ctx: CanvasRenderingContext2D;
  private sparks: Spark[] = [];
  private flakes: Flake[] = [];
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
  }
}
