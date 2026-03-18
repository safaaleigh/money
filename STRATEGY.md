# Trading Strategy

Simple mean-reversion strategy for paper/mock trading.

## Universe

Pick from a small watchlist of liquid, large-cap stocks:
AAPL, MSFT, GOOGL, AMZN, META, NVDA, TSLA, SPY

## Rules

1. **Check quotes** for every symbol in the watchlist each cycle.
2. **Buy signal**: If a stock's current ask price is ≥2% below its previous cycle price, buy up to 10 shares (max $5,000 per position, max 3 open positions total).
3. **Sell signal**: If a held position is up ≥3% from entry OR down ≥2% from entry (stop-loss), sell the full position.
4. **Position sizing**: Never risk more than 5% of total portfolio value on a single trade.
5. **Cash reserve**: Always keep at least 20% of starting capital in cash.

## Feedback Review (hourly)

Every hour, the agent should:
- Print a portfolio summary (cash, positions, total value, P&L).
- Compare current strategy performance to a simple "hold SPY" baseline.
- If the strategy is underperforming SPY by >1% over the session, tighten the buy threshold to 3% below previous price. If outperforming, relax back to 2%.

## Risk Limits

- Max 3 concurrent positions.
- Max $5,000 per position.
- Max 100 shares per order.
- Stop trading if total portfolio drops >10% from starting value.
