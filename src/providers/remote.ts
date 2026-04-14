/**
 * Remote provider — connects to a deepbench server over WebSocket.
 * Implements the Provider interface so createTools() works with it.
 *
 * ws is an optional dependency — only needed for remote connections.
 */

import type { Provider } from "../provider.js";
import type { WorkspaceConfig } from "../types.js";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

export class RemoteSandboxProvider implements Provider {
  private ws: any = null;
  private pending = new Map<string, PendingRequest>();
  private reqCounter = 0;
  private ready: Promise<void> | null = null;
  private url: string;
  private workspace?: WorkspaceConfig;
  private initialized = false;

  constructor(url: string, workspace?: WorkspaceConfig) {
    this.url = url;
    this.workspace = workspace;
  }

  private async connect(): Promise<void> {
    if (this.ws) return;

    const { default: WebSocket } = await import("ws");
    this.ws = new WebSocket(this.url);

    this.ready = new Promise<void>((resolve, reject) => {
      this.ws.on("open", () => resolve());
      this.ws.on("error", (err: Error) => reject(err));
    });

    this.ws.on("message", (data: any) => {
      const res = JSON.parse(data.toString());
      const pending = this.pending.get(res.id);
      if (pending) {
        this.pending.delete(res.id);
        if (res.error) pending.reject(new Error(res.error));
        else pending.resolve(res.result);
      }
    });

    this.ws.on("close", () => {
      for (const [id, pending] of this.pending) {
        pending.reject(new Error("WebSocket connection closed"));
        this.pending.delete(id);
      }
    });

    await this.ready;

    // Send init if workspace config was provided
    if (this.workspace && !this.initialized) {
      await this.call("init", { workspace: this.workspace });
      this.initialized = true;
    }
  }

  private async call(method: string, params?: Record<string, any>): Promise<any> {
    await this.connect();
    const id = `${++this.reqCounter}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number; bootMs?: number }> {
    return this.call("exec", { command });
  }

  async readFile(path: string): Promise<string> {
    return this.call("readFile", { path });
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.call("writeFile", { path, content });
  }

  async dispose(): Promise<void> {
    if (this.ws) {
      await this.call("dispose");
      this.ws.close();
      this.ws = null;
    }
  }
}

/**
 * Connect to a remote deepbench server.
 *
 * Usage:
 *   // Use server defaults
 *   const provider = await connectSandbox("ws://localhost:3000");
 *
 *   // Specify workspace (server must allow via policy)
 *   const provider = await connectSandbox("ws://localhost:3000", {
 *     archil: { diskName: "tenants/acme" },
 *   });
 */
export async function connectSandbox(
  url: string,
  workspace?: WorkspaceConfig,
): Promise<RemoteSandboxProvider> {
  const provider = new RemoteSandboxProvider(url, workspace);
  await (provider as any).connect();
  return provider;
}
