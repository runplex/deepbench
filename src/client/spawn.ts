/**
 * spawnInSandbox — returns a SpawnedProcess that the Claude Agent SDK
 * can use via spawnClaudeCodeProcess. The actual process runs inside
 * a remote microsandbox.
 */

import { Readable, Writable } from "node:stream";
import { EventEmitter } from "node:events";

interface SpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}

interface SpawnedProcess {
  stdin: Writable;
  stdout: Readable;
  readonly killed: boolean;
  readonly exitCode: number | null;
  kill(signal?: string): boolean;
  on(event: "exit", listener: (code: number | null, signal: string | null) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
  off(event: "exit", listener: (code: number | null, signal: string | null) => void): void;
  off(event: "error", listener: (error: Error) => void): void;
}

export interface SpawnInSandboxOptions {
  /** Files to seed into the sandbox workspace. */
  files?: Record<string, string>;
  /** OCI image. Default: "node:22-slim" */
  image?: string;
}

/**
 * Create a SpawnedProcess adapter that runs Claude Code inside a remote sandbox.
 */
export function spawnInSandbox(
  serverUrl: string,
  sdkOpts: SpawnOptions,
  sandboxOpts?: SpawnInSandboxOptions,
): SpawnedProcess {
  const emitter = new EventEmitter();
  let _killed = false;
  let _exitCode: number | null = null;
  let ws: any = null;

  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });

  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      if (ws?.readyState === 1 /* WebSocket.OPEN */) {
        ws.send(JSON.stringify({ type: "stdin", data: chunk.toString() }));
      }
      callback();
    },
  });

  // Async connect — import ws dynamically, then open connection
  (async () => {
    try {
      const { default: WebSocket } = await import("ws");
      ws = new WebSocket(serverUrl);

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "spawn",
          params: {
            command: sdkOpts.command,
            args: sdkOpts.args,
            cwd: sdkOpts.cwd,
            env: sdkOpts.env,
            files: sandboxOpts?.files,
            image: sandboxOpts?.image ?? "node:22-slim",
          },
        }));
      });

      ws.on("message", (data: any) => {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case "stdout":
            stdout.push(Buffer.from(msg.data));
            break;
          case "stderr":
            stderr.push(Buffer.from(msg.data));
            break;
          case "exit":
            _exitCode = msg.code ?? 0;
            stdout.push(null);
            stderr.push(null);
            emitter.emit("exit", _exitCode, null);
            ws.close();
            break;
          case "error":
            emitter.emit("error", new Error(msg.message));
            break;
        }
      });

      ws.on("error", (err: Error) => {
        emitter.emit("error", err);
      });

      ws.on("close", () => {
        if (_exitCode === null) {
          _exitCode = 1;
          stdout.push(null);
          stderr.push(null);
          emitter.emit("exit", 1, null);
        }
      });

      sdkOpts.signal?.addEventListener("abort", () => {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "kill" }));
        }
        _killed = true;
      });
    } catch (err) {
      emitter.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return {
    stdin,
    stdout,
    get killed() { return _killed; },
    get exitCode() { return _exitCode; },
    kill(signal?: string) {
      if (ws?.readyState === 1) {
        ws.send(JSON.stringify({ type: "kill", signal }));
      }
      _killed = true;
      return true;
    },
    on: (event: string, listener: (...args: any[]) => void) => { emitter.on(event, listener); },
    off: (event: string, listener: (...args: any[]) => void) => { emitter.off(event, listener); },
  } as SpawnedProcess;
}
