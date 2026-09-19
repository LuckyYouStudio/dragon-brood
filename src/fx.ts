import { ELEMENTS } from './art';

type Spark = {
  sx: number; sy: number; cx: number; cy: number; tx: number; ty: number;
  t: number; dur: number; delay: number; color: string; done: () => void;
};

/** Heat sparks that fly from cleared eggs to the nest, drawn over the whole shell. */
export class SparkLayer {
  private ctx: CanvasRenderingContext2D;
  private sparks: Spark[] = [];
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

  update(dt: number): void {
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
