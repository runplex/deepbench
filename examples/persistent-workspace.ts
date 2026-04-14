#!/usr/bin/env tsx

/**
 * Persistent workspace — files survive across agent sessions.
 *
 * Shows: JustBashProvider + Archil cloud storage
 * Run this multiple times — each session sees files from previous sessions.
 *
 * Requires: ARCHIL_TOKEN env var or --token flag
 * Setup: Sign up at console.archil.com (free, 10GB, no credit card)
 *
 * Usage:
 *   ARCHIL_TOKEN=adt_... npx tsx examples/persistent-workspace.ts
 */

import "dotenv/config";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createTools, JustBashProvider } from "../src/index.js";

const ARCHIL_DISK = process.env.ARCHIL_DISK;
if (!ARCHIL_DISK) {
  console.error("Error: ARCHIL_DISK env var required (e.g. org/disk-name).");
  process.exit(1);
}
const ARCHIL_TOKEN = process.env.ARCHIL_TOKEN;

async function main() {
  if (!ARCHIL_TOKEN) {
    console.error("Error: ARCHIL_TOKEN env var required.");
    console.error("Sign up at console.archil.com (free) and create a disk token.");
    process.exit(1);
  }

  console.log(`=== deepbench: persistent workspace ===`);
  console.log(`Archil disk: ${ARCHIL_DISK}\n`);

  const provider = new JustBashProvider({
    python: true,
    archil: {
      diskName: ARCHIL_DISK,
      authToken: ARCHIL_TOKEN,
    },
  });

  const tools = createTools(provider);
  const startTime = Date.now();

  const result = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    tools,
    maxSteps: 15,
    prompt: `You have a persistent workspace on Archil cloud storage.

1. First, check what files already exist (ls /, find / -maxdepth 2). Note any files from previous sessions.
2. Read any existing files to understand what was done before.
3. Add something new — write a brief observation or analysis to /observations/session-${Date.now()}.md
4. Summarize: what files existed before, what you added, and how this demonstrates persistence across sessions.

Keep response under 200 words.`,
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
