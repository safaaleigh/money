import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "fs";
import { queryTool, buyTool, sellTool } from "./tools";

const constitution = readFileSync("CONSTITUTION.md", "utf-8");

const tradingServer = createSdkMcpServer({
  name: "trading",
  version: "1.0.0",
  tools: [queryTool, buyTool, sellTool],
});

const systemPrompt = `${constitution}

You have three tools available via the "trading" MCP server:
- **query**: Check account balance, list positions, or get a live quote.
- **buy**: Place a buy order (market or limit).
- **sell**: Place a sell order (market or limit).

Always follow the constitution above. Be concise and format numbers clearly.`;

const prompt = process.argv.slice(2).join(" ") || "What is my account status?";

console.log(`> ${prompt}\n`);

for await (const message of query({
  prompt,
  options: {
    systemPrompt,
    model: "claude-sonnet-4-6",
    mcpServers: { trading: tradingServer },
    allowedTools: [
      "mcp__trading__query",
      "mcp__trading__buy",
      "mcp__trading__sell",
    ],
    maxTurns: 10,
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
      console.log(`\n\n${message.result}`);
    } else {
      console.error(`\nAgent stopped: ${message.subtype}`);
    }
    console.log(`Cost: $${message.total_cost_usd?.toFixed(4) ?? "?"}`);
  }
}
