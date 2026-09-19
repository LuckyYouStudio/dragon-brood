# Dragon Brood

A casino game with a match-3 heart, built on the Chain.wtf Casino SDK for Chain Jam.

**Match dragon eggs → the egg in your nest grows → pay to crack it.**
Matching is free. Cracking is the bet. A bigger egg holds bigger dragons and more cold shells.
A cold shell gives half of the egg's heat back, so a dud never sends you back to zero.
Every crack adds a flat 5 heat regardless of the price, so heat can never be bought faster with bigger bets.
Players who only came to crack eggs can switch on **Auto-match**: the board plays itself
(slower than hands, and it yields the moment you touch it).

| Egg    | Heat | Whelp | Drake | Wyvern | Dragon | Ancient | Dud   | RTP |
| ------ | ---: | ----: | ----: | -----: | -----: | ------: | ----: | --: |
| Pebble | free |    1× |  1.5× |     2× |     3× |      5× | 38.0% | 96% |
| Clutch |   30 |    1× |    2× |     5× |    10× |     25× | 54.4% | 96% |
| Brood  |   70 |  1.5× |    4× |    10× |    25× |    100× | 73.3% | 96% |
| Hoard  |  130 |    2× |    8× |    25× |   100× |    500× | 82.5% | 96% |
| Elder  |  220 |    3× |   20× |   100× |   500× |   2500× | 89.6% | 96% |

## Why the match-3 cannot break the math

Egg size is the only bet parameter, and **every size returns exactly 96%**. The board decides
*which volatility you have earned*, never the edge — so skill on the board is real (it unlocks the
2500× egg sooner) but cannot move RTP, and forging `size` in `gameData` gains a cheater nothing.
That is what lets a free skill game sit in front of a provably fair wager.

- One VRF word → one uniform roll in `[0, 1 000 000)` by **rejection sampling** over the full
  256-bit word (no modulo bias) → one paytable row.
- `math/paytable.py` proves each size's RTP as an exact fraction (`24/25`) and derives the body
  variance constants used by `quoteRiskParams`. `npm test` enumerates all 1 000 000 rolls per size.
- `quoteCaps`, `quoteRiskParams`, `onSessionStart` and `onRandomness` share a single `_payout`
  function, so the reserve and the top win agree to the wei.
- `previewOutcome(size, randomness)` lets anyone re-derive a hatch from its VRF word.

## Layout

```
contracts/DragonBroodGame.sol   ICasinoGameV2 implementation (instant game)
public/game.manifest.json       host manifest (gameId "DragonBroodGame")
src/sdk/                        vendored @chain/casino-sdk guest bridge
src/host.ts                     bridge connection + standalone demo fallback
src/main.ts                     round lifecycle, snapshot handling, HUD
src/board.ts, boardview.ts      match-3 rules and canvas view
src/nest.ts, art.ts, fx.ts      the egg, the hatch, the sparks — all drawn in code
src/dragon.ts                   the five hatchlings: one parametric rig (neck, skull, jaw, horns, wings, breath)
src/audio.ts                    every sound is synthesized with WebAudio
math/paytable.py                exact RTP + variance proof
```

No image or audio assets are downloaded: the production bundle is ~20 KB gzipped plus one font.

## Run

```sh
npm install
npm run dev      # http://localhost:5173 — opened directly it is a playable demo
npm test
npm run build    # static bundle in dist/
```

Against the SDK's local simulator: drop `contracts/DragonBroodGame.sol` into the SDK's
`simulator/contracts/`, run the SDK's `npm start`, open
`http://localhost:3300/?game=http://localhost:5173` and pick **DragonBroodGame** in the setup panel.

## Guest behaviour checklist

- Bets only when `wallet.status === 'ready'`; bet input clamped with `computeMaxWager` per egg size.
- Round matched by `sessionKey`; presented from the settled `gameState`; `revealOutcome` is called
  after the hatch animation. The in-game balance never rises before the reveal either.
- Refresh mid-round re-adopts the open session from the snapshot.
- `cancelStuckRandomness` is offered if the chain stays silent.
- Standalone (or framed by a non-casino page) it falls back to a demo with play credits and the
  same paytable. Respects `prefers-reduced-motion`.
- Seven languages — English, Deutsch, Español, Русский, Português, Tiếng Việt, 中文 — following
  `snapshot.ui.locale` inside the host and the browser when standalone, with a picker to override.
  A test checks every dictionary covers every key with the same placeholders.
