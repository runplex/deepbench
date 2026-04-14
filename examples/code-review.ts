#!/usr/bin/env tsx

/**
 * Code review agent — point it at a real directory, it explores and reviews.
 *
 * Shows: JustBashProvider + real directory (ReadWriteFs)
 * Agent sees your actual files through just-bash.
 *
 * Usage: npx tsx examples/code-review.ts [path]
 *   Default: reviews this repo's src/ directory
 */

import "dotenv/config";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createTools, JustBashProvider } from "../src/index.js";

async function main() {
  const dir = process.argv[2] || ".";
  console.log(`=== deepbench: code review agent ===`);
  console.log(`Reviewing: ${dir}\n`);

  const provider = new JustBashProvider({ dir });
  const tools = createTools(provider);
  const startTime = Date.now();

  const result = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    tools,
    maxSteps: 15,
    prompt: `Review the code in this project. Use glob and bash to explore the structure, read key files, and identify:
1. What the project does (1-2 sentences)
2. Code quality issues or bugs
3. Missing error handling
Keep your response under 300 words.`,
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
