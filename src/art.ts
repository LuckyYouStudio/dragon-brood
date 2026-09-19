// Hand-drawn vector art shared by the board and the nest. All canvas, no image assets.

export type Element = { name: string; light: string; mid: string; dark: string; glow: string };

export const ELEMENTS: Element[] = [
  { name: 'ember', light: '#ffb08a', mid: '#f0502e', dark: '#5c0f07', glow: '#ff6a3d' },
  { name: 'tide', light: '#a8e4ff', mid: '#2d9cf0', dark: '#08255e', glow: '#46b6ff' },
  { name: 'moss', light: '#c9f5a6', mid: '#46b854', dark: '#0c3d1c', glow: '#6fe07a' },
  { name: 'storm', light: '#e0c4ff', mid: '#9a5cf0', dark: '#2c0f66', glow: '#b88aff' },
  { name: 'sun', light: '#fff0b0', mid: '#f5b52a', dark: '#6e3a00', glow: '#ffd04a' },
  { name: 'bone', light: '#ffffff', mid: '#cfc6b4', dark: '#4f473b', glow: '#efe6d2' },
];

/** Egg silhouette centred on the origin: blunt base, narrower crown. */
export function eggPath(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const hw = w / 2;
  const hh = h / 2;
  ctx.beginPath();
  ctx.moveTo(0, -hh);
  ctx.bezierCurveTo(hw * 0.78, -hh, hw, -hh * 0.1, hw, hh * 0.22);
  ctx.bezierCurveTo(hw, hh * 0.72, hw * 0.56, hh, 0, hh);
  ctx.bezierCurveTo(-hw * 0.56, hh, -hw, hh * 0.72, -hw, hh * 0.22);
  ctx.bezierCurveTo(-hw, -hh * 0.1, -hw * 0.78, -hh, 0, -hh);
  ctx.closePath();
}

function glyph(ctx: CanvasRenderingContext2D, index: number, s: number): void {
  ctx.beginPath();
  switch (index) {
    case 0: // flame
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.9, -s * 0.1, s * 0.75, s * 0.9, 0, s);
      ctx.bezierCurveTo(-s * 0.75, s * 0.9, -s * 0.8, 0, -s * 0.25, -s * 0.25);
      ctx.bezierCurveTo(-s * 0.2, s * 0.1, 0, s * 0.05, 0, -s);
      break;
    case 1: // drop
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.2, -s * 0.4, s * 0.75, 0, s * 0.75, s * 0.35);
      ctx.arc(0, s * 0.35, s * 0.75, 0, Math.PI);
      ctx.bezierCurveTo(-s * 0.75, 0, -s * 0.2, -s * 0.4, 0, -s);
      break;
    case 2: // leaf
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s, -s * 0.5, s, s * 0.5, 0, s);
      ctx.bezierCurveTo(-s, s * 0.5, -s, -s * 0.5, 0, -s);
      break;
    case 3: // bolt
      ctx.moveTo(s * 0.25, -s);
      ctx.lineTo(-s * 0.6, s * 0.15);
      ctx.lineTo(-s * 0.05, s * 0.15);
      ctx.lineTo(-s * 0.3, s);
      ctx.lineTo(s * 0.6, -s * 0.2);
      ctx.lineTo(s * 0.05, -s * 0.2);
      break;
    case 4: // four-point star
      for (let i = 0; i < 8; i++) {
        const radius = i % 2 === 0 ? s : s * 0.36;
        const a = (i * Math.PI) / 4 - Math.PI / 2;
        ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * radius, Math.sin(a) * radius);
      }
      break;
    default: // crescent
      ctx.arc(0, 0, s * 0.9, Math.PI * 0.3, Math.PI * 1.7);
      ctx.arc(s * 0.42, 0, s * 0.68, Math.PI * 1.42, Math.PI * 0.58, true);
  }
  ctx.closePath();
}

/** Pre-renders one board egg per element at the given pixel size. */
export function makeEggSprites(size: number): HTMLCanvasElement[] {
  return ELEMENTS.map((element, index) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const w = size * 0.7;
    const h = size * 0.88;
    ctx.translate(size / 2, size / 2);

    // contact shadow
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(0, h * 0.47, w * 0.42, h * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();

    eggPath(ctx, w, h);
    const body = ctx.createRadialGradient(-w * 0.18, -h * 0.22, w * 0.05, 0, h * 0.05, h * 0.62);
    body.addColorStop(0, element.light);
    body.addColorStop(0.42, element.mid);
    body.addColorStop(1, element.dark);
    ctx.fillStyle = body;
    ctx.fill();

    ctx.save();
    eggPath(ctx, w, h);
    ctx.clip();
    // scale bands
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = Math.max(1, size * 0.018);
    for (let row = 0; row < 4; row++) {
      const y = h * (0.12 + row * 0.12);
      const n = 4;
      for (let k = 0; k < n; k++) {
        const x = (k - (n - 1) / 2 + (row % 2 ? 0.5 : 0)) * w * 0.27;
        ctx.beginPath();
        ctx.arc(x, y, w * 0.135, 0, Math.PI);
        ctx.stroke();
      }
    }
    // rim light from below
    const rim = ctx.createLinearGradient(0, h * 0.2, 0, h * 0.5);
    rim.addColorStop(0, 'rgba(255,255,255,0)');
    rim.addColorStop(1, 'rgba(255,255,255,0.22)');
    ctx.fillStyle = rim;
    ctx.fillRect(-w, 0, w * 2, h);
    ctx.restore();

    // element glyph
    ctx.save();
    ctx.translate(0, -h * 0.06);
    glyph(ctx, index, size * 0.13);
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.shadowColor = element.glow;
    ctx.shadowBlur = size * 0.12;
    ctx.fill();
    ctx.restore();

    // specular
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(-w * 0.2, -h * 0.3, w * 0.09, h * 0.045, -0.6, 0, Math.PI * 2);
    ctx.fill();

    eggPath(ctx, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(1, size * 0.02);
    ctx.stroke();
    return canvas;
  });
}

// ---- nest egg palettes (index = size) and hatchling eye colours (index = rank) ----

export const SIZE_PALETTE = [
  null,
  { shell: '#5d6b7a', dark: '#161b22', vein: '#9fd0ff' },
  { shell: '#2f7d78', dark: '#07201f', vein: '#6ff5e0' },
  { shell: '#5a3d9a', dark: '#140a2e', vein: '#c9a2ff' },
  { shell: '#8a2a2a', dark: '#220606', vein: '#ff8a5c' },
  { shell: '#8f6a17', dark: '#251703', vein: '#ffe07a' },
] as const;

export const RANK_COLOR = ['#8b8f98', '#7fd36b', '#4db8ff', '#b57aff', '#ff5a3c', '#ffd24a'] as const;
