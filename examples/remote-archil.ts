#!/usr/bin/env tsx

/**
 * Remote + Archil — client requests a workspace, server resolves credentials.
 *
 * Shows the multi-tenant pattern:
 *   - Server has a policy with resolveArchilConfig (injects auth tokens)
 *   - Client just sends the disk name — no token on the wire
 *   - Each connection gets its own Archil-backed workspace
 *
 * Requires: ARCHIL_TOKEN env var
 * Usage: ARCHIL_DISK=org/disk ARCHIL_TOKEN=adt_... npx tsx examples/remote-archil.ts
 */

import "dotenv/config";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createTools, connectSandbox, startServer } from "../src/index.js";

const PORT = 3457;
const ARCHIL_DISK = process.env.ARCHIL_DISK;
const ARCHIL_TOKEN = process.env.ARCHIL_TOKEN;

async function main() {
  if (!ARCHIL_DISK || !ARCHIL_TOKEN) {
    console.error("Error: ARCHIL_DISK and ARCHIL_TOKEN env vars required.");
    console.error("Usage: ARCHIL_DISK=org/disk ARCHIL_TOKEN=adt_... npx tsx examples/remote-archil.ts");
    process.exit(1);
  }

  console.log("=== deepbench: remote + Archil (dynamic config) ===\n");

  // 1. Start server with policy — clients can request Archil workspaces
  const stop = await startServer({
    python: true,
    port: PORT,
    policy: {
      allowSources: ["archil"],
      resolveArchilConfig: async (diskName, region) => {
        // Multi-tenant hook: validate disk name, resolve credentials
        console.log(`  [server] Resolving credentials for disk: ${diskName}`);
        return {
          diskName,
          authToken: ARCHIL_TOKEN!, // from server's env, never sent to client
          region: region ?? "aws-us-east-1",
        };
      },
    },
  });
  console.log(`Server running on ws://localhost:${PORT}`);
  console.log(`Policy: clients can request Archil workspaces\n`);

  // 2. Client connects with just a disk name — no token needed
  const provider = await connectSandbox(`ws://localhost:${PORT}`, {
    archil: { diskName: ARCHIL_DISK },
  });
  const tools = createTools(provider);
  const startTime = Date.now();

  const result = await generateText({
    model: anthropic("claude-sonnet-4-6"),
    tools,
    maxSteps: 15,
    prompt: `You have a persistent workspace. Files survive across sessions.

1. List existing files (ls /, find / -maxdepth 2)
2. Read any files from previous sessions
3. Write a new file: /notes/remote-session-${Date.now()}.md with a brief note
4. Summarize what existed and what you added (under 150 words)`,
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
