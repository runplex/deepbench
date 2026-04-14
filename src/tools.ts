/**
 * Agent tools — read, write, bash, glob, grep.
 * Works with any provider. Compatible with Vercel AI SDK v4.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Provider } from "./provider.js";
import { handleRead, handleWrite, handleBash, handleGlob, handleGrep } from "./tool-handlers.js";

export function createTools(provider: Provider) {
  return {
    read: tool({
      description: "Read the contents of a file at the given path.",
      parameters: z.object({
        path: z.string().describe("File path to read"),
      }),
      execute: async (params) => handleRead(provider, params),
    }),

    write: tool({
      description: "Write content to a file. Creates parent directories automatically.",
      parameters: z.object({
        path: z.string().describe("File path to write"),
        content: z.string().describe("Content to write"),
      }),
      execute: async (params) => handleWrite(provider, params),
    }),

    bash: tool({
      description: "Execute a bash command. Full Linux environment — bash, python, node, npm, git, curl, grep, awk, sed, jq, and any installed tool.",
      parameters: z.object({
        command: z.string().describe("Bash command to execute"),
      }),
      execute: async (params) => handleBash(provider, params),
    }),

    glob: tool({
      description: "Find files matching a pattern. Returns file paths.",
      parameters: z.object({
        pattern: z.string().describe("File name pattern (e.g. '*.ts', '*.py')"),
        path: z.string().optional().describe("Directory to search. Default: /workspace"),
      }),
      execute: async (params) => handleGlob(provider, params),
    }),

    grep: tool({
      description: "Search for a pattern in files. Returns matching lines with paths and line numbers.",
      parameters: z.object({
        pattern: z.string().describe("Search pattern (regex supported)"),
        path: z.string().optional().describe("File or directory to search. Default: /workspace"),
        include: z.string().optional().describe("File glob to filter (e.g. '*.ts')"),
      }),
      execute: async (params) => handleGrep(provider, params),
    }),
  };
}
