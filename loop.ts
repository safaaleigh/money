/**
 * Autonomous trading loop.
 *
 * Runs the agent on a cycle (default 5 min), with a strategy review every hour.
 * Uses mock portfolio by default — no real orders placed.
 *
 * Usage:
 *   bun run loop.ts                    # mock mode, 5 min cycles
 *   bun run loop.ts --interval 60      # 60-second cycles
 *   bun run loop.ts --live             # use real Alpaca paper trading (not mock)
 */

import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "fs";
import { queryTool } from "./tools";
import {
  mockBuyTool,
  mockSellTool,
  recordPriceTool,
  portfolioSummaryTool,
  resetPortfolioTool,
} from "./portfolio";

// --- CLI args ---

const args = process.argv.slice(2);
const intervalSec = (() => {
  const idx = args.indexOf("--interval");
  return idx !== -1 ? parseInt(args[idx + 1] ?? "300", 10) : 300;
})();
const isLive = args.includes("--live");
const reviewIntervalMs = 60 * 60 * 1000; // 1 hour

// --- Load strategy + constitution ---

const constitution = readFileSync("CONSTITUTION.md", "utf-8") as string;
const strategy = readFileSync("STRATEGY.md", "utf-8") as string;

// --- MCP server ---

const tradingServer = createSdkMcpServer({
  name: "trading",
  version: "1.0.0",
  tools: [
    queryTool,               // always available for quotes
    mockBuyTool,
    mockSellTool,
    recordPriceTool,
    portfolioSummaryTool,
    resetPortfolioTool,
  ],
});

const allowedTools = [
  "mcp__trading__query",
  "mcp__trading__mock_buy",
  "mcp__trading__mock_sell",
  "mcp__trading__record_price",
  "mcp__trading__portfolio_summary",
  "mcp__trading__reset_portfolio",
];

// --- Prompts ---

const systemPrompt = `${constitution}

${strategy}

You are running in AUTONOMOUS MOCK TRADING mode. You do NOT need user confirmation — you are the decision-maker.

Your workflow each cycle:
1. Use the "query" tool to get live quotes for the watchlist symbols.
2. Use "record_price" to log each quote.
3. Evaluate buy/sell signals per the strategy rules.
4. Execute trades using "mock_buy" and "mock_sell" (these are simulated, no real money).
5. Print a brief summary of actions taken this cycle.

Important:
- Use the CURRENT ask price from quotes as the execution price for buys.
- Use the CURRENT bid price from quotes as the execution price for sells.
- Follow all strategy rules strictly (position limits, cash reserve, stop-loss).
- Be concise. Log your reasoning in 1-2 sentences per decision.`;

const reviewPrompt = `${systemPrompt}

This is a STRATEGY REVIEW cycle (hourly). In addition to normal trading:
1. Call "portfolio_summary" to see full P&L.
2. Print a detailed performance report.
3. Note whether the strategy is working or needs adjustment per the feedback rules in STRATEGY.md.
4. State any threshold adjustments for the next hour.`;

// --- Loop ---

let cycleCount = 0;
let startTime = Date.now();
let lastReviewTime = Date.now();

function log(msg: string) {
  const ts = new Date().toISOString().slice(0, 19);
  console.log(`[${ts}] ${msg}`);
}

async function runCycle(isReview: boolean) {
  cycleCount++;
  const label = isReview ? `REVIEW CYCLE #${cycleCount}` : `CYCLE #${cycleCount}`;
  log(`--- ${label} ---`);

  const prompt = isReview
    ? "Perform a strategy review. Check all watchlist quotes, execute any trades per strategy, then print a full performance report."
    : "Run a trading cycle. Check all watchlist quotes, record prices, and execute any trades per strategy rules. Print a brief summary.";

  const sysPrompt = isReview ? reviewPrompt : systemPrompt;

  try {
    for await (const message of query({
      prompt,
      options: {
        systemPrompt: sysPrompt,
        model: "claude-sonnet-4-6",
        mcpServers: { trading: tradingServer },
        allowedTools,
        maxTurns: 20,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) process.stdout.write(block.text);
        }
      }
      if (message.type === "result") {
        if (message.subtype === "success") {
          console.log(`\n${message.result}`);
        } else {
          log(`Agent stopped: ${message.subtype}`);
        }
        log(`Cycle cost: $${message.total_cost_usd?.toFixed(4) ?? "?"}`);
      }
    }
  } catch (err) {
    log(`Cycle error: ${err}`);
  }
}

async function main() {
  log(`Starting trading loop`);
  log(`Mode: ${isLive ? "LIVE (Alpaca paper)" : "MOCK (local accounting)"}`);
  log(`Cycle interval: ${intervalSec}s`);
  log(`Review interval: ${reviewIntervalMs / 1000}s`);
  log(`Press Ctrl+C to stop\n`);

  // Run first cycle immediately
  await runCycle(true); // start with a review to establish baseline

  while (true) {
    await Bun.sleep(intervalSec * 1000);

    const now = Date.now();
    const isReview = now - lastReviewTime >= reviewIntervalMs;
    if (isReview) lastReviewTime = now;

    await runCycle(isReview);
  }
}

main().catch((err) => {
  log(`Fatal: ${err}`);
  process.exit(1);
});
