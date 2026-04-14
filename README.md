# deepbench

5 workspace tools for AI agents — read, write, bash, glob, grep. Pluggable execution backends, persistent cloud storage, multi-tenant isolation. Available as an SDK, MCP server, or self-hosted WebSocket server.

```typescript
import { createTools, JustBashProvider } from "deepbench";

const tools = createTools(new JustBashProvider({ dir: "./my-project" }));
```

## What makes deepbench different

- **MCP server** — expose workspace tools via MCP protocol. Any agent that speaks MCP can connect.
- **Multi-tenant workspaces** — server validates client requests against a policy, injects credentials, scopes each session to a subdirectory. No token on the wire.
- **Persistent cloud storage** — Archil integration with subdirectory scoping. Files survive across sessions. One disk, many tenants.
- **Self-hosted** — WebSocket server with `startServer()` API. Docker image with KVM auto-detection. No vendor lock-in.
- **In-process execution** — JustBash runs 70+ commands in-process via TypeScript. Zero boot time, 100+ concurrent sessions per container, runs anywhere Node.js runs.

## Install

```bash
npm install deepbench
```

## MCP Server

Expose workspace tools via MCP protocol. Your agent connects as an MCP client and gets all 5 tools.

### stdio

```bash
npx deepbench-mcp --dir ./my-project
```

### HTTP (remote / Docker)

```bash
npx deepbench-mcp --dir ./my-project --http --port 3001
```

### With Archil persistent storage

```bash
npx deepbench-mcp --archil-disk org/workspace --archil-token adt_...
```

## SDK

`createTools()` returns 5 tools compatible with Vercel AI SDK:

```typescript
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createTools, JustBashProvider } from "deepbench";

const tools = createTools(new JustBashProvider({ dir: "./my-project" }));

const result = await generateText({
  model: anthropic("claude-sonnet-4-6"),
  tools,
  maxSteps: 15,
  prompt: "Review this project for bugs.",
});
```

The tool handlers (`handleRead`, `handleWrite`, `handleBash`, `handleGlob`, `handleGrep`) are also exported individually for use with any framework.

## Multi-tenant Server

One server, many clients, each with their own isolated workspace. Clients request a workspace — server validates against a policy and injects credentials:

```typescript
import { startServer } from "deepbench/server";

const stop = await startServer({
  port: 3000,
  policy: {
    allowSources: ["archil"],
    resolveArchilConfig: async (diskName, region, subdirectory) => ({
      diskName,
      authToken: process.env.ARCHIL_TOKEN!,
      subdirectory,
    }),
  },
});
```

Client connects with just a disk name — no credentials needed:

```typescript
import { createTools, connectSandbox } from "deepbench";

const provider = await connectSandbox("ws://your-server:3000", {
  archil: { diskName: "org/disk", subdirectory: `/tenants/${tenantId}` },
});
const tools = createTools(provider);
```

Static workspace (no policy, all clients share one workspace):

```bash
npx deepbench-server --dir ./my-project
```

## Docker

```bash
docker run -v ./my-project:/workspace -p 3000:3000 ghcr.io/runplex/deepbench
```

Auto-detects KVM — uses microsandbox (real Linux microVMs) if available, JustBash otherwise.

## The 5 Tools

| Tool | What it does |
|------|-------------|
| **read** | Read file contents |
| **write** | Write file (creates parent dirs) |
| **bash** | Execute commands — grep, find, awk, jq, sed, python3, curl, 70+ built-in |
| **glob** | Find files by pattern |
| **grep** | Search file contents with regex |

## Filesystem Backends

### Local directory

```typescript
const provider = new JustBashProvider({ dir: "./my-project" });
```

### In-memory

```typescript
const provider = new JustBashProvider({
  files: { "/data/sales.csv": csvContent },
  python: true,
});
```

### Archil (persistent cloud storage)

Files survive across sessions. Subdirectory scoping for multi-tenant isolation:

```typescript
const provider = new JustBashProvider({
  archil: {
    diskName: "org/main-disk",
    authToken: process.env.ARCHIL_TOKEN,
    subdirectory: `/tenants/${tenantSlug}/users/${userId}`,
  },
});
```

Requires `npm install @archildata/client @archildata/just-bash`. Free 10GB at [console.archil.com](https://console.archil.com).

## Execution Backends

### JustBash (default)

In-process bash interpreter. Zero boot time. No containers, no VMs.

- 70+ commands: grep, find, awk, jq, sed, sort, curl, python3
- Python 3 via WASM (stdlib — json, csv, math, re, datetime, collections)
- 100+ concurrent sessions per container

### Microsandbox (upgrade)

Real Linux microVM for full execution — npm, node, gcc, pip. ~200ms boot.

```typescript
import { MicrosandboxProvider } from "deepbench";

const provider = new MicrosandboxProvider({
  image: "node:22-slim",
  files: { "src/app.ts": code },
});
```

Requires macOS Apple Silicon or Linux with KVM. `npm install microsandbox`.

## Architecture

```
Agent → createTools(provider) → Provider Interface → Execution + Filesystem
                                       │
              Execution:  JustBash (in-process) | Microsandbox (microVM) | Remote (WebSocket)
              Filesystem: Local dir | In-memory | Archil (cloud)
```

The Provider interface — implement it to add any backend:

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
