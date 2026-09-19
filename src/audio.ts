// Procedural sound: everything is synthesized, nothing is downloaded.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let rumble: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;

try {
  muted = window.localStorage.getItem('brood.muted') === '1';
} catch {
  /* storage may be blocked in a sandboxed iframe */
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  if (master && ctx) master.gain.setTargetAtTime(next ? 0 : 0.5, ctx.currentTime, 0.02);
  try {
    window.localStorage.setItem('brood.muted', next ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Call from a user gesture; browsers keep the context suspended until then. */
export function unlock(): void {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

type ToneOpts = {
  type?: OscillatorType;
  freq: number;
  to?: number;
  at?: number;
  dur: number;
  gain?: number;
  attack?: number;
};

function tone({ type = 'sine', freq, to, at = 0, dur, gain = 0.2, attack = 0.005 }: ToneOpts): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(at: number, dur: number, gain: number, filterFreq: number, type: BiquadFilterType = 'bandpass', q = 1): void {
  if (!ctx || !master) return;
  const t = ctx.currentTime + at;
  const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterFreq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start(t);
}

// D minor pentatonic — combos climb it.
const SCALE = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46, 783.99, 880.0, 1046.5, 1174.66];

export const sfx = {
  select(): void {
    tone({ type: 'triangle', freq: 660, dur: 0.06, gain: 0.08 });
  },
  swap(): void {
    tone({ type: 'sine', freq: 320, to: 480, dur: 0.09, gain: 0.1 });
  },
  invalid(): void {
    tone({ type: 'square', freq: 150, to: 95, dur: 0.16, gain: 0.07 });
  },
  match(combo: number, count: number): void {
    const note = SCALE[Math.min(combo - 1, SCALE.length - 1)];
    tone({ type: 'triangle', freq: note, dur: 0.28, gain: 0.16 });
    tone({ type: 'sine', freq: note * 2, dur: 0.2, gain: 0.07, at: 0.02 });
    if (count >= 4) tone({ type: 'sine', freq: note * 1.5, dur: 0.3, gain: 0.08, at: 0.06 });
    noise(0, 0.08, 0.12, 2400, 'highpass');
  },
  land(): void {
    noise(0, 0.05, 0.05, 300, 'lowpass');
  },
  shuffle(): void {
    for (let i = 0; i < 6; i++) noise(i * 0.05, 0.06, 0.06, 900 + i * 300);
  },
  heat(): void {
    tone({ type: 'sine', freq: 1200 + Math.random() * 600, dur: 0.07, gain: 0.03 });
  },
  grow(size: number): void {
    const root = 110 * 2 ** ((size - 1) / 6);
    tone({ type: 'sawtooth', freq: root, to: root * 2, dur: 0.5, gain: 0.08 });
    [1, 1.5, 2, 3].forEach((ratio, i) =>
      tone({ type: 'triangle', freq: root * 2 * ratio, dur: 0.6, gain: 0.09, at: 0.12 + i * 0.07 }),
    );
    noise(0, 0.5, 0.06, 500, 'lowpass');
  },
  shrink(): void {
    tone({ type: 'sine', freq: 420, to: 260, dur: 0.14, gain: 0.07 });
  },
  tap(): void {
    noise(0, 0.05, 0.25, 1800, 'bandpass', 3);
    tone({ type: 'square', freq: 210, to: 120, dur: 0.06, gain: 0.08 });
  },
  crack(intensity: number): void {
    noise(0, 0.12, 0.3, 2600 - intensity * 300, 'bandpass', 2);
    noise(0.03, 0.2, 0.18, 700, 'bandpass', 1.2);
    tone({ type: 'square', freq: 140, to: 60, dur: 0.12, gain: 0.1 });
  },
  burst(): void {
    noise(0, 0.6, 0.45, 900, 'lowpass');
    noise(0, 0.25, 0.3, 3200, 'highpass');
    tone({ type: 'sine', freq: 90, to: 36, dur: 0.6, gain: 0.35 });
  },
  dud(): void {
    tone({ type: 'sine', freq: 196, to: 98, dur: 0.7, gain: 0.14 });
    tone({ type: 'triangle', freq: 147, to: 73, dur: 0.9, gain: 0.1, at: 0.12 });
    noise(0.05, 0.9, 0.08, 400, 'lowpass');
  },
  win(rank: number): void {
    // A longer, brighter rise for rarer dragons; the Ancient gets a roar underneath.
    const notes = [0, 2, 4, 5, 7, 9].slice(0, 2 + rank);
    notes.forEach((n, i) => {
      tone({ type: 'triangle', freq: SCALE[n] * 1, dur: 0.5, gain: 0.16, at: i * 0.09 });
      tone({ type: 'sine', freq: SCALE[n] * 2, dur: 0.6, gain: 0.07, at: i * 0.09 + 0.02 });
    });
    const end = notes.length * 0.09;
    [0, 2, 4].forEach(n => tone({ type: 'sawtooth', freq: SCALE[n] / 2, dur: 1.2, gain: 0.05 + rank * 0.01, at: end }));
    if (rank >= 4) {
      tone({ type: 'sawtooth', freq: 70, to: 45, dur: 1.6, gain: 0.2, at: 0.05 });
      noise(0.05, 1.6, 0.2, 260, 'lowpass');
    }
  },
  /** The long fanfare under a big hatch: a climbing arpeggio that repeats for `seconds`. */
  jackpot(seconds: number): void {
    const pattern = [0, 2, 4, 5, 7, 5, 4, 2];
    const step = 0.11;
    const steps = Math.floor(seconds / step);
    for (let i = 0; i < steps; i++) {
      const octave = 1 + Math.floor(i / pattern.length) * 0.5;
      const note = SCALE[pattern[i % pattern.length]] * Math.min(2, octave);
      tone({ type: 'triangle', freq: note, dur: 0.22, gain: 0.1, at: i * step });
      if (i % 4 === 0) tone({ type: 'sine', freq: note / 2, dur: 0.4, gain: 0.12, at: i * step });
    }
    tone({ type: 'sawtooth', freq: SCALE[0] / 2, dur: seconds, gain: 0.05, attack: 0.3 });
    noise(0, 0.5, 0.2, 5000, 'highpass');
  },
  coach(): void {
    tone({ type: 'sine', freq: 880, dur: 0.12, gain: 0.06 });
    tone({ type: 'sine', freq: 1320, dur: 0.18, gain: 0.05, at: 0.08 });
  },
  count(): void {
    tone({ type: 'square', freq: 1320, dur: 0.03, gain: 0.025 });
  },
  rumbleStart(): void {
    if (!ctx || !master || rumble) return;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 52;
    lfo.frequency.value = 1.6; // heartbeat
    lfoGain.gain.value = 0.12;
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.4);
    lfo.connect(lfoGain).connect(gain.gain);
    osc.connect(gain).connect(master);
    osc.start();
    lfo.start();
    rumble = { osc, lfo, gain };
  },
  rumbleStop(): void {
    if (!ctx || !rumble) return;
    const { osc, lfo, gain } = rumble;
    rumble = null;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
    osc.stop(ctx.currentTime + 0.3);
    lfo.stop(ctx.currentTime + 0.3);
  },
};
