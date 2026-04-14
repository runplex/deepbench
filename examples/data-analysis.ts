#!/usr/bin/env tsx

/**
 * Data analysis agent — give it data, it writes Python to analyze it.
 *
 * Shows: JustBashProvider + in-memory files + Python WASM
 * No containers, no infra. Runs anywhere.
 *
 * Usage: npx tsx examples/data-analysis.ts
 */

import "dotenv/config";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createTools, JustBashProvider } from "../src/index.js";

const CSV_DATA = `date,product,region,revenue,units
2024-01-01,Widget A,North,12500,250
2024-01-01,Widget A,South,8200,164
2024-01-01,Widget B,North,15300,102
2024-01-01,Widget B,South,11700,78
2024-02-01,Widget A,North,13100,262
2024-02-01,Widget A,South,7800,156
2024-02-01,Widget B,North,16800,112
2024-02-01,Widget B,South,12400,83
2024-03-01,Widget A,North,14200,284
2024-03-01,Widget A,South,9100,182
2024-03-01,Widget B,North,18500,123
2024-03-01,Widget B,South,13200,88`;

async function main() {
  console.log("=== deepbench: data analysis agent ===\n");

  const provider = new JustBashProvider({
    python: true,
    files: {
      "/data/sales.csv": CSV_DATA,
    },
  });

  const tools = createTools(provider);
  const startTime = Date.now();

  const result = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    tools,
    maxSteps: 15,
    prompt: `You have a sales dataset at /data/sales.csv. Analyze it:
1. Read the data
2. Write a Python script to compute: total revenue by product, month-over-month growth, best performing region
3. Run the script
4. Summarize the findings`,
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
