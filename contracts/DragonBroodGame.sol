// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { ICasinoGameV2, SessionContext, SessionPhase, StepResult } from "./ICasinoGameV2.sol";

/// @title Dragon Brood — crack a dragon egg, hatch a payout.
/// @notice Instant game. The guest UI is a free match-3 that grows the egg in the nest; the egg's
///         size (1..5) is the only bet parameter. A bigger egg holds bigger dragons and more duds:
///         size changes volatility, never the edge. Every size returns exactly 96% RTP, so a
///         player who forges `size` in gameData gains nothing — it is a volatility pick.
///
///         One VRF word -> one uniform roll in [0, 1_000_000) by rejection sampling -> one row of
///         the size's paytable. Weights (per million) and multipliers (x100) per size:
///
///           size  Ancient        Dragon        Wyvern        Drake          Whelp          RTP
///            1    10000 x5       40000 x3      120000 x2     200000 x1.5    250000 x1      0.96
///            2     4000 x25      12000 x10      40000 x5     140000 x2      260000 x1      0.96
///            3     1000 x100      6000 x25      20000 x10     60000 x4      180000 x1.5    0.96
///            4      200 x500      1500 x100      8000 x25     30000 x8      135000 x2      0.96
///            5       40 x2500      300 x500      2000 x100    12000 x20      90000 x3      0.96
///
///         Everything else in the domain is a dud (x0). math/paytable.py proves the numbers.
contract DragonBroodGame is ICasinoGameV2 {
  uint256 internal constant ROLL_DOMAIN = 1_000_000;
  uint256 internal constant MULT_SCALE = 100;
  uint256 internal constant RTP_BPS = 9600;
  uint8 internal constant MAX_SIZE = 5;
  uint8 internal constant RANKS = 5;

  /// Outcome rank written to gameState: 0 = dud, 1 = Whelp … 5 = Ancient.
  uint8 internal constant RANK_DUD = 0;

  error DragonBrood__InvalidGameData();
  error DragonBrood__InvalidSize(uint8 size);
  error DragonBrood__ZeroWager();
  error DragonBrood__NoPlayerAction();

  // ---------------------------------------------------------------- paytable

  /// @dev Rows are ordered top tier first: index 0 = Ancient … 4 = Whelp.
  function _row(uint8 size, uint8 index) internal pure returns (uint256 weight, uint256 multX100) {
    if (size == 1) {
      if (index == 0) return (10_000, 500);
      if (index == 1) return (40_000, 300);
      if (index == 2) return (120_000, 200);
      if (index == 3) return (200_000, 150);
      return (250_000, 100);
    }
    if (size == 2) {
      if (index == 0) return (4_000, 2_500);
      if (index == 1) return (12_000, 1_000);
      if (index == 2) return (40_000, 500);
      if (index == 3) return (140_000, 200);
      return (260_000, 100);
    }
    if (size == 3) {
      if (index == 0) return (1_000, 10_000);
      if (index == 1) return (6_000, 2_500);
      if (index == 2) return (20_000, 1_000);
      if (index == 3) return (60_000, 400);
      return (180_000, 150);
    }
    if (size == 4) {
      if (index == 0) return (200, 50_000);
      if (index == 1) return (1_500, 10_000);
      if (index == 2) return (8_000, 2_500);
      if (index == 3) return (30_000, 800);
      return (135_000, 200);
    }
    if (index == 0) return (40, 250_000);
    if (index == 1) return (300, 50_000);
    if (index == 2) return (2_000, 10_000);
    if (index == 3) return (12_000, 2_000);
    return (90_000, 300);
  }

  /// @dev Standard deviation of the payout per unit wager with the top tier removed, in WAD,
  ///      rounded up (math/paytable.py).
  function _bodySigmaWad(uint8 size) internal pure returns (uint256) {
    if (size == 1) return 843_741_666_625_513_997;
    if (size == 2) return 1_510_099_334_481_013_538;
    if (size == 3) return 2_524_955_445_151_458_510;
    if (size == 4) return 4_660_514_993_002_382_779;
    return 9_993_517_899_118_408_044;
  }

  /// @dev The single payout function: caps, risk quote, reserve and settlement all route here so
  ///      the reserve and the win agree to the wei.
  function _payout(uint256 wager, uint256 multX100) internal pure returns (uint256) {
    return (wager * multX100) / MULT_SCALE;
  }

  function _maxPayout(uint256 wager, uint8 size) internal pure returns (uint256) {
    (, uint256 topMult) = _row(size, 0);
    return _payout(wager, topMult);
  }

  // ---------------------------------------------------------------- gameData

  /// @dev Quotes tolerate empty gameData (the whitelist guard probes with it) by answering for the
  ///      largest egg — the worst case for every risk figure.
  function _sizeForQuote(bytes calldata gameData) internal pure returns (uint8) {
    if (gameData.length == 0) return MAX_SIZE;
    return _decodeSize(gameData);
  }

  function _decodeSize(bytes calldata gameData) internal pure returns (uint8 size) {
    if (gameData.length != 32) revert DragonBrood__InvalidGameData();
    uint256 raw = abi.decode(gameData, (uint256));
    if (raw == 0 || raw > MAX_SIZE) revert DragonBrood__InvalidSize(uint8(raw > 255 ? 255 : raw));
    size = uint8(raw);
  }

  // ---------------------------------------------------------------- quotes

  function quoteCaps(
    uint256 wager,
    bytes calldata gameData
  ) external pure returns (uint256 maxEscrowStake, uint256 maxReservedProfit) {
    uint8 size = _sizeForQuote(gameData);
    maxEscrowStake = wager;
    maxReservedProfit = _maxPayout(wager, size) - wager;
  }

  function quoteRiskParams(
    uint256 wager,
    bytes calldata gameData
  )
    external
    pure
    returns (
      uint256 maxPayout,
      uint256 probabilityWad,
      uint256 expectedPayout,
      uint256 bodyVarianceScaled
    )
  {
    uint8 size = _sizeForQuote(gameData);
    (uint256 topWeight, ) = _row(size, 0);
    maxPayout = _maxPayout(wager, size);
    probabilityWad = (topWeight * 1e18) / ROLL_DOMAIN;
    expectedPayout = (wager * RTP_BPS) / 10_000;
    uint256 bodySigma = (wager * _bodySigmaWad(size)) / 1e18 + 1;
    bodyVarianceScaled = bodySigma * bodySigma * 1e18;
  }

  // ---------------------------------------------------------------- steps

  function onSessionStart(
    SessionContext calldata ctx
  ) external pure returns (StepResult memory stepResult) {
    if (ctx.wagerBase == 0) revert DragonBrood__ZeroWager();
    uint8 size = _decodeSize(ctx.gameData);

    stepResult.newGameState = abi.encode(size, RANK_DUD, uint256(0), uint256(0));
    stepResult.escrowDelta = 0;
    stepResult.reservedProfitDelta = int256(_maxPayout(ctx.wagerBase, size) - ctx.wagerBase);
    stepResult.nextPhase = SessionPhase.WAITING_RANDOMNESS;
    stepResult.requestRandomnessNow = true;
    stepResult.payout = 0;
  }

  function onPlayerAction(
    SessionContext calldata,
    bytes calldata
  ) external pure returns (StepResult memory) {
    revert DragonBrood__NoPlayerAction();
  }

  function onRandomness(
    SessionContext calldata ctx,
    bytes32 randomness
  ) external pure returns (StepResult memory stepResult) {
    uint8 size = _decodeSize(ctx.gameData);
    uint256 roll = _rollFromRandomness(randomness);
    (uint8 rank, uint256 multX100) = _outcome(size, roll);

    // gameState = (size, rank 0..5, multiplier x100, roll) — everything the guest needs to
    // present and the player needs to re-derive the result from the VRF word.
    stepResult.newGameState = abi.encode(size, rank, multX100, roll);
    stepResult.escrowDelta = 0;
    stepResult.reservedProfitDelta = 0; // the facet releases the reserve at settlement
    stepResult.nextPhase = SessionPhase.SETTLED;
    stepResult.requestRandomnessNow = false;
    stepResult.payout = _payout(ctx.wagerBase, multX100);
  }

  /// @dev Instant game: nothing is cashable mid-round.
  function quoteForfeitPayout(SessionContext calldata) external pure returns (uint256) {
    return 0;
  }

  // ---------------------------------------------------------------- randomness

  /// @dev Uniform roll in [0, ROLL_DOMAIN) by rejection sampling over the full 256-bit word:
  ///      words at or above the largest multiple of ROLL_DOMAIN are rehashed, never reduced.
  function _rollFromRandomness(bytes32 randomness) internal pure returns (uint256) {
    // 2^256 mod ROLL_DOMAIN, without overflowing.
    uint256 excess = ((type(uint256).max % ROLL_DOMAIN) + 1) % ROLL_DOMAIN;
    uint256 lastAccepted = type(uint256).max - excess; // accept word <= lastAccepted
    bytes32 seed = randomness;
    while (true) {
      uint256 word = uint256(seed);
      if (word <= lastAccepted) return word % ROLL_DOMAIN;
      seed = keccak256(abi.encodePacked(seed));
    }
    return 0; // unreachable
  }

  /// @dev Walks the size's rows top tier first; the roll lands in the first row whose cumulative
  ///      weight exceeds it, else it is a dud.
  function _outcome(uint8 size, uint256 roll) internal pure returns (uint8 rank, uint256 multX100) {
    uint256 cumulative;
    for (uint8 i = 0; i < RANKS; i++) {
      (uint256 weight, uint256 mult) = _row(size, i);
      cumulative += weight;
      if (roll < cumulative) return (RANKS - i, mult);
    }
    return (RANK_DUD, 0);
  }

  // ---------------------------------------------------------------- views for verifiers

  /// @notice Public mirror of the settlement mapping so anyone can check a result off a VRF word.
  function previewOutcome(
    uint8 size,
    bytes32 randomness
  ) external pure returns (uint256 roll, uint8 rank, uint256 multX100) {
    if (size == 0 || size > MAX_SIZE) revert DragonBrood__InvalidSize(size);
    roll = _rollFromRandomness(randomness);
    (rank, multX100) = _outcome(size, roll);
  }
}
