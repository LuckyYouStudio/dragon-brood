// The hatchlings. One parametric rig — neck chain, skull, jaw, horns, wings — tuned into five
// dragons. Everything is drawn in code and animated from a single clock: rise out of the shell,
// unfurl, roar (with a breath that matches the rank), then idle until the nest resets.

import { RANK_COLOR } from './art';

type P = { x: number; y: number };

type Breed = {
  neck: number; // neck length, in egg heights
  girth: number;
  head: number; // skull size, in egg heights
  snout: number; // 0.6 stubby … 1.05 long
  horns: number; // how many pairs
  hornLen: number;
  wing: number; // wing size, in egg heights
  eye: number;
  spikes: number; // dorsal spike size
  frill: boolean;
  whiskers: boolean;
  roar: number; // seconds
  breath: 'puff' | 'frost' | 'spark' | 'fire' | 'sunfire';
};

const BREEDS: Record<number, Breed> = {
  1: { neck: 0.62, girth: 1.2, head: 0.3, snout: 0.62, horns: 1, hornLen: 0.16, wing: 0.42, eye: 0.15, spikes: 0.35, frill: false, whiskers: false, roar: 0.55, breath: 'puff' },
  2: { neck: 0.88, girth: 1.0, head: 0.27, snout: 0.85, horns: 1, hornLen: 0.34, wing: 0.78, eye: 0.11, spikes: 0.6, frill: false, whiskers: false, roar: 0.8, breath: 'frost' },
  3: { neck: 1.08, girth: 0.84, head: 0.25, snout: 1.0, horns: 2, hornLen: 0.42, wing: 1.2, eye: 0.1, spikes: 0.8, frill: true, whiskers: false, roar: 1.0, breath: 'spark' },
  4: { neck: 1.18, girth: 1.12, head: 0.31, snout: 1.0, horns: 2, hornLen: 0.6, wing: 1.4, eye: 0.1, spikes: 1.0, frill: true, whiskers: false, roar: 1.3, breath: 'fire' },
  5: { neck: 1.28, girth: 1.28, head: 0.36, snout: 1.05, horns: 3, hornLen: 0.74, wing: 1.75, eye: 0.1, spikes: 1.15, frill: true, whiskers: true, roar: 1.9, breath: 'sunfire' },
};

type Ember = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; hot: string; cool: string; rise: number };

export type HatchEdge = { points: P[]; eh: number; ew: number; top: number };

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOutBack = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
const easeInOut = (x: number) => x * x * (3 - 2 * x);

export class Dragon {
  private t = 0;
  private leaving = -1;
  private embers: Ember[] = [];
  private roared = 0;
  private breed: Breed;
  private color: string;
  dead = false;

  /** `onRoar` fires at the start of every roar so the game can shake and sound it. */
  constructor(private rank: number, private onRoar: (rank: number, seconds: number, first: boolean) => void) {
    this.breed = BREEDS[rank];
    this.color = RANK_COLOR[rank];
  }

  leave(): void {
    if (this.leaving < 0) this.leaving = 0;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.leaving >= 0) {
      this.leaving += dt;
      if (this.leaving > 0.28) this.dead = true;
    }
    for (const ember of this.embers) {
      ember.x += ember.vx * dt;
      ember.y += ember.vy * dt;
      ember.vy -= ember.rise * dt;
      ember.vx *= 1 - dt * 1.2;
      ember.life -= dt;
    }
    this.embers = this.embers.filter(e => e.life > 0);
  }

  /** Seconds into the current roar, or -1. Roars repeat while the dragon is on screen. */
  private roarClock(): number {
    const first = 0.7;
    const gap = 3.4;
    if (this.t < first) return -1;
    const since = (this.t - first) % gap;
    const index = Math.floor((this.t - first) / gap) + 1;
    if (since < this.breed.roar) {
      if (index > this.roared && this.leaving < 0) {
        this.roared = index;
        this.onRoar(this.rank, this.breed.roar, index === 1);
      }
      return since;
    }
    return -1;
  }

  draw(ctx: CanvasRenderingContext2D, edge: HatchEdge): void {
    const b = this.breed;
    const mid = edge.points[Math.floor(edge.points.length / 2)];
    const ox = (edge.points[0].x + edge.points[edge.points.length - 1].x) / 2;
    const oy = mid.y;
    // Never taller than the room above the shell.
    const room = Math.max(40, oy - edge.top - 6);
    const tall = Math.max(b.neck * 0.9 + b.head * 0.75, b.neck * 0.3 + b.wing * 0.98);
    const u = Math.min(edge.eh * 1.15, room / tall);

    const out = this.leaving >= 0 ? 1 - clamp01(this.leaving / 0.25) : 1;
    const emerge = (reducedMotion ? 1 : easeOutBack(clamp01(this.t / 0.5))) * out;
    const spread = reducedMotion ? 1 : easeInOut(clamp01((this.t - 0.25) / 0.55)) * out;
    const roarT = this.roarClock();
    const roarK = roarT < 0 ? 0 : Math.sin(clamp01(roarT / b.roar) * Math.PI) ** 0.6;
    const sway = reducedMotion ? 0 : 1;

    // ---- spine
    const N = 16;
    const length = u * b.neck * emerge * (1 + roarK * 0.08);
    const spine: Array<P & { a: number; r: number }> = [];
    let x = 0;
    let y = u * 0.22;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const a =
        -Math.PI / 2 -
        0.62 * Math.sin(s * Math.PI) +
        0.62 * s -
        roarK * 0.35 * s +
        sway * 0.1 * Math.sin(this.t * 1.7 + s * 2.4) * s;
      const r = u * b.girth * (0.19 * (1 - s) + 0.085 * s) * (0.55 + 0.45 * emerge);
      spine.push({ x, y, a, r });
      x += Math.cos(a) * (length / N);
      y += Math.sin(a) * (length / N);
    }
    const tip = spine[N];
    const headAngle = tip.a + 1.0 - roarK * 0.32 + sway * 0.05 * Math.sin(this.t * 2.3);

    ctx.save();
    // Everything below the broken edge of the shell is inside the egg.
    const big = 4000;
    const first = edge.points[0];
    const last = edge.points[edge.points.length - 1];
    ctx.beginPath();
    ctx.moveTo(-big, -big);
    ctx.lineTo(big, -big);
    ctx.lineTo(big, big);
    ctx.lineTo(last.x, big);
    for (let i = edge.points.length - 1; i >= 0; i--) ctx.lineTo(edge.points[i].x, edge.points[i].y);
    ctx.lineTo(first.x, big);
    ctx.lineTo(-big, big);
    ctx.closePath();
    ctx.clip();

    ctx.translate(ox, oy);

    // ---- aura for the rare ones
    if (this.rank >= 4) {
      const aura = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, u * 1.4);
      aura.addColorStop(0, rgba(this.color, 0.28 * emerge));
      aura.addColorStop(1, rgba(this.color, 0));
      ctx.fillStyle = aura;
      ctx.fillRect(-u * 3, -u * 3, u * 6, u * 6);
    }

    // ---- wings, behind the neck
    const shoulder = spine[Math.round(N * 0.3)];
    const flap = sway * Math.sin(this.t * (2.2 + roarK * 6)) * (0.1 + roarK * 0.12);
    this.drawWing(ctx, shoulder, u * b.wing, spread, -1, flap, true);
    this.drawWing(ctx, shoulder, u * b.wing, spread, 1, flap, false);

    // ---- neck
    this.drawNeck(ctx, spine, u);

    // ---- head
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(headAngle);
    const hs = u * b.head * (0.6 + 0.4 * emerge);
    ctx.scale(hs, hs);
    this.drawHead(ctx, roarK);
    ctx.restore();

    // ---- breath
    if (roarT >= 0 && !reducedMotion && this.leaving < 0) {
      const mouth = {
        x: tip.x + Math.cos(headAngle) * hs * (0.75 + b.snout * 0.45),
        y: tip.y + Math.sin(headAngle) * hs * (0.75 + b.snout * 0.45) + hs * 0.12,
      };
      this.breathe(mouth, headAngle + 0.08, u, roarK);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const e of this.embers) {
      const k = e.life / e.max;
      ctx.globalAlpha = Math.min(1, k * 1.3) * 0.85;
      ctx.fillStyle = k > 0.55 ? e.hot : e.cool;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.size * (1.5 - k * 0.8), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  // ------------------------------------------------------------------ parts

  private drawNeck(ctx: CanvasRenderingContext2D, spine: Array<P & { a: number; r: number }>, u: number): void {
    const b = this.breed;
    const front = (p: P & { a: number; r: number }, k = 1) => ({ x: p.x - Math.sin(p.a) * p.r * k, y: p.y + Math.cos(p.a) * p.r * k });
    const back = (p: P & { a: number; r: number }, k = 1) => ({ x: p.x + Math.sin(p.a) * p.r * k, y: p.y - Math.cos(p.a) * p.r * k });

    // dorsal spikes first, so the body overlaps their roots
    ctx.fillStyle = shade(this.color, -0.55);
    for (let i = 2; i < spine.length - 1; i += 2) {
      const p = spine[i];
      const root = back(p, 0.8);
      const size = p.r * b.spikes * (0.7 + 0.5 * Math.sin((i / spine.length) * Math.PI));
      const n = { x: Math.sin(p.a), y: -Math.cos(p.a) };
      const d = { x: Math.cos(p.a), y: Math.sin(p.a) };
      ctx.beginPath();
      ctx.moveTo(root.x - d.x * size * 0.45, root.y - d.y * size * 0.45);
      ctx.lineTo(root.x + n.x * size * 1.3 - d.x * size * 0.35, root.y + n.y * size * 1.3 - d.y * size * 0.35);
      ctx.lineTo(root.x + d.x * size * 0.45, root.y + d.y * size * 0.45);
      ctx.closePath();
      ctx.fill();
    }

    // body
    ctx.beginPath();
    spine.forEach((p, i) => {
      const q = front(p);
      ctx[i ? 'lineTo' : 'moveTo'](q.x, q.y);
    });
    for (let i = spine.length - 1; i >= 0; i--) {
      const q = back(spine[i]);
      ctx.lineTo(q.x, q.y);
    }
    ctx.closePath();
    const body = ctx.createLinearGradient(-u * 0.5, 0, u * 0.5, 0);
    body.addColorStop(0, shade(this.color, -0.78));
    body.addColorStop(0.55, shade(this.color, -0.4));
    body.addColorStop(1, shade(this.color, -0.05));
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = Math.max(1, u * 0.012);
    ctx.lineJoin = 'round';
    ctx.stroke();

    // belly plates along the front
    for (let i = 0; i < spine.length - 1; i++) {
      const a = spine[i];
      const c = spine[i + 1];
      const a1 = front(a, 0.96);
      const a2 = front(a, 0.3);
      const c1 = front(c, 0.96);
      const c2 = front(c, 0.3);
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.closePath();
      ctx.fillStyle = rgba(shade(this.color, 0.55), i % 2 ? 0.5 : 0.36);
      ctx.fill();
    }
  }

  private drawWing(
    ctx: CanvasRenderingContext2D,
    shoulder: P,
    w: number,
    spread: number,
    side: 1 | -1,
    flap: number,
    far: boolean,
  ): void {
    if (spread <= 0.01) return;
    ctx.save();
    ctx.translate(shoulder.x + side * w * 0.04, shoulder.y);
    ctx.scale(side * (0.12 + 0.88 * spread), 0.55 + 0.45 * spread);
    ctx.rotate(0.12 + flap + (1 - spread) * 0.9);

    const elbow = { x: w * 0.3, y: -w * 0.3 };
    const wrist = { x: w * 0.52, y: -w * 0.74 };
    const tips = [
      { x: w * 0.72, y: -w * 1.02 },
      { x: w * 1.02, y: -w * 0.62 },
      { x: w * 1.0, y: -w * 0.12 },
      { x: w * 0.62, y: w * 0.2 },
    ];
    const root = { x: w * 0.06, y: w * 0.24 };

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.lineTo(wrist.x, wrist.y);
    ctx.lineTo(tips[0].x, tips[0].y);
    let prev = tips[0];
    for (const tip of [...tips.slice(1), root]) {
      // scalloped trailing edge, pulled toward the wrist
      const mx = (prev.x + tip.x) / 2;
      const my = (prev.y + tip.y) / 2;
      ctx.quadraticCurveTo(mx + (wrist.x - mx) * 0.32, my + (wrist.y - my) * 0.32, tip.x, tip.y);
      prev = tip;
    }
    ctx.closePath();
    const membrane = ctx.createLinearGradient(0, 0, w, -w * 0.5);
    membrane.addColorStop(0, shade(this.color, far ? -0.8 : -0.62));
    membrane.addColorStop(1, rgba(shade(this.color, far ? -0.45 : -0.1), 0.92));
    ctx.fillStyle = membrane;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = Math.max(1, w * 0.012);
    ctx.stroke();

    // arm and finger bones
    ctx.lineCap = 'round';
    ctx.strokeStyle = shade(this.color, far ? -0.6 : -0.3);
    ctx.lineWidth = Math.max(1.5, w * 0.035);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.lineTo(wrist.x, wrist.y);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, w * 0.018);
    for (const tip of tips) {
      ctx.beginPath();
      ctx.moveTo(wrist.x, wrist.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
    // wrist claw
    ctx.fillStyle = '#e9dfc6';
    ctx.beginPath();
    ctx.moveTo(wrist.x - w * 0.03, wrist.y);
    ctx.lineTo(wrist.x - w * 0.02, wrist.y - w * 0.13);
    ctx.lineTo(wrist.x + w * 0.035, wrist.y - w * 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Skull in unit space, facing +x, origin where the neck meets it. */
  private drawHead(ctx: CanvasRenderingContext2D, roarK: number): void {
    const b = this.breed;
    const sn = b.snout;
    const jaw = 0.08 + roarK * 0.62;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';

    // frill spikes behind the skull
    if (b.frill) {
      ctx.fillStyle = shade(this.color, -0.5);
      for (let i = 0; i < 4; i++) {
        const a = -2.6 + i * 0.42;
        ctx.beginPath();
        ctx.moveTo(-0.15 + Math.cos(a) * 0.3, -0.05 + Math.sin(a) * 0.3);
        ctx.lineTo(-0.15 + Math.cos(a + 0.12) * (0.62 + (i % 2) * 0.12), -0.05 + Math.sin(a + 0.12) * (0.62 + (i % 2) * 0.12));
        ctx.lineTo(-0.15 + Math.cos(a + 0.3) * 0.3, -0.05 + Math.sin(a + 0.3) * 0.3);
        ctx.closePath();
        ctx.fill();
      }
    }

    // horns, far pair first
    for (let i = b.horns - 1; i >= 0; i--) {
      const len = b.hornLen * (1 - i * 0.22) * 2.2;
      const bx = -0.12 - i * 0.16;
      const by = -0.36 + i * 0.05;
      ctx.beginPath();
      ctx.moveTo(bx + 0.1, by + 0.04);
      ctx.quadraticCurveTo(bx - len * 0.25, by - len * 0.62, bx - len * 0.95, by - len * 0.55);
      ctx.quadraticCurveTo(bx - len * 0.45, by - len * 0.28, bx - 0.12, by + 0.1);
      ctx.closePath();
      const horn = ctx.createLinearGradient(bx, by, bx - len, by - len * 0.6);
      horn.addColorStop(0, '#8d8168');
      horn.addColorStop(1, '#f4ecd6');
      ctx.fillStyle = horn;
      ctx.fill();
      ctx.stroke();
    }

    // lower jaw, hinged
    ctx.save();
    ctx.translate(-0.02, 0.12);
    ctx.rotate(jaw);
    ctx.beginPath();
    ctx.moveTo(-0.3, 0);
    ctx.lineTo(0.85 * sn + 0.1, 0.0);
    ctx.quadraticCurveTo(0.9 * sn + 0.12, 0.13, 0.6 * sn, 0.2);
    ctx.quadraticCurveTo(0.05, 0.3, -0.34, 0.2);
    ctx.closePath();
    ctx.fillStyle = shade(this.color, -0.55);
    ctx.fill();
    ctx.stroke();
    if (jaw > 0.2) {
      // tongue and lower teeth
      ctx.fillStyle = '#b3243a';
      ctx.beginPath();
      ctx.ellipse(0.35 * sn, -0.02, 0.32 * sn, 0.07, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#f6f0dc';
      for (let i = 0; i < 4; i++) {
        const tx = (0.25 + i * 0.17) * sn + 0.08;
        ctx.beginPath();
        ctx.moveTo(tx - 0.035, 0);
        ctx.lineTo(tx, -0.11);
        ctx.lineTo(tx + 0.035, 0);
        ctx.fill();
      }
    }
    ctx.restore();

    // mouth interior glow when roaring
    if (roarK > 0.15) {
      const glow = ctx.createRadialGradient(0.45 * sn, 0.2, 0, 0.45 * sn, 0.2, 0.5);
      glow.addColorStop(0, rgba(shade(this.color, 0.6), 0.8 * roarK));
      glow.addColorStop(1, rgba(this.color, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(-0.2, -0.2, 1.6, 0.9);
    }

    // skull + snout
    ctx.beginPath();
    ctx.moveTo(-0.42, 0.1);
    ctx.quadraticCurveTo(-0.52, -0.3, -0.18, -0.42);
    ctx.quadraticCurveTo(0.12, -0.5, 0.3, -0.3); // brow ridge
    ctx.quadraticCurveTo(0.5 * sn + 0.12, -0.22, 0.82 * sn + 0.1, -0.2);
    ctx.quadraticCurveTo(1.0 * sn + 0.16, -0.17, 1.0 * sn + 0.14, -0.02); // nose
    ctx.quadraticCurveTo(0.98 * sn + 0.12, 0.1, 0.8 * sn + 0.1, 0.11);
    ctx.lineTo(0.0, 0.14);
    ctx.quadraticCurveTo(-0.25, 0.2, -0.42, 0.1);
    ctx.closePath();
    const skull = ctx.createLinearGradient(0, -0.5, 0, 0.2);
    skull.addColorStop(0, shade(this.color, 0.12));
    skull.addColorStop(0.5, shade(this.color, -0.3));
    skull.addColorStop(1, shade(this.color, -0.62));
    ctx.fillStyle = skull;
    ctx.fill();
    ctx.stroke();

    // upper teeth
    if (jaw > 0.2) {
      ctx.fillStyle = '#f6f0dc';
      for (let i = 0; i < 5; i++) {
        const tx = (0.2 + i * 0.15) * sn + 0.1;
        ctx.beginPath();
        ctx.moveTo(tx - 0.035, 0.12);
        ctx.lineTo(tx, 0.24);
        ctx.lineTo(tx + 0.035, 0.12);
        ctx.fill();
      }
    }

    // cheek scales
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 0.02;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(-0.2 + i * 0.13, -0.02, 0.09, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }

    // nostril
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.ellipse(0.86 * sn + 0.1, -0.1, 0.035, 0.022, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // eye — narrows in anger during the roar, blinks now and then
    const blink = this.t % 3.1 > 3.0 ? 0.15 : 1;
    const eh = b.eye * (1 - roarK * 0.35) * blink;
    const ex = 0.2;
    const ey = -0.2;
    ctx.save();
    ctx.shadowColor = shade(this.color, 0.5);
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(ex - b.eye * 1.25, ey + 0.02);
    ctx.quadraticCurveTo(ex, ey - eh * 1.6, ex + b.eye * 1.25, ey - 0.03);
    ctx.quadraticCurveTo(ex, ey + eh * 1.1, ex - b.eye * 1.25, ey + 0.02);
    ctx.closePath();
    ctx.fillStyle = this.rank === 5 ? '#fff6c8' : shade(this.color, 0.72);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#07040a';
    ctx.beginPath();
    ctx.ellipse(ex + 0.01, ey - 0.01, this.rank === 1 ? b.eye * 0.5 : b.eye * 0.2, Math.max(0.01, eh * 0.95), 0, 0, Math.PI * 2);
    ctx.fill();
    if (this.rank === 1) {
      // the whelp keeps a baby's round, shiny eye
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(ex - 0.03, ey - 0.05, b.eye * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // brow
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex - b.eye * 1.5, ey - b.eye * (0.9 - roarK * 0.5));
    ctx.quadraticCurveTo(ex, ey - b.eye * 1.5, ex + b.eye * 1.6, ey - b.eye * (0.5 - roarK * 0.7));
    ctx.stroke();

    // the Ancient's whiskers trail off the snout
    if (b.whiskers) {
      ctx.strokeStyle = rgba('#fff1b8', 0.85);
      ctx.lineWidth = 0.03;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0.9 * sn, 0.02);
        ctx.bezierCurveTo(
          1.2 * sn,
          0.2 * dir + Math.sin(this.t * 2) * 0.1,
          0.8 * sn,
          0.7 + 0.2 * dir,
          0.5 * sn + Math.sin(this.t * 1.6 + dir) * 0.15,
          1.05 + 0.15 * dir,
        );
        ctx.stroke();
      }
    }
  }

  private breathe(mouth: P, angle: number, u: number, roarK: number): void {
    const kind = this.breed.breath;
    const count = kind === 'puff' ? 1 : kind === 'frost' ? 2 : kind === 'spark' ? 3 : kind === 'fire' ? 5 : 8;
    const palette: Record<Breed['breath'], [string, string]> = {
      puff: ['#d8d8d8', '#6f6f78'],
      frost: ['#eaffff', '#4db8ff'],
      spark: ['#f3e6ff', '#9a5cf0'],
      fire: ['#fff3b0', '#ff5a1e'],
      sunfire: ['#ffffff', '#ffc21a'],
    };
    if (roarK < 0.25) return;
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * (kind === 'puff' ? 0.9 : 0.38);
      const speed = u * (kind === 'puff' ? 0.5 : kind === 'frost' ? 1.3 : 1.9 + Math.random() * 1.6) * (0.6 + Math.random() * 0.6);
      const max = kind === 'puff' ? 0.8 : 0.45 + Math.random() * 0.45;
      this.embers.push({
        x: mouth.x,
        y: mouth.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: max,
        max,
        size: u * (kind === 'puff' ? 0.06 : 0.035 + Math.random() * 0.05) * (this.rank === 5 ? 1.35 : 1),
        hot: palette[kind][0],
        cool: palette[kind][1],
        rise: u * (kind === 'frost' ? -0.4 : 1.1),
      });
    }
  }
}

// ---- colour helpers ----

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}
/** k > 0 lightens toward white, k < 0 darkens toward black. */
function shade(hex: string, k: number): string {
  const [r, g, b] = parse(hex).map(v => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
