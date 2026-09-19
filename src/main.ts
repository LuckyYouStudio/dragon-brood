import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/900.css';
import './style.css';

import { RANK_COLOR, SIZE_PALETTE } from './art';
import { isMuted, setMuted, sfx, unlock } from './audio';
import { BoardView } from './boardview';
import { SparkLayer } from './fx';
import { Dragon } from './dragon';
import { connectHost, type HostLink } from './host';
import { LANGUAGES, applyStaticStrings, lang, rankName, setHostLocale, setLang, sizeName, t, type Lang } from './i18n';
import { NestView } from './nest';
import {
  CRACK_HEAT,
  DUD_HEAT_REFUND,
  HEAT_CAP,
  MAX_SIZE,
  RTP,
  SIZE_HEAT,
  decodeGameState,
  decodeSize,
  demoRoll,
  dudChance,
  encodeGameData,
  formatAmount,
  formatMult,
  maxMultiplierX,
  maxReservedProfit,
  outcomeFromRoll,
  parseAmount,
  payoutFor,
  rows,
  type Rank,
} from './paytable';
import { computeMaxWager } from './sdk/guest';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  badge: $('mode-badge'),
  balance: $('balance'),
  sound: $<HTMLButtonElement>('btn-sound'),
  lang: $<HTMLSelectElement>('btn-lang'),
  auto: $<HTMLButtonElement>('btn-auto'),
  infoBtn: $<HTMLButtonElement>('btn-info'),
  info: $<HTMLDialogElement>('info'),
  infoBody: $('info-body'),
  result: $('result'),
  sizes: $('sizes'),
  heatFill: $('heat-fill'),
  heatTicks: $('heat-ticks'),
  heatText: $('heat-text'),
  heatNext: $('heat-next'),
  payTitle: $('pay-title'),
  paySub: $('pay-sub'),
  payRows: $('pay-rows'),
  wager: $<HTMLInputElement>('wager'),
  symbol: $('symbol'),
  cta: $<HTMLButtonElement>('cta'),
  reason: $('reason'),
  history: $('history'),
  shell: $('app'),
  bigwin: $('bigwin'),
  coach: $('coach'),
  coachStep: $('coach-step'),
  coachText: $('coach-text'),
  coachSkip: $<HTMLButtonElement>('coach-skip'),
};

const nest = new NestView($<HTMLCanvasElement>('nest-canvas'));
const board = new BoardView($<HTMLCanvasElement>('board-canvas'));
const sparks = new SparkLayer($<HTMLCanvasElement>('fx-canvas'));

// ------------------------------------------------------------------ state

type Round = {
  size: number;
  wager: bigint;
  status: 'opening' | 'waiting' | 'hatching' | 'done';
  sessionKey?: string;
  sessionId?: string;
  openedAt: number;
  balanceFloor?: bigint; // balance shown while the outcome is still hidden
};

type HistoryEntry = { key: string; rank: Rank; multX100: number };

const DEMO_DECIMALS = 2;
const DEMO_START = 100_000n; // 1,000.00 play credits

let link: HostLink;
let heat = Math.min(HEAT_CAP, loadNumber('brood.heat', 0));
if (import.meta.env.DEV) {
  const forcedHeat = new URLSearchParams(location.search).get('heat'); // dev-only: ?heat=220
  if (forcedHeat !== null) heat = Number(forcedHeat);
}
let size = 1;
let round: Round | null = null;
let error: string | null = null;
let demoBalance = DEMO_START;
let demoHistory: HistoryEntry[] = [];
let adoptChecked = false;
let resetTimer = 0;
let hitRank: Rank | null = null;

/** The win on its way from the dragon's mouth to the balance, coin by coin. */
type CoinShow = {
  base: bigint; // balance before the payout
  payout: bigint;
  arrived: bigint;
  coins: number;
  landed: number;
  started: boolean;
  settled: boolean;
  sessionId?: string;
  holdUntil: number; // once settled, keep showing the full amount until the host's balance catches up
};
let coinShow: CoinShow | null = null;
let lastCoinSound = 0;

function loadNumber(key: string, fallback: number): number {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}
function saveNumber(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* storage can be blocked inside a sandboxed iframe */
  }
}

const live = () => link.mode === 'live' && link.snapshot !== null;
const decimals = () => (live() ? (link.snapshot!.token.decimals ?? 18) : DEMO_DECIMALS);
const symbol = () => (live() ? (link.snapshot!.token.symbol ?? '') : 'DEMO');
const inFlight = () => round !== null && round.status !== 'done';

function maxUnlocked(): number {
  let best = 1;
  for (let s = 2; s <= MAX_SIZE; s++) if (heat >= SIZE_HEAT[s]) best = s;
  return best;
}

function balance(): bigint | undefined {
  if (!live()) return link.mode === 'demo' ? demoBalance : undefined;
  const raw = link.snapshot!.balances.smartVaultBalance;
  if (raw === undefined) return undefined;
  const value = BigInt(raw);
  // Never let a settled win leak into the balance before the egg has hatched on screen.
  if (round?.balanceFloor !== undefined && inFlight() && value > round.balanceFloor) return round.balanceFloor;
  return value;
}

/** What the balance readout shows: the real balance, except while coins are still flying in. */
function displayBalance(): bigint | undefined {
  const actual = balance();
  if (!coinShow) return actual;
  if (!coinShow.settled) return coinShow.base + coinShow.arrived;
  const full = coinShow.base + coinShow.payout;
  if (actual === undefined || actual >= full || performance.now() > coinShow.holdUntil) {
    coinShow = null;
    return actual;
  }
  return full;
}

function renderBalance(): void {
  const shown = displayBalance();
  el.balance.textContent = shown === undefined ? '—' : `${formatAmount(shown, decimals())} ${symbol()}`;
}

function coinCountFor(multX100: number): number {
  if (multX100 >= 10_000) return 44;
  if (multX100 >= 2_000) return 30;
  if (multX100 >= 500) return 20;
  if (multX100 >= 200) return 13;
  return 8;
}

/** First roar: the dragon spits the payout toward the balance. */
function startCoins(seconds: number): void {
  const show = coinShow;
  if (!show || show.started || show.settled || show.payout === 0n) return;
  show.started = true;
  const share = show.payout / BigInt(show.coins);
  sparks.spitCoins(
    show.coins,
    Math.max(0.5, seconds * 0.9),
    () => {
      const rect = el.balance.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    },
    () => nest.center(),
    () => {
      if (coinShow !== show || show.settled) return;
      show.landed++;
      show.arrived = show.landed >= show.coins ? show.payout : show.arrived + share;
      const now = performance.now();
      if (now - lastCoinSound > 55) {
        lastCoinSound = now;
        sfx.coin();
      }
      el.balance.classList.remove('bump');
      void el.balance.offsetWidth;
      el.balance.classList.add('bump');
      renderBalance();
      if (show.landed >= show.coins) settleCoins();
    },
  );
}

/** Credits whatever has not landed yet and tells the host the presentation is over. Idempotent. */
function settleCoins(): void {
  const show = coinShow;
  if (!show || show.settled) return;
  show.settled = true;
  show.arrived = show.payout;
  show.holdUntil = performance.now() + 6000;
  sparks.clearCoins();
  if (show.sessionId && link.api) {
    // Required guest step: the host withholds the payout from its balance displays until now.
    void link.api.revealOutcome({ sessionId: show.sessionId }).catch(() => {});
  }
  window.setTimeout(() => el.balance.classList.remove('bump'), 400);
  renderBalance();
}

// ------------------------------------------------------------------ heat + size

function chooseSize(next: number, announce: boolean): void {
  size = next;
  saveNumber('brood.size', size);
  nest.setSize(size, announce);
  hitRank = null;
  render();
}

/**
 * Keeps the size the player picked; when the nest can no longer afford it, drops straight to the
 * egg the current heat does pay for — never upward, that stays the player's call.
 */
function fitSizeToHeat(): void {
  const affordable = maxUnlocked();
  if (size > affordable) chooseSize(affordable, true);
}

function addHeat(amount: number): void {
  const before = maxUnlocked();
  heat = Math.min(HEAT_CAP, heat + amount);
  saveNumber('brood.heat', heat);
  // A bigger egg is only ever offered, never chosen for the player: size is a bet decision.
  if (maxUnlocked() > before) sfx.unlock();
  renderHeat();
}

board.onClear = ({ cells, heat: total }) => {
  coachOnClear();
  const target = nest.center();
  const share = Math.floor(total / cells.length);
  cells.forEach((cell, i) => {
    const amount = i === cells.length - 1 ? total - share * (cells.length - 1) : share;
    sparks.emit(cell, target, cell.color, i * 0.035, () => {
      addHeat(amount);
      nest.pulseHeat();
      sfx.heat();
    });
  });
};

// ------------------------------------------------------------------ rendering

function renderSizes(): void {
  if (!el.sizes.childElementCount) {
    for (let s = 1; s <= MAX_SIZE; s++) {
      const button = document.createElement('button');
      button.className = 'size';
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.style.setProperty('--c', SIZE_PALETTE[s]!.vein);
      button.style.setProperty('--s', String(0.7 + s * 0.12));
      button.innerHTML = `<span class="size__egg"></span><span class="size__upto">${t('upTo')}</span><span class="size__max">${maxMultiplierX(s)}×</span><span class="size__cost"></span>`;
      button.addEventListener('click', () => {
        unlock();
        if (inFlight() || heat < SIZE_HEAT[s]) {
          sfx.invalid();
          return;
        }
        finishRound();
        chooseSize(s, true);
      });
      el.sizes.append(button);
    }
  }
  [...el.sizes.children].forEach((node, i) => {
    const s = i + 1;
    const button = node as HTMLButtonElement;
    const locked = heat < SIZE_HEAT[s];
    button.classList.toggle('locked', locked);
    button.classList.toggle('ready', !locked && s > size && !inFlight());
    button.setAttribute('aria-checked', String(s === size));
    button.setAttribute('aria-label', t('sizeAria', { size: sizeName(s), mult: maxMultiplierX(s) }));
    button.querySelector('.size__cost')!.textContent = s === 1 ? t('free') : locked ? t('heatCost', { n: SIZE_HEAT[s] }) : `−${SIZE_HEAT[s]}`;
  });
}

function renderHeat(): void {
  const top = SIZE_HEAT[MAX_SIZE];
  el.heatFill.style.width = `${Math.min(100, (heat / top) * 100)}%`;
  if (!el.heatTicks.childElementCount) {
    for (let s = 2; s < MAX_SIZE; s++) {
      const tick = document.createElement('span');
      tick.style.left = `${(SIZE_HEAT[s] / top) * 100}%`;
      el.heatTicks.append(tick);
    }
  }
  el.heatText.textContent = t('heat', { n: heat });
  const unlocked = maxUnlocked();
  el.heatNext.textContent =
    unlocked > size && !inFlight() ? t('biggerReady') : unlocked < MAX_SIZE ? t('heatTo', { n: SIZE_HEAT[unlocked + 1] - heat, size: sizeName(unlocked + 1) }) : t('heatFull');
  const span = unlocked < MAX_SIZE ? SIZE_HEAT[unlocked + 1] - SIZE_HEAT[unlocked] : 1;
  nest.setCharge(unlocked < MAX_SIZE ? (heat - SIZE_HEAT[unlocked]) / span : 1);
  renderSizes();
}

function renderPaytable(): void {
  el.payTitle.textContent = t('eggOf', { size: sizeName(size) });
  el.paySub.textContent = t('paySub', { rtp: (RTP * 100).toFixed(0), dud: (dudChance(size) * 100).toFixed(1) });
  el.payRows.innerHTML = rows(size)
    .map(
      row => `<div class="pay__row${hitRank === row.rank ? ' hit' : ''}" style="--c:${RANK_COLOR[row.rank]}">
        <span class="pay__eye"></span><span>${rankName(row.rank)}</span>
        <span class="pay__mult">${formatMult(row.multX100)}</span>
        <span class="pay__chance">${formatChance(row.weight)}</span></div>`,
    )
    .join('');
}

function formatChance(weight: number): string {
  const pct = weight / 10_000;
  return pct >= 1 ? `${pct.toFixed(pct >= 10 ? 0 : 1)}%` : t('oneIn', { n: Math.round(1_000_000 / weight).toLocaleString('en-US') });
}

function platformMaxWager(): bigint | undefined {
  if (!live()) return undefined;
  const result = computeMaxWager(link.snapshot, { maxMultiplierX: maxMultiplierX(size) });
  return result.kind === 'limit' ? result.maxWager : undefined;
}

function renderBet(): void {
  el.badge.hidden = link.mode !== 'demo';
  el.symbol.textContent = symbol();
  const bal = balance();
  renderBalance();

  const wager = parseAmount(el.wager.value, decimals());
  const walletStatus = live() ? link.snapshot!.wallet.status : 'ready';
  const maxWager = platformMaxWager();
  const cap = live() ? link.snapshot!.casino?.maxAllowedReservedProfit : undefined;
  const overRisk = wager !== null && cap !== undefined && maxReservedProfit(wager, size) > BigInt(cap);
  const overMax = wager !== null && maxWager !== undefined && wager > maxWager;
  const broke = wager !== null && bal !== undefined && wager > bal;

  let reason = '';
  if (link.mode === 'connecting') reason = '';
  else if (walletStatus === 'disconnected') reason = t('walletDisconnected');
  else if (walletStatus === 'setup-required') reason = t('walletSetup');
  else if (walletStatus === 'session-key-mismatch') reason = t('walletKey');
  else if (error) reason = error;
  else if (wager === null || wager === 0n) reason = t('enterPrice');
  else if (broke) reason = link.mode === 'demo' ? t('outOfCredits') : t('insufficient');
  else if (overRisk || overMax)
    reason =
      maxWager !== undefined
        ? t('houseLimit', { max: `${formatAmount(maxWager, decimals())} ${symbol()}`, size: sizeName(size) })
        : t('houseLimitPlain');

  el.reason.textContent = reason;
  if (link.mode === 'demo' && broke && !inFlight()) {
    const refill = document.createElement('button');
    refill.textContent = ` ${t('refill')}`;
    refill.addEventListener('click', () => {
      demoBalance = DEMO_START;
      render();
    });
    el.reason.append(refill);
  }
  if (live() && round?.status === 'waiting' && round.sessionId && performance.now() - round.openedAt > 45_000) {
    el.reason.textContent = `${t('slowChain')} `;
    const cancel = document.createElement('button');
    cancel.textContent = t('cancelRefund');
    cancel.addEventListener('click', () => {
      void link.api?.cancelStuckRandomness({ sessionId: round!.sessionId! }).catch(cause => {
        error = cause instanceof Error ? cause.message : t('cancelFailed');
        render();
      });
    });
    el.reason.append(cancel);
  }

  const ready =
    link.mode !== 'connecting' && walletStatus === 'ready' && !inFlight() && wager !== null && wager > 0n && !broke && !overRisk && !overMax;
  el.cta.disabled = !ready;
  const label =
    link.mode === 'connecting'
      ? t('ctaConnecting')
      : round?.status === 'opening'
        ? t('ctaSigning')
        : round?.status === 'waiting'
          ? t('ctaWaiting')
          : round?.status === 'hatching'
            ? t('ctaHatching')
            : t('cta');
  const sub = ready && wager ? `<small>${t('ctaSub', { wager: `${formatAmount(wager, decimals())} ${symbol()}`, max: formatAmount(payoutFor(wager, maxMultiplierX(size) * 100), decimals()) })}</small>` : '';
  el.cta.innerHTML = `${label}${sub}`;
}

function renderHistory(): void {
  let entries: HistoryEntry[] = demoHistory;
  if (live()) {
    const game = link.snapshot!.integration.gameAddress.toLowerCase();
    entries = link.snapshot!.sessions.items
      .filter(item => item.gameAddress.toLowerCase() === game && item.isSettled)
      .filter(item => !(inFlight() && (item.sessionKey === round!.sessionKey || item.sessionId === round!.sessionId)))
      .sort((a, b) => b.lastEventTimestamp - a.lastEventTimestamp)
      .flatMap(item => {
        const state = decodeGameState(item.raw.gameState);
        return state ? [{ key: item.sessionKey, rank: state.rank, multX100: state.multX100 }] : [];
      });
  }
  const shown = entries.slice(0, 12);
  const keys = `${lang()}|${shown.map(entry => entry.key).join('|')}`;
  if (el.history.dataset.keys === keys) return;
  el.history.dataset.keys = keys;
  el.history.innerHTML = shown
    .map(entry =>
      entry.rank === 0
        ? `<span class="chip dud">${t('dudChip')}</span>`
        : `<span class="chip" style="--c:${RANK_COLOR[entry.rank]}">${formatMult(entry.multX100)}</span>`,
    )
    .join('');
  fitHistory();
}

/** Only whole chips: whatever does not fit the row is dropped, never clipped. */
function fitHistory(): void {
  const width = el.history.clientWidth;
  if (!width) return;
  [...el.history.children].forEach(node => {
    const chip = node as HTMLElement;
    chip.hidden = false;
    chip.hidden = chip.offsetLeft - el.history.offsetLeft + chip.offsetWidth > width;
  });
}

function render(): void {
  renderHeat();
  renderPaytable();
  renderBet();
  renderHistory();
}

function showResult(rank: Rank, multX100: number, wager: bigint, payout: bigint, heatRefund: number): void {
  const dud = rank === 0;
  el.result.className = `result show${dud ? ' result--dud' : ''}`;
  el.result.style.color = RANK_COLOR[rank];
  if (dud) {
    const back = heatRefund > 0 ? `<div class="result__heat">${t('heatBack', { n: heatRefund })}</div>` : '';
    el.result.innerHTML = `<div class="result__mult">${t('coldShell')}</div><div class="result__pay">${t('nothing')}</div>${back}`;
    return;
  }
  el.result.innerHTML = `<div class="result__rank">${rankName(rank)}</div><div class="result__mult">${formatMult(multX100)}</div><div class="result__pay"></div><div class="result__heat">${t('crackHeat', { n: heatRefund })}</div>`;
  const pay = el.result.querySelector('.result__pay') as HTMLElement;
  const start = performance.now();
  const duration = 500 + rank * 220;
  const tick = () => {
    const k = Math.min(1, (performance.now() - start) / duration);
    const shown = (payout * BigInt(Math.round((1 - (1 - k) ** 3) * 1000))) / 1000n;
    pay.textContent = `+${formatAmount(shown, decimals())} ${symbol()}`;
    if (k < 1) {
      if (Math.random() < 0.5) sfx.count();
      requestAnimationFrame(tick);
    } else if (payout < wager) pay.textContent = t('back', { amount: `${formatAmount(payout, decimals())} ${symbol()}` });
  };
  tick();
}

// ------------------------------------------------------------------ rounds

function finishRound(): void {
  window.clearTimeout(resetTimer);
  if (!round || round.status !== 'done') return;
  settleCoins(); // a player who moves on early still gets every coin
  round = null;
  hitRank = null;
  el.result.classList.remove('show');
  el.bigwin.classList.remove('show');
  el.shell.classList.remove('quake');
  sparks.stopCelebration();
  sparks.dismissDragon();
  nest.reset();
  fitSizeToHeat();
  render();
}

async function present(rank: Rank, multX100: number, payout: bigint): Promise<void> {
  if (!round) return;
  const current = round;
  current.status = 'hatching';
  render();
  // Balance before the payout: the floor we have been showing since the bet left.
  const base = link.mode === 'demo' ? demoBalance : (current.balanceFloor ?? balance() ?? 0n);
  await nest.hatch(rank, () => {
    if (rank === 0) return;
    coinShow = {
      base,
      payout,
      arrived: 0n,
      coins: coinCountFor(multX100),
      landed: 0,
      started: false,
      settled: false,
      sessionId: current.sessionId,
      holdUntil: 0,
    };
    sparks.setDragon(new Dragon(rank, onDragonRoar), () => nest.hatchEdge());
  });
  hitRank = rank;
  // A cold shell keeps the nest warm: part of the egg's heat comes back.
  // …and every crack, win or lose, warms it a little. Flat, never tied to the price.
  const heatRefund = CRACK_HEAT + (rank === 0 ? Math.floor(SIZE_HEAT[current.size] * DUD_HEAT_REFUND) : 0);
  addHeat(heatRefund);
  nest.pulseHeat();
  showResult(rank, multX100, current.wager, payout, heatRefund);
  const level = celebrationLevel(rank, multX100);
  const hold = celebrate(level, rank, multX100, payout);
  if (rank === 0 && current.sessionId && link.api) {
    // Nothing to present for a loss; winning rounds reveal once the last coin lands (settleCoins).
    void link.api.revealOutcome({ sessionId: current.sessionId }).catch(() => {});
  }
  if (link.mode === 'demo') {
    demoBalance += payout;
    demoHistory = [{ key: String(Date.now()), rank, multX100 }, ...demoHistory].slice(0, 12);
  }
  current.status = 'done';
  // Show the egg the next crack will really use right away, not only once the nest resets.
  fitSizeToHeat();
  hitRank = size === current.size ? rank : null;
  render();
  resetTimer = window.setTimeout(finishRound, hold || (rank === 0 ? 1500 : 2200 + rank * 250));
}

function onDragonRoar(rank: number, seconds: number, first: boolean): void {
  sfx.roar(rank, seconds);
  if (first) startCoins(seconds);
  if (rank >= 4 && first && !(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)) {
    el.shell.classList.remove('quake');
    void el.shell.offsetWidth; // restart the animation
    el.shell.classList.add('quake');
  }
}

/** 0 = ordinary, 1 = a flourish, 2 = big hatch banner, 3 = the legendary treatment. */
function celebrationLevel(rank: Rank, multX100: number): number {
  if (multX100 >= 10_000) return 3;
  if (multX100 >= 2_000) return 2;
  if (multX100 >= 500 || rank >= 4) return 1;
  return 0;
}

/** Returns how long the round should hold before the nest resets (0 = default). */
function celebrate(level: number, rank: Rank, multX100: number, payout: bigint): number {
  if (level === 0) return 0;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (level === 1) {
    if (!reduced) sparks.celebrate(1.2, 70, RANK_COLOR[rank]);
    return 0;
  }
  const seconds = level === 3 ? 7 : 4;
  if (!reduced) {
    sparks.celebrate(seconds - 0.8, level === 3 ? 170 : 100, RANK_COLOR[rank]);
    if (level === 3) el.shell.classList.add('quake');
  }
  sfx.jackpot(seconds - 1);
  el.bigwin.style.setProperty('--c', RANK_COLOR[rank]);
  el.bigwin.innerHTML = `<div class="bigwin__title">${t(level === 3 ? 'bigWin3' : 'bigWin2')}</div>
    <div class="bigwin__rank">${rankName(rank)}</div>
    <div class="bigwin__mult">${formatMult(multX100)}</div>
    <div class="bigwin__pay"></div>
    <div class="bigwin__hint">${t('tapToContinue')}</div>`;
  el.bigwin.classList.add('show');
  const pay = el.bigwin.querySelector('.bigwin__pay') as HTMLElement;
  const start = performance.now();
  const duration = (seconds - 1.5) * 1000;
  const tick = () => {
    if (!el.bigwin.classList.contains('show')) return;
    const k = Math.min(1, (performance.now() - start) / duration);
    const shown = (payout * BigInt(Math.round((1 - (1 - k) ** 3) * 10_000))) / 10_000n;
    pay.textContent = `+${formatAmount(shown, decimals())} ${symbol()}`;
    if (k < 1) {
      if (Math.random() < 0.4) sfx.count();
      requestAnimationFrame(tick);
    }
  };
  tick();
  return seconds * 1000;
}
el.bigwin.addEventListener('click', finishRound);

async function crack(): Promise<void> {
  unlock();
  coachDone();
  finishRound();
  const wager = parseAmount(el.wager.value, decimals());
  if (!wager || inFlight()) return;
  error = null;
  const bet: Round = { size, wager, status: 'opening', openedAt: performance.now() };
  const bal = balance();
  round = bet;
  nest.startCracking();
  render();

  if (link.mode === 'demo') {
    demoBalance -= wager;
    spendHeat(bet.size);
    bet.status = 'waiting';
    render();
    const roll = demoRoll();
    window.setTimeout(() => {
      let outcome = outcomeFromRoll(bet.size, roll);
      // Dev-only art check: ?rank=5 forces what hatches. Stripped from production builds.
      const forced = import.meta.env.DEV ? new URLSearchParams(location.search).get('rank') : null;
      if (forced !== null) outcome = rows(bet.size).find(row => row.rank === Number(forced)) ?? { rank: 0, multX100: 0 };
      void present(outcome.rank, outcome.multX100, payoutFor(wager, outcome.multX100));
    }, 1100 + Math.random() * 500);
    return;
  }

  try {
    if (bal !== undefined) bet.balanceFloor = bal - wager;
    const { sessionKey } = await link.api!.openSession({
      wager: wager.toString(),
      gameData: encodeGameData(bet.size),
    });
    bet.sessionKey = sessionKey;
    bet.status = 'waiting';
    spendHeat(bet.size);
    settleFromSnapshot();
    render();
  } catch (cause) {
    round = null;
    nest.cancelCracking();
    error = friendlyError(cause);
    render();
  }
}

function spendHeat(spentSize: number): void {
  heat = Math.max(0, heat - SIZE_HEAT[spentSize]);
  saveNumber('brood.heat', heat);
}

function friendlyError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  if (/BetRiskExceedsLimit|InsufficientPortfolioReserve/i.test(message)) return t('errRisk');
  if (/reject|denied|cancel/i.test(message)) return t('errCancelled');
  if (/insufficient/i.test(message)) return t('insufficient');
  return message ? message.slice(0, 140) : t('errGeneric');
}

/** Moves the live round forward from the latest host snapshot. */
function settleFromSnapshot(): void {
  if (!live() || !round || round.status !== 'waiting') return;
  const current = round;
  const row = link.snapshot!.sessions.items.find(
    item => item.sessionKey === current.sessionKey || (current.sessionId !== undefined && item.sessionId === current.sessionId),
  );
  if (!row) return;
  if (!row.sessionId.startsWith('pending')) current.sessionId = row.sessionId;
  const terminal = row.isSettled || row.phaseName === 'SETTLED' || row.phaseName === 'FORFEITED' || row.phaseName === 'CANCELLED';
  if (!terminal) return;

  if (row.phaseName === 'CANCELLED' || row.phaseName === 'FORFEITED') {
    round = null;
    nest.cancelCracking();
    error = t('errChainCancelled');
    return;
  }

  const state = decodeGameState(row.raw.gameState);
  if (state) {
    void present(state.rank, state.multX100, row.payout !== undefined ? BigInt(row.payout) : payoutFor(current.wager, state.multX100));
    return;
  }
  // Older hosts may lag the gameState behind the payout; the payout alone identifies the row.
  if (row.payout !== undefined) {
    const payout = BigInt(row.payout);
    const match = rows(current.size).find(candidate => payoutFor(current.wager, candidate.multX100) === payout);
    if (payout === 0n) void present(0, 0, 0n);
    else if (match) void present(match.rank, match.multX100, payout);
  }
}

/** After a refresh mid-round, pick the open session back up instead of starting blank. */
function adoptOpenSession(): void {
  if (adoptChecked || !live()) return;
  adoptChecked = true;
  const game = link.snapshot!.integration.gameAddress.toLowerCase();
  const open = link.snapshot!.sessions.items.find(
    item => item.gameAddress.toLowerCase() === game && !item.isSettled && item.phaseName === 'WAITING_RANDOMNESS',
  );
  const openSize = open ? decodeSize(open.raw.gameData) : null;
  if (!open || !openSize || !open.wager) return;
  size = openSize;
  nest.setSize(size, false);
  round = { size: openSize, wager: BigInt(open.wager), status: 'waiting', sessionKey: open.sessionKey, sessionId: open.sessionId, openedAt: performance.now() };
  nest.startCracking();
}

// ------------------------------------------------------------------ wiring

el.cta.addEventListener('click', () => void crack());
el.wager.addEventListener('input', () => {
  error = null;
  renderBet();
});
el.wager.addEventListener('blur', () => {
  const wager = parseAmount(el.wager.value, decimals());
  if (wager !== null) el.wager.value = formatAmount(wager, decimals(), Math.min(decimals(), 6)).replace(/,/g, '');
});
document.querySelectorAll<HTMLButtonElement>('[data-quick]').forEach(button =>
  button.addEventListener('click', () => {
    unlock();
    sfx.select();
    const current = parseAmount(el.wager.value, decimals()) ?? 0n;
    const bal = balance();
    const platform = platformMaxWager();
    let ceiling = bal;
    if (platform !== undefined && (ceiling === undefined || platform < ceiling)) ceiling = platform;
    let next = current;
    if (button.dataset.quick === 'half') next = current / 2n;
    if (button.dataset.quick === 'double') next = current * 2n;
    if (button.dataset.quick === 'max' && ceiling !== undefined) next = ceiling;
    if (ceiling !== undefined && next > ceiling) next = ceiling;
    const floor = 10n ** BigInt(Math.max(0, decimals() - 2));
    if (next < floor) next = floor;
    el.wager.value = formatAmount(next, decimals(), Math.min(decimals(), 6)).replace(/,/g, '');
    error = null;
    render();
  }),
);

// Auto-match: for players who came to crack eggs, not to swap them.
let autoMatch = false;
try {
  autoMatch = window.localStorage.getItem('brood.auto') === '1';
} catch {
  /* storage may be blocked in a sandboxed iframe */
}
function renderAuto(): void {
  el.auto.setAttribute('aria-pressed', String(autoMatch));
  el.auto.title = t('autoHint');
  board.setAuto(autoMatch);
}
el.auto.addEventListener('click', () => {
  unlock();
  sfx.select();
  autoMatch = !autoMatch;
  try {
    window.localStorage.setItem('brood.auto', autoMatch ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (autoMatch) coachDone();
  renderAuto();
});

function renderSound(): void {
  el.sound.textContent = isMuted() ? '🔇' : '🔊';
}
el.sound.addEventListener('click', () => {
  unlock();
  setMuted(!isMuted());
  renderSound();
});
el.infoBtn.addEventListener('click', () => {
  el.infoBody.innerHTML = infoHtml();
  el.info.showModal();
});

el.info.addEventListener('click', event => {
  if (event.target === el.info) el.info.close(); // a click on the backdrop
});

function infoHtml(): string {
  const table = [1, 2, 3, 4, 5]
    .map(s => {
      const cells = rows(s)
        .slice()
        .reverse()
        .map(row => `<td>${formatMult(row.multX100)}<small>${formatChance(row.weight)}</small></td>`)
        .join('');
      return `<tr><td>${sizeName(s)}<small>${SIZE_HEAT[s] ? t('heatCost', { n: SIZE_HEAT[s] }) : t('free')}</small></td>${cells}<td>${(dudChance(s) * 100).toFixed(1)}%</td></tr>`;
    })
    .join('');
  const head = [1, 2, 3, 4, 5, 0].map(rank => `<th>${rankName(rank)}</th>`).join('');
  return `<h2>${t('title')}</h2>
  <ol><li>${t('infoStep1')}</li><li>${t('infoStep2')}</li><li>${t('infoStep3')}</li></ol>
  <h3>${t('infoTable')}</h3>
  <table><tr><th>${t('infoEgg')}</th>${head}</tr>${table}</table>
  <h3>${t('infoFairTitle')}</h3>
  <p>${t('infoFair')}</p>`;
}

function renderLanguage(): void {
  applyStaticStrings();
  if (!el.lang.options.length) {
    for (const entry of LANGUAGES) el.lang.add(new Option(entry.name, entry.code));
  }
  el.lang.value = lang();
  el.lang.setAttribute('aria-label', t('language'));
  el.auto.title = t('autoHint');
  document.title = lang() === 'zh' ? '龙巢 Dragon Brood — 三消养蛋，付费开蛋' : `Dragon Brood — ${t('cta')}`;
  el.sizes.replaceChildren();
  if (el.info.open) el.infoBody.innerHTML = infoHtml();
  if (coachStep > 0) placeCoach();
}
el.lang.addEventListener('change', () => {
  unlock();
  sfx.select();
  setLang(el.lang.value as Lang);
  error = null;
  renderLanguage();
  render();
});

// ------------------------------------------------------------------ first-run coach

let coachStep = 0; // 0 = off
let coachTimer = 0;

function coachSeen(): boolean {
  try {
    return window.localStorage.getItem('brood.coached') === '1';
  } catch {
    return false;
  }
}

function coachTarget(): HTMLElement | null {
  if (coachStep === 1) return $('board-canvas');
  if (coachStep === 2) return $('nest-canvas');
  if (coachStep === 3) return el.cta;
  return null;
}

function placeCoach(): void {
  document.querySelectorAll('.coach-target').forEach(node => node.classList.remove('coach-target'));
  const target = coachTarget();
  el.coach.hidden = !target;
  if (!target) return;
  target.classList.add('coach-target');
  el.coachStep.textContent = String(coachStep);
  el.coachText.textContent = t(`coach${coachStep}` as 'coach1');
  el.coachSkip.textContent = t('coachSkip');
  const shell = el.shell.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  const bubble = el.coach.getBoundingClientRect();
  let left = rect.left - shell.left + rect.width / 2 - bubble.width / 2;
  left = Math.max(8, Math.min(shell.width - bubble.width - 8, left));
  // Over the board the bubble sits inside its top edge; elsewhere it floats just above the target.
  let top = coachStep === 1 ? rect.top - shell.top + 10 : rect.top - shell.top - bubble.height - 10;
  if (top < 4) top = rect.bottom - shell.top + 10;
  el.coach.style.left = `${left}px`;
  el.coach.style.top = `${top}px`;
}

function coachGo(step: number): void {
  window.clearTimeout(coachTimer);
  coachStep = step;
  if (step > 0) sfx.coach();
  placeCoach();
  if (step === 1) board.showHint();
  if (step === 2) coachTimer = window.setTimeout(() => coachGo(3), 5500);
  if (step === 3) coachTimer = window.setTimeout(coachDone, 9000);
}

function coachOnClear(): void {
  if (coachStep === 1) coachTimer = window.setTimeout(() => coachGo(2), 500);
  else if (coachStep === 2) coachTimer = window.setTimeout(() => coachGo(3), 900);
}

function coachDone(): void {
  if (coachStep === 0) return;
  coachGo(0);
  try {
    window.localStorage.setItem('brood.coached', '1');
  } catch {
    /* ignore */
  }
}
el.coachSkip.addEventListener('click', coachDone);

function layout(): void {
  const avail = live() ? link.snapshot!.ui.viewport?.availableHeight : undefined;
  document.documentElement.style.setProperty('--avail', `${avail ?? window.innerHeight}px`);
  nest.resize();
  board.resize();
  sparks.resize();
  fitHistory();
  if (coachStep > 0) placeCoach();
}
new ResizeObserver(layout).observe($('app'));
window.addEventListener('resize', layout);

link = connectHost(() => {
  if (setHostLocale(link.snapshot?.ui.locale)) renderLanguage();
  adoptOpenSession();
  settleFromSnapshot();
  layout();
  render();
});

size = Math.min(loadNumber('brood.size', 1), maxUnlocked());
nest.setSize(size, false);
renderSound();
renderAuto();
renderLanguage();
layout();
render();

if (!coachSeen()) window.setTimeout(() => coachGo(1), 1600);

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  nest.update(dt);
  board.update(dt);
  sparks.update(dt);
  nest.draw();
  board.draw();
  sparks.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// The stuck-round escape hatch appears on a timer, not on a snapshot.
window.setInterval(() => {
  if (round?.status === 'waiting') renderBet();
}, 5000);
