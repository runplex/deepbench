/**
 * Microsandbox provider — real Linux microVM, sub-100ms boot.
 * Requires macOS Apple Silicon or Linux with KVM.
 *
 * microsandbox is an optional dependency — this module loads it lazily.
 */

import type { Provider } from "../provider.js";

export interface MicrosandboxConfig {
  /** OCI image to use. Default: "ubuntu" */
  image?: string;
  /** CPU count. Default: 1 */
  cpus?: number;
  /** Memory in MiB. Default: 512 */
  memoryMib?: number;
  /** Files to seed into the sandbox. Keys are paths, values are content. */
  files?: Record<string, string>;
  /** Network policy. Default: "public-only" */
  network?: "none" | "public-only" | "allow-all";
}

let sandboxCounter = 0;

export class MicrosandboxProvider implements Provider {
  private sandbox: any = null;
  private config: MicrosandboxConfig;
  private bootMs = 0;

  constructor(config: MicrosandboxConfig = {}) {
    this.config = config;
  }

  /** Boot the microVM (lazy — called on first command). */
  async boot(): Promise<void> {
    if (this.sandbox) return;

    let msb: any;
    try {
      msb = await import("microsandbox");
    } catch {
      throw new Error(
        "microsandbox is not installed. Install it with: npm install microsandbox\n" +
        "Requires macOS Apple Silicon or Linux with KVM."
      );
    }

    const { Sandbox, Patch, NetworkPolicy } = msb;
    const start = Date.now();
    const name = `deepbench-${++sandboxCounter}-${Date.now()}`;

    // Build patches from seed files
    const patches: any[] = [];
    patches.push(Patch.mkdir("/workspace", { mode: 0o755 }));
    if (this.config.files) {
      for (const [path, content] of Object.entries(this.config.files)) {
        const fullPath = path.startsWith("/") ? path : `/workspace/${path}`;
        const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
        if (dir && dir !== "/workspace") {
          patches.push(Patch.mkdir(dir, { mode: 0o755 }));
        }
        patches.push(Patch.text(fullPath, content));
      }
    }

    // Network policy
    let network;
    switch (this.config.network) {
      case "none": network = NetworkPolicy.none(); break;
      case "allow-all": network = NetworkPolicy.allowAll(); break;
      default: network = NetworkPolicy.publicOnly(); break;
    }

    this.sandbox = await Sandbox.create({
      name,
      image: this.config.image ?? "ubuntu",
      cpus: this.config.cpus ?? 1,
      memoryMib: this.config.memoryMib ?? 512,
      patches,
      network,
    });

    this.bootMs = Date.now() - start;
  }

  async exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number; bootMs?: number }> {
    await this.boot();
    const result = await this.sandbox!.shell(command);
    const ret = {
      stdout: result.stdout(),
      stderr: result.stderr(),
      exitCode: result.code,
      bootMs: this.bootMs > 0 ? this.bootMs : undefined,
    };
    if (this.bootMs > 0) this.bootMs = 0;
    return ret;
  }

  async readFile(path: string): Promise<string> {
    await this.boot();
    return this.sandbox!.fs().readString(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.boot();
    await this.sandbox!.fs().write(path, Buffer.from(content));
  }

  async dispose(): Promise<void> {
    if (this.sandbox) {
      await this.sandbox.stopAndWait();
      this.sandbox = null;
    }
  }
}
