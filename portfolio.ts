/**
 * Mock portfolio tracker.
 * Persists state to portfolio.json so results survive restarts.
 * Uses real Alpaca quotes but records trades locally instead of placing real orders.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";

const STATE_FILE = "portfolio.json";
const STARTING_CASH = 100_000;

// --- Types ---

interface Position {
  symbol: string;
  qty: number;
  avgEntry: number; // average cost basis per share
}

interface Trade {
  ts: string;
  side: "buy" | "sell";
  symbol: string;
  qty: number;
  price: number;
  total: number;
}

interface PriceSnapshot {
  symbol: string;
  price: number;
  ts: string;
}

interface PortfolioState {
  cash: number;
  startingCash: number;
  positions: Position[];
  trades: Trade[];
  priceHistory: PriceSnapshot[]; // last-known prices per cycle
  startedAt: string;
}

// --- Persistence ---

function defaultState(): PortfolioState {
  return {
    cash: STARTING_CASH,
    startingCash: STARTING_CASH,
    positions: [],
    trades: [],
    priceHistory: [],
    startedAt: new Date().toISOString(),
  };
}

async function load(): Promise<PortfolioState> {
  try {
    const f = Bun.file(STATE_FILE);
    if (await f.exists()) return await f.json();
  } catch {}
  return defaultState();
}

async function save(state: PortfolioState) {
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- Helpers ---

function findPosition(state: PortfolioState, symbol: string) {
  return state.positions.find((p) => p.symbol === symbol);
}

function lastPrice(state: PortfolioState, symbol: string): number | undefined {
  // most recent snapshot for this symbol
  for (let i = state.priceHistory.length - 1; i >= 0; i--) {
    if (state.priceHistory[i]!.symbol === symbol) return state.priceHistory[i]!.price;
  }
  return undefined;
}

// --- MCP Tools ---

export const mockBuyTool = tool(
  "mock_buy",
  "Record a simulated buy trade in the mock portfolio (no real order placed)",
  {
    symbol: z.string().describe("Ticker symbol"),
    qty: z.number().positive().describe("Shares to buy"),
    price: z.number().positive().describe("Execution price per share (use current ask)"),
  },
  async (args) => {
    const state = await load();
    const total = args.qty * args.price;
    if (total > state.cash) {
      return { content: [{ type: "text" as const, text: `Insufficient cash. Have $${state.cash.toFixed(2)}, need $${total.toFixed(2)}` }] };
    }
    state.cash -= total;
    const pos = findPosition(state, args.symbol);
    if (pos) {
      const newQty = pos.qty + args.qty;
      pos.avgEntry = (pos.avgEntry * pos.qty + total) / newQty;
      pos.qty = newQty;
    } else {
      state.positions.push({ symbol: args.symbol, qty: args.qty, avgEntry: args.price });
    }
    state.trades.push({
      ts: new Date().toISOString(),
      side: "buy",
      symbol: args.symbol,
      qty: args.qty,
      price: args.price,
      total,
    });
    await save(state);
    return {
      content: [{ type: "text" as const, text: `MOCK BUY: ${args.qty} ${args.symbol} @ $${args.price.toFixed(2)} = $${total.toFixed(2)}\nCash remaining: $${state.cash.toFixed(2)}` }],
    };
  }
);

export const mockSellTool = tool(
  "mock_sell",
  "Record a simulated sell trade in the mock portfolio (no real order placed)",
  {
    symbol: z.string().describe("Ticker symbol"),
    qty: z.number().positive().describe("Shares to sell"),
    price: z.number().positive().describe("Execution price per share (use current bid)"),
  },
  async (args) => {
    const state = await load();
    const pos = findPosition(state, args.symbol);
    if (!pos || pos.qty < args.qty) {
      return { content: [{ type: "text" as const, text: `Cannot sell ${args.qty} ${args.symbol}: only hold ${pos?.qty ?? 0}` }] };
    }
    const total = args.qty * args.price;
    const pnl = (args.price - pos.avgEntry) * args.qty;
    state.cash += total;
    pos.qty -= args.qty;
    if (pos.qty === 0) {
      state.positions = state.positions.filter((p) => p.symbol !== args.symbol);
    }
    state.trades.push({
      ts: new Date().toISOString(),
      side: "sell",
      symbol: args.symbol,
      qty: args.qty,
      price: args.price,
      total,
    });
    await save(state);
    return {
      content: [{
        type: "text" as const,
        text: `MOCK SELL: ${args.qty} ${args.symbol} @ $${args.price.toFixed(2)} = $${total.toFixed(2)}\nP&L on this trade: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}\nCash: $${state.cash.toFixed(2)}`,
      }],
    };
  }
);

export const recordPriceTool = tool(
  "record_price",
  "Record a price snapshot for a symbol (used to track price changes between cycles)",
  {
    symbol: z.string().describe("Ticker symbol"),
    price: z.number().positive().describe("Current price"),
  },
  async (args) => {
    const state = await load();
    state.priceHistory.push({ symbol: args.symbol, price: args.price, ts: new Date().toISOString() });
    // keep last 500 snapshots to avoid unbounded growth
    if (state.priceHistory.length > 500) {
      state.priceHistory = state.priceHistory.slice(-500);
    }
    await save(state);
    const prev = lastPrice(state, args.symbol);
    return {
      content: [{ type: "text" as const, text: `Recorded ${args.symbol} @ $${args.price.toFixed(2)}` }],
    };
  }
);

export const portfolioSummaryTool = tool(
  "portfolio_summary",
  "Get full mock portfolio summary: cash, positions, total value, P&L, trade history",
  {},
  async () => {
    const state = await load();
    const positionLines = state.positions.map((p) => {
      const last = lastPrice(state, p.symbol);
      const mktVal = last ? last * p.qty : p.avgEntry * p.qty;
      const unrealizedPnl = last ? (last - p.avgEntry) * p.qty : 0;
      return `  ${p.symbol}: ${p.qty} shares, avg entry $${p.avgEntry.toFixed(2)}, mkt val $${mktVal.toFixed(2)}, unrealized P&L ${unrealizedPnl >= 0 ? "+" : ""}$${unrealizedPnl.toFixed(2)}`;
    });

    const positionsValue = state.positions.reduce((sum, p) => {
      const last = lastPrice(state, p.symbol);
      return sum + (last ? last * p.qty : p.avgEntry * p.qty);
    }, 0);

    const totalValue = state.cash + positionsValue;
    const totalPnl = totalValue - state.startingCash;
    const totalPnlPct = (totalPnl / state.startingCash) * 100;

    const recentTrades = state.trades.slice(-10).map(
      (t) => `  ${t.ts.slice(0, 19)} ${t.side.toUpperCase()} ${t.qty} ${t.symbol} @ $${t.price.toFixed(2)}`
    );

    const summary = [
      `=== PORTFOLIO SUMMARY ===`,
      `Started: ${state.startedAt}`,
      `Cash: $${state.cash.toFixed(2)}`,
      `Positions value: $${positionsValue.toFixed(2)}`,
      `Total value: $${totalValue.toFixed(2)}`,
      `Total P&L: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)} (${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%)`,
      ``,
      `Positions (${state.positions.length}):`,
      positionLines.length ? positionLines.join("\n") : "  (none)",
      ``,
      `Recent trades (last 10 of ${state.trades.length}):`,
      recentTrades.length ? recentTrades.join("\n") : "  (none)",
    ].join("\n");

    return { content: [{ type: "text" as const, text: summary }] };
  }
);

export const resetPortfolioTool = tool(
  "reset_portfolio",
  "Reset the mock portfolio to starting state ($100k cash, no positions)",
  {},
  async () => {
    const state = defaultState();
    await save(state);
    return { content: [{ type: "text" as const, text: `Portfolio reset. Cash: $${STARTING_CASH.toLocaleString()}` }] };
  }
);
