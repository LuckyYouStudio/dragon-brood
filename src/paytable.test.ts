import { describe, expect, it } from 'vitest';
import { ROLL_DOMAIN, decodeGameState, encodeGameData, decodeSize, outcomeFromRoll, payoutFor, rows } from './paytable';
import { findMatches, findMove, newGrid } from './board';

describe('paytable', () => {
  it('returns exactly 96% at every egg size (full enumeration of the roll domain)', () => {
    for (let size = 1; size <= 5; size++) {
      let total = 0;
      for (let roll = 0; roll < ROLL_DOMAIN; roll++) total += outcomeFromRoll(size, roll).multX100;
      expect(total).toBe(96 * ROLL_DOMAIN);
    }
  });

  it('never pays above the top row the contract reserves for', () => {
    const wager = 1_234_567_890_123_456_789n;
    for (let size = 1; size <= 5; size++) {
      const top = payoutFor(wager, rows(size)[0].multX100);
      for (const row of rows(size)) expect(payoutFor(wager, row.multX100) <= top).toBe(true);
    }
  });

  it('round-trips the ABI words', () => {
    expect(decodeSize(encodeGameData(4))).toBe(4);
    const state = `0x${[3, 5, 10000, 999].map(v => v.toString(16).padStart(64, '0')).join('')}`;
    expect(decodeGameState(state)).toEqual({ size: 3, rank: 5, multX100: 10000, roll: 999 });
  });
});

describe('board', () => {
  it('deals boards with no standing match and at least one move', () => {
    for (let i = 0; i < 50; i++) {
      const grid = newGrid();
      expect(findMatches(grid)).toHaveLength(0);
      expect(findMove(grid)).not.toBeNull();
    }
  });
});
