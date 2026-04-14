#!/usr/bin/env node

/**
 * deepbench MCP server — exposes 5 workspace tools over MCP.
 *
 * Supports two transports:
 *   stdio          — for local MCP clients (Claude Code, Cursor)
 *   streamable-http — for remote/Docker deployment
 *
 * Usage:
 *   npx deepbench-mcp --dir ./my-project                          # stdio (default)
 *   npx deepbench-mcp --dir ./my-project --http --port 3001       # HTTP server
 *
 * Claude Code config (.mcp.json) — local:
 *   {
 *     "mcpServers": {
 *       "workspace": {
 *         "command": "npx",
 *         "args": ["deepbench-mcp", "--dir", "./my-project"]
 *       }
 *     }
 *   }
 *
 * Claude Code config (.mcp.json) — remote:
 *   {
 *     "mcpServers": {
 *       "workspace": {
 *         "url": "http://localhost:3001/mcp"
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { z } from "zod";
import { JustBashProvider } from "../providers/justbash.js";
import { handleRead, handleWrite, handleBash, handleGlob, handleGrep } from "../tool-handlers.js";
import type { Provider } from "../provider.js";

// --- Parse CLI args ---

interface CliConfig {
  dir?: string;
  archilDisk?: string;
  archilToken?: string;
  archilRegion?: string;
  python: boolean;
  http: boolean;
  port: number;
}

function parseArgs(): CliConfig {
  const args = process.argv.slice(2);
  const config: CliConfig = { python: false, http: false, port: 3001 };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dir":
        config.dir = args[++i];
        break;
      case "--archil-disk":
        config.archilDisk = args[++i];
        break;
      case "--archil-token":
        config.archilToken = args[++i];
        break;
      case "--archil-region":
        config.archilRegion = args[++i];
        break;
      case "--python":
        config.python = true;
        break;
      case "--http":
        config.http = true;
        break;
      case "--port":
        config.port = parseInt(args[++i], 10);
        break;
      case "--help":
      case "-h":
        console.error(`deepbench-mcp — workspace tools for any AI agent

Usage:
  npx deepbench-mcp --dir ./my-project [options]
  npx deepbench-mcp --archil-disk org/disk --archil-token adt_... [options]

Filesystem (pick one):
  --dir <path>              Local directory as workspace
  --archil-disk <name>      Archil disk name (e.g. "org/disk")
  --archil-token <token>    Archil auth token (or ARCHIL_TOKEN env)
  --archil-region <region>  Archil region (default: aws-us-east-1)

Options:
  --python       Enable Python 3 (WASM CPython)
  --http         Use Streamable HTTP transport (for remote/Docker)
  --port <port>  HTTP port (default: 3001, requires --http)
  -h, --help     Show this help
`);
        process.exit(0);
    }
  }

  // Allow env vars for secrets
  config.archilToken ??= process.env.ARCHIL_TOKEN;

  return config;
}

// --- Register tools on server ---

function registerTools(server: McpServer, provider: Provider) {
  server.tool(
    "read",
    "Read the contents of a file at the given path.",
    { path: z.string().describe("File path to read") },
    async ({ path }) => ({
      content: [{ type: "text" as const, text: await handleRead(provider, { path }) }],
    }),
  );

  server.tool(
    "write",
    "Write content to a file. Creates parent directories automatically.",
    {
      path: z.string().describe("File path to write"),
      content: z.string().describe("Content to write"),
    },
    async ({ path, content }) => ({
      content: [{ type: "text" as const, text: await handleWrite(provider, { path, content }) }],
    }),
  );

  server.tool(
    "bash",
    "Execute a bash command. Supports grep, find, awk, jq, sed, sort, python3, curl, and 70+ commands.",
    { command: z.string().describe("Bash command to execute") },
    async ({ command }) => ({
      content: [{ type: "text" as const, text: await handleBash(provider, { command }) }],
    }),
  );

  server.tool(
    "glob",
    "Find files matching a pattern. Returns file paths.",
    {
      pattern: z.string().describe("File name pattern (e.g. '*.ts', '*.py')"),
      path: z.string().optional().describe("Directory to search. Default: /"),
    },
    async ({ pattern, path }) => ({
      content: [{ type: "text" as const, text: await handleGlob(provider, { pattern, path: path ?? "/" }) }],
    }),
  );

  server.tool(
    "grep",
    "Search for a pattern in files. Returns matching lines with paths and line numbers.",
    {
      pattern: z.string().describe("Search pattern (regex supported)"),
      path: z.string().optional().describe("File or directory to search. Default: /"),
      include: z.string().optional().describe("File glob to filter (e.g. '*.ts')"),
    },
    async ({ pattern, path, include }) => ({
      content: [{ type: "text" as const, text: await handleGrep(provider, { pattern, path: path ?? "/", include }) }],
    }),
  );
}

// --- Start server ---

async function main() {
  const config = parseArgs();

  if (!config.dir && !config.archilDisk) {
    console.error("Error: --dir or --archil-disk is required.\nUsage: npx deepbench-mcp --dir ./my-project");
    process.exit(1);
  }

  const providerConfig: any = { python: config.python };

  if (config.archilDisk) {
    if (!config.archilToken) {
      console.error("Error: --archil-token or ARCHIL_TOKEN env is required with --archil-disk");
      process.exit(1);
    }
    providerConfig.archil = {
      diskName: config.archilDisk,
      authToken: config.archilToken,
      region: config.archilRegion,
    };
  } else {
    providerConfig.dir = config.dir;
  }

  const provider: Provider = new JustBashProvider(providerConfig);

  const server = new McpServer({
    name: "deepbench",
    version: "0.1.0",
  });

  registerTools(server, provider);

  if (config.http) {
    // Streamable HTTP — for remote/Docker deployment
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const httpServer = createServer(async (req, res) => {
      if (req.url === "/mcp") {
        await transport.handleRequest(req, res);
      } else if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    await server.connect(transport);
    httpServer.listen(config.port, () => {
      console.error(`[deepbench] MCP server listening on http://0.0.0.0:${config.port}/mcp`);
    });
  } else {
    // Stdio — for local MCP clients
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((err) => {
  console.error("deepbench-mcp fatal:", err);
  process.exit(1);
});
