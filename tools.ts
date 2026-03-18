import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";

const ALPACA_BASE = "https://paper-api.alpaca.markets";
const ALPACA_DATA = "https://data.alpaca.markets";

function headers() {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;
  if (!key || !secret) throw new Error("Set ALPACA_API_KEY and ALPACA_API_SECRET env vars");
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    "Content-Type": "application/json",
  };
}

async function alpaca(path: string, init?: RequestInit) {
  const base = path.startsWith("/v2/stocks") ? ALPACA_DATA : ALPACA_BASE;
  const res = await fetch(`${base}${path}`, { ...init, headers: headers() });
  const body = await res.text();
  if (!res.ok) throw new Error(`Alpaca ${res.status}: ${body}`);
  return JSON.parse(body);
}

// --- Query tool: account, positions, or a quote ---

export const queryTool = tool(
  "query",
  "Query account info, current positions, or a stock/crypto quote",
  {
    type: z.enum(["account", "positions", "quote"]).describe("What to query"),
    symbol: z.string().optional().describe("Ticker symbol (required for quote, e.g. AAPL or BTC/USD)"),
  },
  async (args) => {
    let data: unknown;
    switch (args.type) {
      case "account":
        data = await alpaca("/v2/account");
        break;
      case "positions":
        data = await alpaca("/v2/positions");
        break;
      case "quote": {
        if (!args.symbol) throw new Error("symbol is required for quote");
        const sym = args.symbol.replace("/", "%2F");
        data = await alpaca(`/v2/stocks/${sym}/quotes/latest`);
        break;
      }
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Buy tool ---

export const buyTool = tool(
  "buy",
  "Place a buy order for a stock or crypto",
  {
    symbol: z.string().describe("Ticker symbol (e.g. AAPL or BTC/USD)"),
    qty: z.number().positive().describe("Number of shares/units to buy"),
    type: z.enum(["market", "limit"]).default("market").describe("Order type"),
    limit_price: z.number().optional().describe("Limit price (required if type is limit)"),
  },
  async (args) => {
    const order = await alpaca("/v2/orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: args.symbol,
        qty: String(args.qty),
        side: "buy",
        type: args.type,
        time_in_force: "day",
        ...(args.limit_price ? { limit_price: String(args.limit_price) } : {}),
      }),
    });
    return {
      content: [{ type: "text" as const, text: `Buy order placed:\n${JSON.stringify(order, null, 2)}` }],
    };
  }
);

// --- Sell tool ---

export const sellTool = tool(
  "sell",
  "Place a sell order for a stock or crypto",
  {
    symbol: z.string().describe("Ticker symbol (e.g. AAPL or BTC/USD)"),
    qty: z.number().positive().describe("Number of shares/units to sell"),
    type: z.enum(["market", "limit"]).default("market").describe("Order type"),
    limit_price: z.number().optional().describe("Limit price (required if type is limit)"),
  },
  async (args) => {
    const order = await alpaca("/v2/orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: args.symbol,
        qty: String(args.qty),
        side: "sell",
        type: args.type,
        time_in_force: "day",
        ...(args.limit_price ? { limit_price: String(args.limit_price) } : {}),
      }),
    });
    return {
      content: [{ type: "text" as const, text: `Sell order placed:\n${JSON.stringify(order, null, 2)}` }],
    };
  }
);
