// English + Chinese. Inside the host the language follows `snapshot.ui.locale`; standalone it
// follows the browser. The toggle in the top bar overrides both and is remembered.

export type Lang = 'en' | 'zh';

const STRINGS = {
  en: {
    title: 'Dragon Brood',
    demo: 'DEMO',
    balance: 'Balance',
    howTo: 'How to play',
    sound: 'Toggle sound',
    language: '中文',
    nest: 'Nest',
    eggSize: 'Egg size',
    board: 'Match-3 board',
    boardHint: 'Match 3 to feed the nest. Matching is free — only cracking costs.',
    crackPrice: 'Crack price',
    max: 'Max',
    recent: 'Recent hatches',
    rank0: 'Dud',
    rank1: 'Whelp',
    rank2: 'Drake',
    rank3: 'Wyvern',
    rank4: 'Dragon',
    rank5: 'Ancient',
    size1: 'Pebble',
    size2: 'Clutch',
    size3: 'Brood',
    size4: 'Hoard',
    size5: 'Elder',
    eggOf: '{size} egg',
    sizeAria: '{size} egg, up to {mult}×',
    upTo: 'up to',
    free: 'free',
    heatCost: '{n} heat',
    heat: 'Heat {n}',
    heatTo: '{n} to {size} egg',
    heatFull: 'Elder egg ready',
    paySub: 'RTP {rtp}% · dud {dud}%',
    oneIn: '1 in {n}',
    dudChip: 'dud',
    coldShell: 'Cold shell',
    heatBack: '+{n} heat stays in the nest',
    bigWin2: 'Big hatch',
    bigWin3: 'Legendary hatch',
    tapToContinue: 'tap to continue',
    coach1: 'Swap two eggs to line up 3 of a kind. Matching is free.',
    coach2: 'Every match sends heat to the nest — enough heat and the egg grows.',
    coach3: 'Bigger egg, bigger dragons. Pay to crack it whenever you like.',
    coachSkip: 'Skip',
    nothing: 'nothing hatched',
    back: '{amount} back',
    ctaConnecting: 'Waking the nest…',
    ctaSigning: 'Signing…',
    ctaWaiting: 'Something stirs…',
    ctaHatching: 'Hatching…',
    cta: 'Crack the egg',
    ctaSub: '{wager} · win up to {max}',
    walletDisconnected: 'Connect your wallet in the host app to crack eggs.',
    walletSetup: 'Finish setting up your Smart Vault in the host app to crack eggs.',
    walletKey: 'Restore your session key in the host app before betting.',
    enterPrice: 'Enter a crack price.',
    outOfCredits: 'Out of play credits.',
    refill: 'Refill',
    insufficient: 'Insufficient balance.',
    houseLimit: 'The house can cover up to {max} on a {size} egg right now.',
    houseLimitPlain: 'That win would exceed the current house risk limit.',
    slowChain: 'The chain is slow to answer.',
    cancelRefund: 'Cancel and refund',
    cancelFailed: 'Could not cancel yet.',
    errRisk: 'The house cannot cover that win right now — lower the price or pick a smaller egg.',
    errCancelled: 'Bet cancelled.',
    errGeneric: 'The bet could not be placed.',
    errChainCancelled: 'The round was cancelled on-chain and your stake refunded.',
    infoStep1: '<b>Match eggs</b> on the board. It is free, and every egg you clear sends heat to the nest. Chains multiply it.',
    infoStep2: '<b>Heat grows the egg.</b> A bigger egg holds bigger dragons — and more cold shells.',
    infoStep3: "<b>Pay to crack it.</b> What hatches pays its multiplier on your crack price. The egg's heat is spent; the rest stays in the nest, and a cold shell gives half of it back.",
    infoTable: 'What can hatch',
    infoEgg: 'Egg',
    infoFairTitle: 'Fair by construction',
    infoFair:
      "Every egg size returns exactly <b>96%</b>. Size changes how wild the ride is, never the edge — so nothing you do on the board can tilt the odds, for or against you. One verifiable random word from Chain's VRF becomes one roll in a million by rejection sampling (no modulo bias), and that roll picks the row above. The contract exposes <code>previewOutcome</code> so anyone can re-derive a hatch from its random word.",
  },
  zh: {
    title: '龙巢',
    demo: '试玩',
    balance: '余额',
    howTo: '玩法说明',
    sound: '声音开关',
    language: 'EN',
    nest: '龙巢',
    eggSize: '龙蛋大小',
    board: '三消棋盘',
    boardHint: '三个同色连成一线即可消除，为龙巢供热。消除免费，只有开蛋才花钱。',
    crackPrice: '开蛋价格',
    max: '最大',
    recent: '最近开蛋',
    rank0: '空壳',
    rank1: '幼龙',
    rank2: '飞龙',
    rank3: '双足龙',
    rank4: '巨龙',
    rank5: '远古龙',
    size1: '卵石',
    size2: '小巢',
    size3: '龙巢',
    size4: '宝藏',
    size5: '长老',
    eggOf: '{size}蛋',
    sizeAria: '{size}蛋，最高 {mult}×',
    upTo: '最高',
    free: '免费',
    heatCost: '{n} 热量',
    heat: '热量 {n}',
    heatTo: '再 {n} 升级为{size}蛋',
    heatFull: '长老蛋已就绪',
    paySub: '回报率 {rtp}% · 空壳 {dud}%',
    oneIn: '{n} 分之一',
    dudChip: '空',
    coldShell: '冷壳',
    heatBack: '余温 +{n} 热量留在巢里',
    bigWin2: '大丰收',
    bigWin3: '传说降临',
    tapToContinue: '点击继续',
    coach1: '交换相邻两个蛋，让 3 个同色连成一线。消除是免费的。',
    coach2: '每次消除都会给龙巢送去热量——热量够了，蛋就会长大。',
    coach3: '蛋越大，龙越大。想开的时候随时付费开蛋。',
    coachSkip: '跳过',
    nothing: '什么都没孵出来',
    back: '返还 {amount}',
    ctaConnecting: '正在唤醒龙巢…',
    ctaSigning: '签名中…',
    ctaWaiting: '壳里有动静…',
    ctaHatching: '破壳中…',
    cta: '开蛋',
    ctaSub: '{wager} · 最高可赢 {max}',
    walletDisconnected: '请先在主站连接钱包再开蛋。',
    walletSetup: '请先在主站完成 Smart Vault 设置再开蛋。',
    walletKey: '请先在主站恢复会话密钥再下注。',
    enterPrice: '请输入开蛋价格。',
    outOfCredits: '试玩币用完了。',
    refill: '补满',
    insufficient: '余额不足。',
    houseLimit: '当前庄家池对{size}蛋最多可承接 {max}。',
    houseLimitPlain: '该注的最高赢额超过了当前庄家风险上限。',
    slowChain: '链上响应较慢。',
    cancelRefund: '取消并退款',
    cancelFailed: '暂时还不能取消。',
    errRisk: '庄家池暂时无法承接这笔赢额——请降低价格或换小一点的蛋。',
    errCancelled: '已取消下注。',
    errGeneric: '下注失败。',
    errChainCancelled: '本局已在链上取消，本金已退回。',
    infoStep1: '在棋盘上<b>消除龙蛋</b>。消除免费，每消一个蛋都会给龙巢送去热量，连消还有加成。',
    infoStep2: '<b>热量让蛋长大。</b>蛋越大，能孵出的龙越大——空壳也越多。',
    infoStep3: '<b>付费开蛋。</b>孵出什么，就按它的倍率乘以开蛋价格赔付。开蛋会消耗该档位的热量，剩余热量留在巢里；开出冷壳会返还一半热量。',
    infoTable: '能孵出什么',
    infoEgg: '龙蛋',
    infoFairTitle: '从设计上保证公平',
    infoFair:
      '每个尺寸的蛋回报率都精确为 <b>96%</b>。蛋的大小只改变波动，不改变庄家优势——所以你在棋盘上的任何操作都不会让赔率变好或变差。Chain 的 VRF 提供一个可验证随机数，经拒绝采样（无取模偏差）变成百万分之一精度的一次掷点，再由它选中上表中的一行。合约公开了 <code>previewOutcome</code>，任何人都能用随机数复算开蛋结果。',
  },
} as const;

export type Key = keyof (typeof STRINGS)['en'];

const STORAGE_KEY = 'brood.lang';
let override: Lang | null = null;
let hostLocale: string | undefined;

try {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'en' || saved === 'zh') override = saved;
} catch {
  /* storage may be blocked in a sandboxed iframe */
}

const fromLocale = (locale: string | undefined): Lang => (locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en');

export function lang(): Lang {
  return override ?? fromLocale(hostLocale ?? navigator.language);
}

/** Returns true when the effective language changed. */
export function setHostLocale(locale: string | undefined): boolean {
  const before = lang();
  hostLocale = locale;
  return lang() !== before;
}

export function toggleLang(): void {
  override = lang() === 'en' ? 'zh' : 'en';
  try {
    window.localStorage.setItem(STORAGE_KEY, override);
  } catch {
    /* ignore */
  }
}

export function t(key: Key, params?: Record<string, string | number>): string {
  let text: string = STRINGS[lang()][key];
  if (params) for (const [name, value] of Object.entries(params)) text = text.replace(`{${name}}`, String(value));
  return text;
}

export const rankName = (rank: number) => t(`rank${rank}` as Key);
export const sizeName = (size: number) => t(`size${size}` as Key);

/** Applies the static strings marked up in index.html. */
export function applyStaticStrings(): void {
  document.documentElement.lang = lang() === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(node => {
    node.textContent = t(node.dataset.i18n as Key);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(node => {
    node.setAttribute('aria-label', t(node.dataset.i18nAria as Key));
  });
}
