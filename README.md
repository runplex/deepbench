# deepbench

Give any AI agent a workspace. Five tools, one line of code.

Most AI agents are shallow — they call a tool, get one result, respond. deepbench makes them deep. Your agent can explore files, write scripts, run Python, search codebases, and produce artifacts. Like Claude Code, but in your own agent, with your own prompts, on any data.

```typescript
import { createTools, JustBashProvider } from "deepbench";

const tools = createTools(new JustBashProvider({ dir: "./my-project" }));
// Your agent can now read, write, bash, glob, grep
```

## Why deepbench?

**The problem:** Function-calling agents today are one-shot. They call an API, get a result, done. To make an agent that can actually *work* — explore a codebase, analyze data, write reports — you need sandboxes, containers, VMs, infrastructure.

**The solution:** deepbench gives your agent 5 workspace tools that run in-process. No containers. No VMs. No infrastructure. 100+ concurrent sessions per container. Works anywhere Node.js runs.

**Not a sandbox for coding agents.** E2B, Daytona, and Modal are sandboxes for agents that need `npm test` or `gcc`. deepbench is a workspace for agents that need to *think* — data analysis, code review, research, ops automation, multi-agent coordination. Different product, different market.

## Install

```bash
npm install deepbench
```

## Quick Start

### SDK — build your own agent

```typescript
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createTools, JustBashProvider } from "deepbench";

const provider = new JustBashProvider({ dir: "./my-project" });
const tools = createTools(provider);

const result = await generateText({
  model: anthropic("claude-sonnet-4-6"),
  tools,
  maxSteps: 15,
  prompt: "Review this project for bugs. Explore the code, read key files, and report issues.",
});

console.log(result.text);
await provider.dispose();
```

### MCP — add workspace tools to any AI editor

Add to `.mcp.json` — Claude Code, Cursor, and Windsurf instantly get 5 workspace tools:

```json
{
  "mcpServers": {
    "workspace": {
      "command": "npx",
      "args": ["deepbench-mcp", "--dir", "./my-project"]
    }
  }
}
```

### Docker — self-host for remote agents

```bash
docker run -v ./my-project:/workspace -p 3000:3000 deepbench
```

Clients connect with the SDK:

```typescript
import { createTools, connectSandbox } from "deepbench";

const provider = await connectSandbox("ws://your-server:3000");
const tools = createTools(provider);
```

## The 5 Tools

| Tool | What it does |
|------|-------------|
| **read** | Read file contents |
| **write** | Write file (creates parent dirs) |
| **bash** | Execute commands — grep, find, awk, jq, sed, python3, curl, 70+ built-in |
| **glob** | Find files by pattern |
| **grep** | Search file contents with regex |

Works with Vercel AI SDK, OpenAI SDK, LangChain, or any function-calling framework. Also available as an MCP server.

## Filesystem Backends

### Local directory — real files

```typescript
const provider = new JustBashProvider({ dir: "./my-project" });
```

### In-memory — ephemeral workspace

```typescript
const provider = new JustBashProvider({
  files: {
    "/data/sales.csv": csvContent,
    "/scripts/analyze.py": pythonScript,
  },
  python: true,
});
```

### Archil — persistent cloud storage

Files survive across sessions. Agent picks up where the last one left off.

```typescript
const provider = new JustBashProvider({
  archil: {
    diskName: "org/workspace",
    authToken: process.env.ARCHIL_TOKEN,
  },
});
```

Scope to a subdirectory for multi-tenant isolation — one disk, many users:

```typescript
const provider = new JustBashProvider({
  archil: {
    diskName: "org/main-disk",
    authToken: process.env.ARCHIL_TOKEN,
    subdirectory: `/tenants/${tenantSlug}/users/${userId}`,
  },
});
// Agent only sees files in that subdirectory
```

Requires `npm install @archildata/client @archildata/just-bash`. Free 10GB at [console.archil.com](https://console.archil.com).

## Execution Backends

### JustBash (default)

In-process bash interpreter. Zero boot time. No containers, no VMs. Runs anywhere Node.js runs.

- 70+ commands: grep, find, awk, jq, sed, sort, curl, python3
- Python 3 via WASM (stdlib — json, csv, math, re, datetime, collections)
- 100+ concurrent sessions per container

### Microsandbox (upgrade)

Real Linux microVM for when you need full execution — npm, node, gcc, pip. ~200ms boot.

```typescript
import { MicrosandboxProvider } from "deepbench";

const provider = new MicrosandboxProvider({
  image: "node:22-slim",
  files: { "src/app.ts": code },
});
```

Requires macOS Apple Silicon or Linux with KVM. `npm install microsandbox`.

## Remote / Self-hosting

Run the workspace server, connect from anywhere. Clients send workspace config, server validates and creates the provider.

### Static workspace (simple)

```typescript
import { startServer } from "deepbench/server";

// Server has a fixed workspace — all clients share it
const stop = await startServer({ dir: "./my-project", port: 3000 });
```

### Dynamic workspace (multi-tenant)

```typescript
import { startServer } from "deepbench/server";

// Server lets clients request Archil workspaces — resolves credentials
const stop = await startServer({
  port: 3000,
  policy: {
    allowSources: ["archil"],
    resolveArchilConfig: async (diskName, region, subdirectory) => ({
      diskName,
      authToken: process.env.ARCHIL_TOKEN!,
      subdirectory, // each client scoped to their own path
    }),
  },
});
```

### Connect from client

```typescript
import { createTools, connectSandbox } from "deepbench";

// Use server defaults
const provider = await connectSandbox("ws://your-server:3000");

// Or request a specific workspace (server must allow via policy)
const provider = await connectSandbox("ws://your-server:3000", {
  archil: {
    diskName: "org/main-disk",
    subdirectory: `/tenants/${tenantSlug}/users/${userId}`,
  },
});

const tools = createTools(provider);
```

### CLI

```bash
npx deepbench-server --dir ./my-project
npx deepbench-server --archil-disk org/workspace --archil-token adt_...
```

### Docker

```bash
docker run -v ./my-project:/workspace -p 3000:3000 deepbench
```

### MCP server

```bash
# stdio (local — Claude Code, Cursor, Windsurf)
npx deepbench-mcp --dir ./my-project

# HTTP (remote — Docker deployment)
npx deepbench-mcp --dir ./my-project --http --port 3001
```

## Architecture

```
Agent (any SDK) → createTools(provider) → Provider Interface → Execution + Filesystem
                                               │
                       Execution:  JustBash (in-process) | Microsandbox (microVM) | Remote (WebSocket)
                       Filesystem: Local dir | In-memory | Archil (cloud)
```

The `Provider` interface is 4 methods. Implement it to add any backend:

```typescript
interface Provider {
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  dispose(): Promise<void>;
}
```

## License

MIT
