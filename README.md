# cbbtc-dip-rider

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Natzy99/cbbtc-dip-rider/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Natzy99/cbbtc-dip-rider/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A cbBTC dip-buying trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It buys dips inside an uptrend (EMA-12 above EMA-120), sells at +2.6% take-profit, on a 1.8% trailing stop, or on a 2% hard stop — full size, long only, deterministic. Dev window: +$25.82 net PnL on $1,000, 3 trades, 1.58% max drawdown.

## Run it

```sh
node main.ts
```

The bot speaks agent-fun/bars-replay/v1 on stdin/stdout: it reads the `hello` message and one `batch` per minute bar, and answers each batch with exactly one reply carrying its orders.

---

<sub>Entered on [make.fun](https://make.fun/?ref=natzy99&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
