import { RANK_COLOR, SIZE_PALETTE, eggPath } from './art';
import { sfx } from './audio';

type Point = { x: number; y: number };
type Shard = { pts: Point[]; x: number; y: number; vx: number; vy: number; rot: number; vr: number; life: number };
type Mote = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string };

type Phase = 'idle' | 'cracking' | 'hatched';

const SIZE_SCALE = [0, 0.52, 0.64, 0.76, 0.88, 1];
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The egg in the nest: grows with size, cracks while the chain rolls, then bursts open. */
export class NestView {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private t = 0;

  private size = 1;
  private scale = SIZE_SCALE[1];
  private growPulse = 0;
  private heatPulse = 0;
  private charge = 0; // 0..1 progress toward the next size, brightens the veins

  private phase: Phase = 'idle';
  private crackLevel = 0;
  private crackTarget = 0;
  private nextTap = 0;
  private shake = 0;
  private cracks: Point[][] = [];
  private shards: Shard[] = [];
  private motes: Mote[] = [];
  private flash = 0;
  private rank = 0;
  private hatchT = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.buildCracks();
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

  /** Screen-space point sparks should fly to. */
  center(): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.5 };
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  setSize(size: number, announce: boolean): void {
    if (size === this.size) return;
    const grew = size > this.size;
    this.size = size;
    if (announce) {
      this.growPulse = 1;
      if (grew) {
        sfx.grow(size);
        this.burstMotes(18, SIZE_PALETTE[size]!.vein);
      } else sfx.shrink();
    }
  }

  setCharge(charge: number): void {
    this.charge = charge;
  }

  pulseHeat(): void {
    this.heatPulse = 1;
  }

  startCracking(): void {
    this.phase = 'cracking';
    this.crackLevel = 0;
    this.crackTarget = 0.12;
    this.nextTap = 0.15;
    this.shards = [];
    this.buildCracks();
    sfx.rumbleStart();
  }

  /** Aborts a round that never reached the chain (rejected, reverted). */
  cancelCracking(): void {
    this.phase = 'idle';
    this.crackLevel = 0;
    this.crackTarget = 0;
    sfx.rumbleStop();
  }

  /** Bursts the shell and reveals the hatchling. Resolves when the presentation lands. */
  hatch(rank: number, onBurst: () => void = () => {}): Promise<void> {
    sfx.rumbleStop();
    this.rank = rank;
    this.crackTarget = 1;
    this.crackLevel = Math.max(this.crackLevel, 0.8);
    return new Promise(resolve => {
      const burstDelay = reducedMotion ? 60 : 420;
      sfx.crack(3);
      this.shake = 1;
      window.setTimeout(() => {
        this.phase = 'hatched';
        this.hatchT = 0;
        this.flash = 1;
        this.spawnShards();
        sfx.burst();
        onBurst();
        if (rank === 0) {
          sfx.dud();
          this.burstMotes(26, '#777b84', true);
        } else {
          sfx.win(rank);
          this.burstMotes(20 + rank * 14, RANK_COLOR[rank]);
        }
        window.setTimeout(resolve, reducedMotion ? 300 : 900 + rank * 160);
      }, burstDelay);
    });
  }

  /** The jagged rim of the broken shell in client space — the dragon rises from behind it. */
  hatchEdge(): { points: Point[]; eh: number; ew: number; top: number } {
    const rect = this.canvas.getBoundingClientRect();
    const { ew, eh, cx, cy } = this.eggDims();
    return {
      points: this.rimPoints(ew, eh).map(p => ({ x: rect.left + cx + p.x, y: rect.top + cy + p.y })),
      eh,
      ew,
      top: Math.max(0, rect.top - Math.min(40, rect.height * 0.1)), // may rise a little past the panel, never over the page top
    };
  }

  private rimPoints(ew: number, eh: number): Point[] {
    const teeth = 9;
    const points: Point[] = [];
    for (let i = 0; i <= teeth; i++) {
      points.push({
        x: -ew / 2 + (i / teeth) * ew,
        y: eh * (i % 2 ? -0.04 : 0.12) + Math.sin(i * 2.3) * eh * 0.03,
      });
    }
    return points;
  }

  reset(): void {
    this.phase = 'idle';
    this.crackLevel = 0;
    this.crackTarget = 0;
    this.shards = [];
    this.growPulse = 0.6;
  }

  // ------------------------------------------------------------ internals

  private buildCracks(): void {
    const count = 8;
    this.cracks = [];
    const origin = { x: (Math.random() - 0.5) * 0.12, y: -0.08 + (Math.random() - 0.5) * 0.1 };
    for (let i = 0; i < count; i++) {
      let angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const pts: Point[] = [{ ...origin }];
      let p = { ...origin };
      const steps = 5 + Math.floor(Math.random() * 3);
      for (let s = 0; s < steps; s++) {
        angle += (Math.random() - 0.5) * 1.1;
        const len = 0.07 + Math.random() * 0.07;
        p = { x: p.x + Math.cos(angle) * len, y: p.y + Math.sin(angle) * len };
        pts.push(p);
      }
      this.cracks.push(pts);
    }
  }

  private eggDims(): { ew: number; eh: number; cx: number; cy: number } {
    // The flash of the burst hides the jump: whatever the egg's size, the hatchling reads large.
    const scale = this.phase === 'hatched' ? Math.max(this.scale, 0.84) : this.scale;
    const eh = Math.min(this.h * 0.74, this.w * 0.95) * scale;
    return { ew: eh * 0.76, eh, cx: this.w / 2, cy: this.h * 0.86 - eh / 2 };
  }

  private spawnShards(): void {
    const { ew, eh } = this.eggDims();
    this.shards = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
      const r = 0.12 + Math.random() * 0.22;
      const x = Math.cos(a) * ew * r;
      const y = -eh * 0.18 + Math.sin(a) * eh * r * 0.8;
      const s = eh * (0.06 + Math.random() * 0.07);
      const pts = [0, 1, 2].map(k => {
        const pa = (k / 3) * Math.PI * 2 + Math.random();
        return { x: Math.cos(pa) * s, y: Math.sin(pa) * s };
      });
      const speed = eh * (1.4 + Math.random() * 1.8);
      this.shards.push({
        pts,
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - eh * 1.4,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 14,
        life: 1,
      });
    }
  }

  private burstMotes(count: number, color: string, smoke = false): void {
    const { eh, cx, cy } = this.eggDims();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = eh * (smoke ? 0.15 + Math.random() * 0.3 : 0.4 + Math.random() * 1.3);
      const max = smoke ? 1.6 + Math.random() : 0.7 + Math.random() * 0.9;
      this.motes.push({
        x: cx + Math.cos(a) * eh * 0.1,
        y: cy + Math.sin(a) * eh * 0.1,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - (smoke ? eh * 0.25 : eh * 0.3),
        life: max,
        max,
        size: smoke ? eh * (0.05 + Math.random() * 0.06) : eh * (0.008 + Math.random() * 0.014),
        color,
      });
    }
  }

  update(dt: number): void {
    this.t += dt;
    const target = SIZE_SCALE[this.size];
    this.scale += (target - this.scale) * Math.min(1, dt * 7);
    this.growPulse = Math.max(0, this.growPulse - dt * 1.8);
    this.heatPulse = Math.max(0, this.heatPulse - dt * 5);
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.shake = Math.max(0, this.shake - dt * 3.5);

    if (this.phase === 'cracking') {
      this.nextTap -= dt;
      if (this.nextTap <= 0 && this.crackTarget < 0.78) {
        // Each tap from inside the shell pushes the cracks further; the waits lengthen so a slow
        // chain never runs out of shell to break.
        this.crackTarget = Math.min(0.78, this.crackTarget + 0.11);
        this.nextTap = 0.5 + this.crackTarget * 1.4;
        this.shake = 0.7;
        sfx.tap();
        sfx.crack(this.crackTarget * 3);
      } else if (this.nextTap <= 0) {
        this.nextTap = 1.1;
        this.shake = 0.45;
        sfx.tap();
      }
    }
    this.crackLevel += (this.crackTarget - this.crackLevel) * Math.min(1, dt * 9);
    if (this.phase === 'hatched') this.hatchT += dt;

    const { eh } = this.eggDims();
    for (const shard of this.shards) {
      shard.vy += eh * 5 * dt;
      shard.x += shard.vx * dt;
      shard.y += shard.vy * dt;
      shard.rot += shard.vr * dt;
      shard.life -= dt * 0.9;
    }
    this.shards = this.shards.filter(s => s.life > 0);
    for (const mote of this.motes) {
      mote.vy += eh * 0.5 * dt * (mote.size > eh * 0.04 ? -0.3 : 1);
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;
      mote.vx *= 1 - dt * 1.5;
      mote.life -= dt;
    }
    this.motes = this.motes.filter(m => m.life > 0);
  }

  draw(): void {
    const ctx = this.ctx;
    const { ew, eh, cx, cy } = this.eggDims();
    const palette = SIZE_PALETTE[this.size]!;
    ctx.clearRect(0, 0, this.w, this.h);

    // aura
    const auraStrength = 0.22 + this.charge * 0.25 + this.growPulse * 0.4 + (this.phase === 'cracking' ? 0.2 : 0);
    const aura = ctx.createRadialGradient(cx, cy, eh * 0.1, cx, cy, eh * 0.95);
    aura.addColorStop(0, hexA(this.phase === 'hatched' ? RANK_COLOR[this.rank] : palette.vein, auraStrength));
    aura.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, this.w, this.h);

    this.drawNest(cx, this.h * 0.86, Math.max(ew * 1.25, this.h * 0.4));

    const breathe = reducedMotion ? 0 : Math.sin(this.t * 1.6) * 0.012;
    const shakeX = this.shake * Math.sin(this.t * 70) * eh * 0.025;
    const shakeR = this.shake * Math.sin(this.t * 55) * 0.05;
    const pop = 1 + this.growPulse * 0.12 * Math.sin(this.growPulse * Math.PI) + this.heatPulse * 0.025;

    ctx.save();
    ctx.translate(cx + shakeX, cy + eh / 2);
    ctx.rotate(shakeR);
    ctx.scale(pop * (1 - breathe), pop * (1 + breathe));
    ctx.translate(0, -eh / 2);

    if (this.phase === 'hatched') {
      this.drawHatchling(ew, eh);
      this.drawShell(ew, eh, palette, true);
    } else {
      this.drawShell(ew, eh, palette, false);
      this.drawCracks(ew, eh, palette.vein);
    }

    for (const shard of this.shards) {
      ctx.save();
      ctx.translate(shard.x, shard.y);
      ctx.rotate(shard.rot);
      ctx.globalAlpha = Math.min(1, shard.life * 1.6);
      ctx.beginPath();
      shard.pts.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = palette.shell;
      ctx.fill();
      ctx.strokeStyle = palette.dark;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    for (const mote of this.motes) {
      const k = mote.life / mote.max;
      ctx.globalAlpha = Math.min(1, k * (mote.size > eh * 0.04 ? 0.35 : 1.4));
      ctx.fillStyle = mote.color;
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, mote.size * (mote.size > eh * 0.04 ? 2 - k : k + 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (this.flash > 0) {
      const flash = ctx.createRadialGradient(cx, cy, 0, cx, cy, eh);
      flash.addColorStop(0, `rgba(255,250,235,${this.flash})`);
      flash.addColorStop(1, 'rgba(255,250,235,0)');
      ctx.fillStyle = flash;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private drawNest(cx: number, baseY: number, width: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, baseY);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(0, width * 0.06, width * 0.56, width * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    // ribs of the nest: charred bones curving up around the egg
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const k = (i / 8) * 2 - 1;
      const x = k * width * 0.5;
      const lean = k * 0.5;
      ctx.strokeStyle = i % 2 ? '#3a3128' : '#4a4034';
      ctx.lineWidth = width * 0.035;
      ctx.beginPath();
      ctx.moveTo(x * 0.85, width * 0.08);
      ctx.quadraticCurveTo(x * 1.1, -width * 0.04, x + lean * width * 0.1, -width * (0.1 + (1 - Math.abs(k)) * 0.03));
      ctx.stroke();
    }
    // embers under the egg
    const ember = ctx.createRadialGradient(0, width * 0.04, 0, 0, width * 0.04, width * 0.4);
    ember.addColorStop(0, 'rgba(255,120,50,0.35)');
    ember.addColorStop(1, 'rgba(255,120,50,0)');
    ctx.fillStyle = ember;
    ctx.fillRect(-width, -width * 0.3, width * 2, width * 0.6);
    ctx.restore();
  }

  private drawShell(ew: number, eh: number, palette: { shell: string; dark: string; vein: string }, lowerOnly: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    if (lowerOnly) {
      // keep only the jagged bottom half of the shell
      ctx.beginPath();
      ctx.moveTo(-ew, eh);
      ctx.lineTo(-ew, eh * 0.08);
      for (const p of this.rimPoints(ew, eh)) ctx.lineTo(p.x, p.y);
      ctx.lineTo(ew, eh * 0.08);
      ctx.lineTo(ew, eh);
      ctx.closePath();
      ctx.clip();
    }
    eggPath(ctx, ew, eh);
    const body = ctx.createRadialGradient(-ew * 0.2, -eh * 0.24, eh * 0.04, 0, eh * 0.05, eh * 0.66);
    body.addColorStop(0, lighten(palette.shell, 0.45));
    body.addColorStop(0.4, palette.shell);
    body.addColorStop(1, palette.dark);
    ctx.fillStyle = body;
    ctx.fill();

    ctx.save();
    eggPath(ctx, ew, eh);
    ctx.clip();
    // dragon scales, glowing in the seams as the nest charges
    const glow = 0.1 + this.charge * 0.5 + this.growPulse * 0.4 + this.heatPulse * 0.3;
    ctx.lineWidth = Math.max(1, eh * 0.008);
    const rowsN = 9;
    for (let row = 0; row < rowsN; row++) {
      const y = -eh * 0.42 + row * eh * 0.105;
      const radius = eh * 0.062;
      const n = 9;
      for (let k = 0; k < n; k++) {
        const x = (k - (n - 1) / 2 + (row % 2 ? 0.5 : 0)) * radius * 1.9;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0.1, Math.PI - 0.1);
        ctx.strokeStyle = hexA(palette.vein, glow * (0.5 + 0.5 * Math.sin(this.t * 2 + row * 0.8 + k)));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y - eh * 0.004, radius, 0.1, Math.PI - 0.1);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.stroke();
      }
    }
    const rim = ctx.createLinearGradient(0, eh * 0.15, 0, eh * 0.5);
    rim.addColorStop(0, 'rgba(255,160,90,0)');
    rim.addColorStop(1, 'rgba(255,160,90,0.28)');
    ctx.fillStyle = rim;
    ctx.fillRect(-ew, 0, ew * 2, eh);
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(-ew * 0.2, -eh * 0.3, ew * 0.08, eh * 0.04, -0.6, 0, Math.PI * 2);
    ctx.fill();
    eggPath(ctx, ew, eh);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = Math.max(1.5, eh * 0.012);
    ctx.stroke();
    ctx.restore();
  }

  private drawCracks(ew: number, eh: number, vein: string): void {
    if (this.crackLevel <= 0.01) return;
    const ctx = this.ctx;
    ctx.save();
    eggPath(ctx, ew, eh);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const total = this.cracks.length;
    this.cracks.forEach((pts, i) => {
      const portion = Math.max(0, Math.min(1, (this.crackLevel * (total + 3) - i) / 3.5));
      if (portion <= 0) return;
      const upto = portion * (pts.length - 1);
      ctx.beginPath();
      ctx.moveTo(pts[0].x * eh, pts[0].y * eh);
      for (let k = 1; k <= Math.ceil(upto); k++) {
        const f = Math.min(1, upto - (k - 1));
        const a = pts[k - 1];
        const b = pts[k];
        ctx.lineTo((a.x + (b.x - a.x) * f) * eh, (a.y + (b.y - a.y) * f) * eh);
      }
      ctx.shadowColor = vein;
      ctx.shadowBlur = eh * 0.06;
      ctx.strokeStyle = hexA(lighten(vein, 0.5), 0.95);
      ctx.lineWidth = eh * (0.012 + this.crackLevel * 0.012);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(10,5,0,0.85)';
      ctx.lineWidth = eh * 0.005;
      ctx.stroke();
    });
    ctx.restore();
  }

  /** Inside the broken shell: a glowing hollow the dragon climbs out of — or, for a dud, cold ash. */
  private drawHatchling(ew: number, eh: number): void {
    const ctx = this.ctx;
    const rank = this.rank;
    const open = easeOutBack(Math.min(1, this.hatchT / 0.55));
    const y = -eh * 0.12;

    if (rank === 0) {
      ctx.save();
      ctx.translate(0, y + eh * 0.12);
      ctx.strokeStyle = 'rgba(160,165,175,0.75)';
      ctx.lineWidth = eh * 0.014;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-ew * 0.22, 0);
      ctx.quadraticCurveTo(0, eh * 0.05, ew * 0.22, 0);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const color = RANK_COLOR[rank];
    ctx.save();
    ctx.translate(0, y);
    // rays for the rare ones
    if (rank >= 3 && !reducedMotion) {
      ctx.save();
      ctx.rotate(this.t * 0.25);
      const rays = 10 + rank * 2;
      for (let i = 0; i < rays; i++) {
        ctx.rotate((Math.PI * 2) / rays);
        const len = eh * (0.5 + rank * 0.1) * open;
        const ray = ctx.createLinearGradient(0, 0, 0, -len);
        ray.addColorStop(0, hexA(color, 0.35));
        ray.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = ray;
        ctx.beginPath();
        ctx.moveTo(-eh * 0.02, 0);
        ctx.lineTo(0, -len);
        ctx.lineTo(eh * 0.02, 0);
        ctx.fill();
      }
      ctx.restore();
    }
    // the hollow of the shell, lit from inside by whatever is climbing out of it
    const hollow = ctx.createRadialGradient(0, eh * 0.14, 0, 0, eh * 0.14, ew * 0.55);
    hollow.addColorStop(0, hexA(lighten(color, 0.3), 0.85 * open));
    hollow.addColorStop(0.45, hexA(darken(color, 0.6), 0.9));
    hollow.addColorStop(1, 'rgba(8,5,10,0)');
    ctx.fillStyle = hollow;
    ctx.beginPath();
    ctx.ellipse(0, eh * 0.16, ew * 0.5, eh * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ---- tiny colour helpers ----

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexA(hex: string, alpha: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}
function lighten(hex: string, k: number): string {
  const [r, g, b] = parse(hex).map(v => Math.round(v + (255 - v) * k));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
function darken(hex: string, k: number): string {
  const [r, g, b] = parse(hex).map(v => Math.round(v * (1 - k)));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}
