// Mirror of DragonBroodGame.sol. The chain stays authoritative: live rounds are
// presented from the settled gameState; this table drives the paytable panel,
// the bet clamp and the standalone demo.

export const ROLL_DOMAIN = 1_000_000;
export const MAX_SIZE = 5;
export const RTP = 0.96;

export type Rank = 0 | 1 | 2 | 3 | 4 | 5;

export const RANK_NAMES = ['Dud', 'Whelp', 'Drake', 'Wyvern', 'Dragon', 'Ancient'] as const;
export const SIZE_NAMES = ['', 'Pebble', 'Clutch', 'Brood', 'Hoard', 'Elder'] as const;

/** Heat a nest must hold before an egg can grow to this size (index = size). */
export const SIZE_HEAT = [0, 0, 30, 80, 160, 300] as const;
export const HEAT_CAP = 600;

export type Row = { rank: Rank; weight: number; multX100: number };

/** Rows top tier first, exactly as the contract walks them. */
const TABLE: Record<number, Array<[number, number]>> = {
  1: [[10_000, 500], [40_000, 300], [120_000, 200], [200_000, 150], [250_000, 100]],
  2: [[4_000, 2_500], [12_000, 1_000], [40_000, 500], [140_000, 200], [260_000, 100]],
  3: [[1_000, 10_000], [6_000, 2_500], [20_000, 1_000], [60_000, 400], [180_000, 150]],
  4: [[200, 50_000], [1_500, 10_000], [8_000, 2_500], [30_000, 800], [135_000, 200]],
  5: [[40, 250_000], [300, 50_000], [2_000, 10_000], [12_000, 2_000], [90_000, 300]],
};

export function rows(size: number): Row[] {
  return TABLE[size].map(([weight, multX100], i) => ({
    rank: (5 - i) as Rank,
    weight,
    multX100,
  }));
}

export function maxMultiplierX(size: number): number {
  return TABLE[size][0][1] / 100;
}

export function dudChance(size: number): number {
  return 1 - TABLE[size].reduce((sum, [w]) => sum + w, 0) / ROLL_DOMAIN;
}

export function outcomeFromRoll(size: number, roll: number): { rank: Rank; multX100: number } {
  let cumulative = 0;
  const table = TABLE[size];
  for (let i = 0; i < table.length; i++) {
    cumulative += table[i][0];
    if (roll < cumulative) return { rank: (5 - i) as Rank, multX100: table[i][1] };
  }
  return { rank: 0, multX100: 0 };
}

export function payoutFor(wager: bigint, multX100: number): bigint {
  return (wager * BigInt(multX100)) / 100n;
}

export function maxReservedProfit(wager: bigint, size: number): bigint {
  return payoutFor(wager, TABLE[size][0][1]) - wager;
}

/** Uniform demo roll; rejection sampling over 32 bits so the demo is unbiased too. */
export function demoRoll(): number {
  const limit = Math.floor(0x1_0000_0000 / ROLL_DOMAIN) * ROLL_DOMAIN;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % ROLL_DOMAIN;
  }
}

// ---- ABI (single static words; no library needed) ----

export function encodeGameData(size: number): `0x${string}` {
  return `0x${size.toString(16).padStart(64, '0')}`;
}

export function decodeSize(gameData: string | undefined): number | null {
  if (!gameData || gameData.length !== 66) return null;
  const size = Number(BigInt(gameData));
  return size >= 1 && size <= MAX_SIZE ? size : null;
}

export type SettledState = { size: number; rank: Rank; multX100: number; roll: number };

/** gameState = abi.encode(uint8 size, uint8 rank, uint256 multX100, uint256 roll). */
export function decodeGameState(gameState: string | undefined): SettledState | null {
  if (!gameState || gameState.length !== 2 + 64 * 4) return null;
  const word = (i: number) => BigInt(`0x${gameState.slice(2 + i * 64, 2 + (i + 1) * 64)}`);
  const size = Number(word(0));
  const rank = Number(word(1));
  if (size < 1 || size > MAX_SIZE || rank > 5) return null;
  return { size, rank: rank as Rank, multX100: Number(word(2)), roll: Number(word(3)) };
}

// ---- token amounts ----

export function parseAmount(text: string, decimals: number): bigint | null {
  const trimmed = text.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;
  const [whole, fraction = ''] = trimmed.split('.');
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

export function formatAmount(value: bigint, decimals: number, maxFraction = 2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let fraction = (abs % base).toString().padStart(decimals, '0').slice(0, maxFraction);
  fraction = fraction.replace(/0+$/, '');
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${wholeText}${fraction ? `.${fraction}` : ''}`;
}

export function formatMult(multX100: number): string {
  const x = multX100 / 100;
  return `${Number.isInteger(x) ? x : x.toFixed(1)}×`;
}
