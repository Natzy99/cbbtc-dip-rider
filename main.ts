// cbBTC dip-rider: a robust dip-buy + trend-filter bot for the make.fun
// "Race a BTC trading bot live for 24 hours" bounty (btc-race-24h-20261123-0511).
//
// Idea, from the dev window and the live top 10: the winners are not
// high-frequency flippers. They buy a dip inside an uptrend, hold for a
// few percent, and let a trailing stop protect the gain. So this bot:
//
//   * rides only when the trend is up (EMA-12 above EMA-120 of 1-min closes),
//   * buys a dip: the latest close at least 1% below the 60-bar high, or
//     at least 0.3% below the EMA-12,
//   * sells at +3% take-profit, on a 1.8% trailing stop from the peak,
//     or on a 2% hard stop below the entry,
//   * trades at most once per 30 bars after an exit, full size, long only.
//
// No wall clock, no network, no files, no randomness: every decision comes
// from the hello message and the batch stream, so two runs agree exactly.
// The protocol words are hello, batch, orders and bar, as the replay sends.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Trend and dip windows, in bars (1-minute bars).
const FAST_EMA = 12;
const SLOW_EMA = 120;
const HIGH_LOOKBACK = 60;
const COOLDOWN_BARS = 30;

// Exit levels, in basis points of the entry / peak price.
// The take-profit sits in the middle of a flat 2.4-2.8% plateau on the dev
// window (measured from the fill price, which carries the fill premium),
// not on a knife-edge: 2.9% and above misses the peak and rides the
// trailing stop down instead.
const TAKE_PROFIT_BPS = 260; // +2.6%
const TRAILING_BPS = 180; // 1.8% below the peak since entry
const STOP_LOSS_BPS = 200; // 2% below the entry

// Orders may fill at most this far from the latest close we were sent.
const MAX_SLIPPAGE_BPS = 300;

// A buy spends this share of the cash on hand, keeping a dust remainder
// so the fee never overruns the cash balance.
const BUY_SHARE_NUM = 999n;
const BUY_SHARE_DEN = 1000n;

interface Rider {
  emaFast: number | null;
  emaSlow: number | null;
  closes: number[];
  entryRaw: bigint | null;
  peakRaw: bigint | null;
  lastExitSeq: number;
  pendingBuy: boolean;
}

function emaUpdate(prev: number | null, value: number, period: number): number {
  const k = 2 / (period + 1);
  return prev === null ? value : value * k + prev * (1 - k);
}

function sixtyBarHigh(closes: number[]): number {
  let high = 0;
  const start = Math.max(0, closes.length - HIGH_LOOKBACK);
  for (let i = start; i < closes.length; i++) {
    if (closes[i]! > high) high = closes[i]!;
  }
  return high;
}

await runBars({
  onHello(_state: BarsState): void {
    // Nothing to seed: the strategy is fully deterministic from the bars.
  },

  onBatch(state: BarsState, batch: Batch) {
    const rider = (state as unknown as { __rider?: Rider }).__rider ?? {
      emaFast: null,
      emaSlow: null,
      closes: [],
      entryRaw: null,
      peakRaw: null,
      lastExitSeq: -1_000_000,
      pendingBuy: false,
    };
    (state as unknown as { __rider?: Rider }).__rider = rider;

    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar === undefined) return [];

    // Learn the entry and peak from the fills of the orders sent on the
    // previous batch: a buy fill sets the entry, a sell fill clears it, and
    // a rejected buy frees us to try again on a later bar.
    for (const fill of batch.fills) {
      if (fill.symbol !== SYMBOL) continue;
      if (fill.side === 'buy' && fill.status === 'rejected') {
        rider.pendingBuy = false;
        continue;
      }
      if (fill.status !== 'filled') continue;
      if (fill.side === 'buy') {
        rider.entryRaw = BigInt(fill.price);
        rider.peakRaw = BigInt(fill.price);
        rider.pendingBuy = false;
      } else if (fill.side === 'sell') {
        rider.entryRaw = null;
        rider.peakRaw = null;
        rider.lastExitSeq = state.seq;
      }
    }

    const closeRaw = BigInt(bar.c);
    const close = Number(closeRaw);
    rider.closes.push(close);
    rider.emaFast = emaUpdate(rider.emaFast, close, FAST_EMA);
    rider.emaSlow = emaUpdate(rider.emaSlow, close, SLOW_EMA);

    // Warm-up batches never trade, and neither do the first bars while the
    // slow EMA is still forming.
    if (state.warmingUp) return [];
    if (rider.closes.length < SLOW_EMA) return [];

    const position = state.positions.get(SYMBOL);
    const qty = position?.qty ?? 0n;

    if (qty > 0n && rider.entryRaw !== null) {
      // We hold: update the peak and check the three exits.
      if (closeRaw > rider.peakRaw!) rider.peakRaw = closeRaw;
      const entry = rider.entryRaw;
      const peak = rider.peakRaw!;
      const takeProfit = (closeRaw * 10_000n) / entry >= 10_000n + BigInt(TAKE_PROFIT_BPS);
      const trailing = (closeRaw * 10_000n) / peak <= 10_000n - BigInt(TRAILING_BPS);
      const stopped = (closeRaw * 10_000n) / entry <= 10_000n - BigInt(STOP_LOSS_BPS);
      if (takeProfit || trailing || stopped) {
        return [
          {
            side: 'sell',
            symbol: SYMBOL,
            qty,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          },
        ];
      }
      return [];
    }

    if (qty > 0n || rider.pendingBuy) return [];

    // Flat: buy the dip only inside an uptrend, and only once the
    // cooldown after the last exit has passed.
    if (state.seq - rider.lastExitSeq < COOLDOWN_BARS) return [];
    const uptrend = rider.emaFast! > rider.emaSlow!;
    if (!uptrend) return [];
    const high = sixtyBarHigh(rider.closes);
    const pullback = close * 10_000 <= high * (10_000 - 100);
    const belowFast = close * 10_000 < rider.emaFast! * (10_000 - 30);
    if (!pullback && !belowFast) return [];

    const notional = (state.cash * BUY_SHARE_NUM) / BUY_SHARE_DEN;
    if (notional <= 0n) return [];
    rider.pendingBuy = true;
    return [
      {
        side: 'buy',
        symbol: SYMBOL,
        notional_quote_units: notional,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      },
    ];
  },
});
