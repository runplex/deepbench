#!/usr/bin/env tsx

/**
 * Basic demo: AI agent with deep workspace tools.
 * Uses JustBashProvider — runs anywhere, no containers needed.
 *
 * Usage: npx tsx examples/basic.ts
 */

import "dotenv/config";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createTools, JustBashProvider } from "../src/index.js";

async function main() {
  console.log("=== deepbench: basic demo ===\n");

  const provider = new JustBashProvider({
    python: true,
    files: {
      "/workspace/src/math.ts": `export function add(a: number, b: number): number {
  return a + b;
}

export function divide(a: number, b: number): number {
  return a / b;
}

export function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
`,
      "/workspace/src/utils.ts": `export function parseJSON(str: string) {
  return JSON.parse(str);
}

export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}
`,
    },
  });

  const tools = createTools(provider);
  const startTime = Date.now();

  const result = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    tools,
    maxSteps: 10,
    prompt: "Review the code in /workspace/src/ for bugs and missing edge cases. Use bash and read to explore. Keep response under 200 words.",
  });

  console.log(result.text);

  console.log(`\n--- Summary ---`);
  console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`Steps: ${result.steps.length}`);
  console.log(`Tool calls: ${result.steps.reduce((n, s) => n + s.toolCalls.length, 0)}`);
  console.log(`Tools used: ${[...new Set(result.steps.flatMap(s => s.toolCalls.map(tc => tc.toolName)))].join(", ")}`);

  await provider.dispose();
}

main().catch(console.error);
