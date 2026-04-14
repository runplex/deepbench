#!/usr/bin/env tsx

/**
 * Remote workspace — starts a server, then connects a client agent.
 *
 * Shows the Docker deployment pattern: server picks the backend,
 * client just connects and uses tools.
 *
 * Usage: npx tsx examples/remote-tools.ts
 */

import "dotenv/config";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createTools, connectSandbox } from "../src/index.js";
import { startServer } from "../src/server/ws-server.js";

const PORT = 3456;

async function main() {
  console.log("=== deepbench: remote workspace demo ===\n");

  // 1. Start server — picks the backend (in production: Docker container)
  const stop = await startServer({ dir: ".", port: PORT });
  console.log(`Server running on ws://localhost:${PORT}`);
  console.log("Backend: JustBash + local directory\n");

  // 2. Client connects — doesn't know or care about the backend
  const provider = await connectSandbox(`ws://localhost:${PORT}`);
  const tools = createTools(provider);
  const startTime = Date.now();

  const result = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    tools,
    maxSteps: 10,
    prompt: "Explore this project. What is it? List the main source files and describe the architecture in under 100 words.",
  });

  console.log(result.text);

  console.log(`\n--- Summary ---`);
  console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`Steps: ${result.steps.length}`);
  console.log(`Tool calls: ${result.steps.reduce((n, s) => n + s.toolCalls.length, 0)}`);
  console.log(`Tools used: ${[...new Set(result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName)))].join(", ")}`);

  await provider.dispose();
  stop();
}

main().catch(console.error);
