#!/usr/bin/env node

/**
 * deepbench WebSocket server — each connection gets its own workspace.
 *
 * Programmatic:
 *   const stop = await startServer({
 *     port: 3000,
 *     policy: {
 *       allowSources: ["archil"],
 *       resolveArchilConfig: async (diskName) => ({
 *         diskName, authToken: process.env.ARCHIL_TOKEN!, region: "aws-us-east-1",
 *       }),
 *     },
 *   });
 *
 * CLI:
 *   npx deepbench-server --dir ./my-project
 *   npx deepbench-server --archil-disk org/disk --archil-token adt_...
 *
 * Clients connect with:
 *   const provider = await connectSandbox("ws://localhost:3000", { archil: { diskName: "tenants/acme" } });
 *   const tools = createTools(provider);
 */

import { resolve } from "node:path";
import type { Provider } from "../provider.js";
import { JustBashProvider, type JustBashConfig, type ArchilConfig } from "../providers/justbash.js";
import type { WorkspaceConfig, ServerPolicy } from "../types.js";

// --- Public API ---

export type { WorkspaceConfig, ServerPolicy };

export interface DeepbenchServerConfig {
  /** Default local directory as workspace (used when client sends no config). */
  dir?: string;
  /** Default in-memory files to seed. */
  files?: Record<string, string>;
  /** Default Archil config (includes authToken). */
  archil?: ArchilConfig;
  /**
   * Use microsandbox (real Linux microVM).
   * - true: force microsandbox
   * - "auto": use microsandbox if /dev/kvm exists, otherwise JustBash
   * - false/undefined: use JustBash
   */
  microsandbox?: boolean | "auto";
  /** Default OCI image for microsandbox. Default: "ubuntu" */
  image?: string;
  /** Enable Python 3 (WASM CPython, JustBash only). Default: false */
  python?: boolean;
  /** Port. Default: 3000 */
  port?: number;
  /** Policy controlling what clients can request. Default: locked (client cannot override). */
  policy?: ServerPolicy;
}

function detectKvm(): boolean {
  try {
    const { accessSync, constants } = require("node:fs");
    accessSync("/dev/kvm", constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a deepbench WebSocket server.
 * Returns a function to stop the server.
 */
export async function startServer(config: DeepbenchServerConfig = {}): Promise<() => void> {
  const { WebSocketServer } = await import("ws");
  const port = config.port ?? 3000;

  // Resolve "auto" microsandbox detection
  if (config.microsandbox === "auto") {
    const kvmAvailable = detectKvm();
    config.microsandbox = kvmAvailable;
    if (kvmAvailable) {
      console.log("[deepbench] KVM detected — microsandbox enabled");
    } else {
      console.log("[deepbench] No KVM — using JustBash");
    }
  }

  let sessionCounter = 0;
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws) => {
    const name = `session-${++sessionCounter}`;
    let provider: Provider | null = null;

    ws.on("message", async (data) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ id: "?", error: "Invalid JSON" }));
        return;
      }

      const req = msg as { id: string; method: string; params?: any };
      const reply = (res: any) => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ id: req.id, ...res }));
        }
      };

      try {
        switch (req.method) {
          case "ping":
            reply({ result: "pong" });
            break;

          case "init": {
            if (provider) {
              reply({ error: "Workspace already initialized" });
              break;
            }
            provider = await createSessionProvider(config, req.params?.workspace);
            reply({ result: { status: "ok" } });
            break;
          }

          case "exec": {
            // Lazy init with server defaults if no init was sent
            if (!provider) {
              provider = await createSessionProvider(config, undefined);
            }
            const command = req.params?.command as string;
            if (!command) { reply({ error: "command required" }); break; }
            const result = await provider.exec(command);
            reply({ result });
            break;
          }

          case "readFile": {
            if (!provider) { reply({ error: "No workspace active" }); break; }
            const content = await provider.readFile(req.params?.path);
            reply({ result: content });
            break;
          }

          case "writeFile": {
            if (!provider) { reply({ error: "No workspace active" }); break; }
            await provider.writeFile(req.params?.path, req.params?.content);
            reply({ result: "ok" });
            break;
          }

          case "dispose": {
            if (provider) { await provider.dispose(); provider = null; }
            reply({ result: "ok" });
            break;
          }

          default:
            reply({ error: `Unknown method: ${req.method}` });
        }
      } catch (err) {
        reply({ error: String(err) });
      }
    });

    ws.on("close", async () => {
      if (provider) await provider.dispose().catch(() => {});
    });
  });

  return () => wss.close();
}

// --- Validate client workspace config against server policy ---

async function validateAndResolveWorkspace(
  config: DeepbenchServerConfig,
  clientWorkspace: WorkspaceConfig,
): Promise<{ justbash?: JustBashConfig; microsandbox?: any }> {
  const policy = config.policy;

  // No policy = no client overrides allowed
  if (!policy) {
    throw new Error("Server does not allow client workspace configuration");
  }

  // Determine requested source
  const sources = [
    clientWorkspace.dir && "dir",
    clientWorkspace.files && "files",
    clientWorkspace.archil && "archil",
  ].filter(Boolean) as Array<"dir" | "files" | "archil">;

  if (sources.length > 1) {
    throw new Error("Specify only one of dir, files, or archil");
  }

  const source = sources[0];

  // Check source is allowed
  if (source) {
    const allowed = policy.allowSources ?? [];
    if (!allowed.includes(source)) {
      throw new Error(`Source "${source}" not allowed by server policy`);
    }
  }

  // Source-specific validation
  const justbashConfig: JustBashConfig = {
    python: clientWorkspace.python ?? config.python,
  };

  if (source === "dir") {
    const dirPath = clientWorkspace.dir!;
    if (dirPath.includes("..")) {
      throw new Error("Path traversal not allowed");
    }
    const resolved = resolve(dirPath);
    const prefixes = policy.allowedDirPrefixes ?? [];
    if (prefixes.length > 0 && !prefixes.some(p => resolved.startsWith(resolve(p)))) {
      throw new Error("Requested directory not in allowed prefixes");
    }
    justbashConfig.dir = dirPath;
  }

  if (source === "files") {
    const limits = policy.fileLimits ?? { maxFiles: 100, maxTotalBytes: 10_000_000 };
    const entries = Object.entries(clientWorkspace.files!);
    if (limits.maxFiles && entries.length > limits.maxFiles) {
      throw new Error(`Too many files: ${entries.length} > ${limits.maxFiles}`);
    }
    const totalBytes = entries.reduce((sum, [, v]) => sum + v.length, 0);
    if (limits.maxTotalBytes && totalBytes > limits.maxTotalBytes) {
      throw new Error(`Files too large: ${totalBytes} > ${limits.maxTotalBytes}`);
    }
    justbashConfig.files = clientWorkspace.files;
  }

  if (source === "archil") {
    if (!policy.resolveArchilConfig) {
      throw new Error("Server has no Archil credential resolver configured");
    }
    const fullConfig = await policy.resolveArchilConfig(
      clientWorkspace.archil!.diskName,
      clientWorkspace.archil!.region,
      clientWorkspace.archil!.subdirectory,
    );
    justbashConfig.archil = fullConfig;
  }

  // Image validation
  if (clientWorkspace.image && !policy.allowImage) {
    throw new Error("Custom images not allowed by server policy");
  }

  // Microsandbox check
  if (clientWorkspace.image && policy.allowMicrosandbox && config.microsandbox) {
    return {
      microsandbox: {
        image: clientWorkspace.image,
        files: clientWorkspace.files,
        network: "public-only",
      },
    };
  }

  return { justbash: justbashConfig };
}

// --- Create provider for a session ---

async function createSessionProvider(
  config: DeepbenchServerConfig,
  clientWorkspace: WorkspaceConfig | undefined,
): Promise<Provider> {
  // Client provided workspace config — validate against policy
  if (clientWorkspace) {
    const resolved = await validateAndResolveWorkspace(config, clientWorkspace);

    if (resolved.microsandbox) {
      const { MicrosandboxProvider } = await import("../providers/microsandbox.js");
      return new MicrosandboxProvider(resolved.microsandbox);
    }

    return new JustBashProvider(resolved.justbash!);
  }

  // No client config — use server defaults
  if (config.microsandbox === true) {
    const { MicrosandboxProvider } = await import("../providers/microsandbox.js");
    return new MicrosandboxProvider({
      image: config.image ?? "ubuntu",
      network: "public-only",
    });
  }

  const justbashConfig: JustBashConfig = { python: config.python };
  if (config.archil) {
    justbashConfig.archil = config.archil;
  } else if (config.dir) {
    justbashConfig.dir = config.dir;
  } else if (config.files) {
    justbashConfig.files = config.files;
  }

  return new JustBashProvider(justbashConfig);
}

// --- CLI entry point ---

async function main() {
  const args = process.argv.slice(2);
  const config: DeepbenchServerConfig = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--dir": config.dir = args[++i]; break;
      case "--microsandbox":
        const next = args[i + 1];
        if (next === "auto") { config.microsandbox = "auto"; i++; }
        else { config.microsandbox = true; }
        break;
      case "--image": config.image = args[++i]; break;
      case "--archil-disk":
        config.archil = config.archil ?? { diskName: "", authToken: "" };
        config.archil.diskName = args[++i];
        break;
      case "--archil-token":
        config.archil = config.archil ?? { diskName: "", authToken: "" };
        config.archil.authToken = args[++i];
        break;
      case "--archil-region":
        config.archil = config.archil ?? { diskName: "", authToken: "" };
        config.archil.region = args[++i];
        break;
      case "--python": config.python = true; break;
      case "--port": config.port = parseInt(args[++i], 10); break;
      case "--help": case "-h":
        console.log(`deepbench-server — workspace tools over WebSocket

Usage:
  npx deepbench-server --dir ./my-project [options]
  npx deepbench-server --archil-disk org/disk --archil-token adt_... [options]
  npx deepbench-server --microsandbox --image node:22-slim [options]

Options:
  --dir <path>              Local directory as workspace
  --archil-disk <name>      Archil disk name
  --archil-token <token>    Archil auth token (or ARCHIL_TOKEN env)
  --archil-region <region>  Archil region (default: aws-us-east-1)
  --microsandbox            Use real Linux microVM (requires KVM)
  --image <name>            OCI image for microsandbox (default: ubuntu)
  --python                  Enable Python 3 (JustBash only)
  --port <port>             Port (default: 3000, or PORT env)
  -h, --help                Show this help
`);
        process.exit(0);
    }
  }

  // Env var fallbacks
  if (config.archil && !config.archil.authToken) {
    config.archil.authToken = process.env.ARCHIL_TOKEN ?? "";
  }
  config.port ??= parseInt(process.env.PORT ?? "3000", 10);

  const port = config.port;
  await startServer(config);
  console.log(`[deepbench] Server listening on ws://0.0.0.0:${port}`);
}

// Run CLI if executed directly
const isDirectRun = process.argv[1]?.includes("ws-server");
if (isDirectRun) {
  main().catch((err) => {
    console.error("deepbench-server fatal:", err);
    process.exit(1);
  });
}
