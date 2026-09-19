import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/900.css';
import './style.css';

import { RANK_COLOR, SIZE_PALETTE } from './art';
import { isMuted, setMuted, sfx, unlock } from './audio';
import { BoardView } from './boardview';
import { SparkLayer } from './fx';
import { connectHost, type HostLink } from './host';
import { applyStaticStrings, lang, rankName, setHostLocale, sizeName, t, toggleLang } from './i18n';
import { NestView } from './nest';
import {
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
  lang: $<HTMLButtonElement>('btn-lang'),
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
let heat = loadNumber('brood.heat', 0);
let size = 1;
let pinned: number | null = null; // a smaller size the player chose on purpose
let round: Round | null = null;
let error: string | null = null;
let demoBalance = DEMO_START;
let demoHistory: HistoryEntry[] = [];
let adoptChecked = false;
let resetTimer = 0;
let hitRank: Rank | null = null;

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

// ------------------------------------------------------------------ heat + size

function chooseSize(next: number, announce: boolean): void {
  size = next;
  nest.setSize(size, announce);
  hitRank = null;
  render();
}

function addHeat(amount: number): void {
  const before = maxUnlocked();
  heat = Math.min(HEAT_CAP, heat + amount);
  saveNumber('brood.heat', heat);
  const after = maxUnlocked();
  if (after > before && !inFlight() && pinned === null) chooseSize(after, true);
  else renderHeat();
}

board.onClear = ({ cells, combo, count }) => {
  const bonus = count >= 5 ? 5 : count === 4 ? 2 : 0;
  const total = count * combo + bonus;
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
      button.innerHTML = `<span class="size__egg"></span><span class="size__max">${maxMultiplierX(s)}×</span><span class="size__cost"></span>`;
      button.addEventListener('click', () => {
        unlock();
        if (inFlight() || heat < SIZE_HEAT[s]) {
          sfx.invalid();
          return;
        }
        pinned = s < maxUnlocked() ? s : null;
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
    unlocked < MAX_SIZE ? t('heatTo', { n: SIZE_HEAT[unlocked + 1] - heat, size: sizeName(unlocked + 1) }) : t('heatFull');
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
  el.balance.textContent = bal === undefined ? '—' : `${formatAmount(bal, decimals())} ${symbol()}`;

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
}

function render(): void {
  renderHeat();
  renderPaytable();
  renderBet();
  renderHistory();
}

function showResult(rank: Rank, multX100: number, wager: bigint, payout: bigint): void {
  const dud = rank === 0;
  el.result.className = `result show${dud ? ' result--dud' : ''}`;
  el.result.style.color = RANK_COLOR[rank];
  if (dud) {
    el.result.innerHTML = `<div class="result__mult">${t('coldShell')}</div><div class="result__pay">${t('nothing')}</div>`;
    return;
  }
  el.result.innerHTML = `<div class="result__rank">${rankName(rank)}</div><div class="result__mult">${formatMult(multX100)}</div><div class="result__pay"></div>`;
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
  round = null;
  hitRank = null;
  el.result.classList.remove('show');
  nest.reset();
  const unlocked = maxUnlocked();
  chooseSize(pinned !== null ? Math.min(pinned, unlocked) : unlocked, false);
}

async function present(rank: Rank, multX100: number, payout: bigint): Promise<void> {
  if (!round) return;
  const current = round;
  current.status = 'hatching';
  render();
  await nest.hatch(rank);
  hitRank = rank;
  showResult(rank, multX100, current.wager, payout);
  if (current.sessionId && link.api) {
    // Required guest step: the host withholds the payout from its balance displays until now.
    void link.api.revealOutcome({ sessionId: current.sessionId }).catch(() => {});
  }
  if (link.mode === 'demo') {
    demoBalance += payout;
    demoHistory = [{ key: String(Date.now()), rank, multX100 }, ...demoHistory].slice(0, 12);
  }
  current.status = 'done';
  render();
  resetTimer = window.setTimeout(finishRound, rank === 0 ? 1400 : 2400 + rank * 300);
}

async function crack(): Promise<void> {
  unlock();
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
    }, 1500 + Math.random() * 700);
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
  el.lang.textContent = t('language');
  document.title = lang() === 'zh' ? '龙巢 Dragon Brood — 三消养蛋，付费开蛋' : 'Dragon Brood — match the clutch, crack the egg';
  el.sizes.replaceChildren();
  if (el.info.open) el.infoBody.innerHTML = infoHtml();
}
el.lang.addEventListener('click', () => {
  unlock();
  sfx.select();
  toggleLang();
  error = null;
  renderLanguage();
  render();
});

function layout(): void {
  const avail = live() ? link.snapshot!.ui.viewport?.availableHeight : undefined;
  document.documentElement.style.setProperty('--avail', `${avail ?? window.innerHeight}px`);
  nest.resize();
  board.resize();
  sparks.resize();
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

size = maxUnlocked();
nest.setSize(size, false);
renderSound();
renderLanguage();
layout();
render();

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
