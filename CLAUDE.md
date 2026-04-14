# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**deepbench** — give any AI agent a workspace. Five tools (read, write, bash, glob, grep) backed by swappable execution and filesystem layers.

Two distribution paths:
1. **SDK** — `createTools(provider)` returns 5 Vercel AI SDK tools for any agent
2. **MCP server** — `npx deepbench-mcp --dir ./project` exposes the same 5 tools over MCP

## Commands

```bash
pnpm build                # Build dist/ from src/
pnpm demo                 # Basic demo (in-memory files + AI agent)
pnpm demo:data            # Data analysis with Python WASM
pnpm demo:review          # Code review on a real directory
pnpm demo:persistent      # Archil persistent workspace (needs ARCHIL_DISK + ARCHIL_TOKEN)
pnpm demo:remote          # WebSocket server + client
pnpm demo:remote-archil   # Remote + Archil (needs ARCHIL_DISK + ARCHIL_TOKEN)
pnpm mcp                  # Start MCP server (stdio)
pnpm server               # Start WebSocket server
```

All demos run via `tsx` from source. No tests yet.

## Architecture

```
Agent (any SDK) → createTools(provider) → Provider Interface → Execution + Filesystem
                                               │
                       Execution:  JustBash (in-process) | Microsandbox (microVM) | Remote (WebSocket)
                       Filesystem: Local dir | In-memory | Archil (cloud)
```

### Provider Interface

```typescript
interface Provider {
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  dispose(): Promise<void>;
}
```

### Key Files

- `src/tools.ts` — `createTools(provider)`, wraps 5 tools for Vercel AI SDK
- `src/tool-handlers.ts` — shared logic for both AI SDK tools and MCP server
- `src/provider.ts` — Provider interface
- `src/providers/justbash.ts` — in-process bash, supports dir/files/archil backends
- `src/providers/microsandbox.ts` — real Linux microVM (lazy dynamic import)
- `src/providers/remote.ts` — WebSocket client to a deepbench server
- `src/mcp/server.ts` — MCP server binary (stdio + Streamable HTTP)
- `src/server/ws-server.ts` — WebSocket server with `startServer()` API
- `src/index.ts` — public exports

### JustBashProvider Filesystem Backends

```typescript
new JustBashProvider({ dir: "./project" })                    // real directory (ReadWriteFs)
new JustBashProvider({ files: { "/data.csv": content } })     // in-memory (InMemoryFs)
new JustBashProvider({ archil: { diskName, authToken } })     // persistent cloud (ArchilFs)
```

Files seeded via `files` option use lazy `mkdir -p` + `writeFile` on first use to ensure directory structure exists for ls/find/cat.

## Critical Constraints

### AI SDK Version Pinning
- **AI SDK v6 + zod v4: BROKEN** — tool schema conversion strips `type: "object"` from parameters
- **AI SDK v4 + zod v3.25: WORKS** — pinned to `ai@4`, `@ai-sdk/anthropic@1`, `zod@3.25.76`
- Do not upgrade without verifying tool schemas still work

### Optional Dependencies
- `microsandbox` — real Linux microVMs, requires macOS Apple Silicon or Linux with KVM. Loaded via dynamic `import()` in MicrosandboxProvider.
- `ws` — WebSocket, needed only for remote provider and server. Loaded via dynamic `import()`.
- `@archildata/client` + `@archildata/just-bash` — Archil cloud storage. Loaded via dynamic `import()` in JustBashProvider.

### just-bash Limitations
- curl: built-in implementation, cannot handle SSE streaming responses. Use native `fetch()` for MCP calls.
- Python: WASM CPython with stdlib only. No pip, no native extensions.
- No Node.js runtime (no require, no npm). Has QuickJS for basic JS.

### Microsandbox
- Lazy boot on first command (~200ms cached, ~6s first pull)
- Seed files via `Patch.mkdir()` + `Patch.text()` at boot time
- Docker needs Ubuntu 24.04+ (glibc >= 2.38 for native binding)
- Docker needs `--device /dev/kvm` on Linux, or `shamefully-hoist=true` in .npmrc

## Environment

- `.env` file with `ANTHROPIC_API_KEY` (required for demos)
- ESM project (`"type": "module"` in package.json)
- TypeScript: `ES2022` target, `Node16` module resolution, strict mode
- Node.js 22+, pnpm
- npm package name: `deepbench` (claimed, published as placeholder)
