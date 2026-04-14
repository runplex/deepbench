/**
 * JustBash provider — in-process TypeScript bash interpreter.
 * Free, instant, 70+ commands, Python (WASM), curl, jq.
 * Runs anywhere Node.js runs. No containers, no VMs.
 *
 * Filesystem backends:
 *   dir:    Real local directory (ReadWriteFs)
 *   files:  In-memory ephemeral (InMemoryFs)
 *   archil: Persistent cloud storage (ArchilFs)
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Bash, InMemoryFs, ReadWriteFs } from "just-bash";
import type { Provider } from "../provider.js";

export interface ArchilConfig {
  /** Archil disk name (e.g. "org/disk-name") */
  diskName: string;
  /** Auth token for the disk */
  authToken: string;
  /** Region. Default: "aws-us-east-1" */
  region?: string;
  /** Subdirectory to scope the workspace to (e.g. "/tenants/acme/user-123") */
  subdirectory?: string;
}

export interface JustBashConfig {
  /**
   * Real directory to use as the workspace.
   * Mutually exclusive with `files` and `archil`.
   */
  dir?: string;
  /** Files to seed into an in-memory filesystem. Mutually exclusive with `dir` and `archil`. */
  files?: Record<string, string>;
  /** Archil persistent cloud storage config. Mutually exclusive with `dir` and `files`. */
  archil?: ArchilConfig;
  /** Enable Python 3 (WASM CPython). Default: false */
  python?: boolean;
  /** Network URLs allowed for curl. */
  network?: { allow?: string[]; allowAll?: boolean };
}

export class JustBashProvider implements Provider {
  private bash: Bash | null = null;
  private config: JustBashConfig;
  private _seedFiles?: Record<string, string>;
  private _seeded = false;
  private _archilClient: any = null;

  constructor(config: JustBashConfig = {}) {
    const sources = [config.dir, config.files, config.archil].filter(Boolean).length;
    if (sources > 1) {
      throw new Error("Specify only one of 'dir', 'files', or 'archil'.");
    }

    this.config = config;

    // Archil needs async init — defer to first use
    if (!config.archil) {
      this.bash = this.createBash();
    }
  }

  private createBash(fs?: any): Bash {
    if (!fs) {
      if (this.config.dir) {
        const root = resolve(this.config.dir);
        if (!existsSync(root)) {
          throw new Error(`Directory does not exist: ${root}`);
        }
        fs = new ReadWriteFs({ root });
      } else {
        fs = new InMemoryFs();
        if (this.config.files) {
          this._seedFiles = this.config.files;
        }
      }
    }

    const opts: ConstructorParameters<typeof Bash>[0] = {
      fs,
      cwd: "/",
      python: this.config.python ?? false,
    };

    if (this.config.network?.allowAll) {
      opts.network = { dangerouslyAllowFullInternetAccess: true };
    } else if (this.config.network?.allow?.length) {
      opts.network = { allowedUrlPrefixes: this.config.network.allow };
    }

    return new Bash(opts);
  }

  private async init(): Promise<Bash> {
    if (this.bash) return this.bash;

    // Archil async init
    if (this.config.archil) {
      let ArchilClient: any, createArchilFs: any;
      try {
        ({ ArchilClient } = await import("@archildata/client"));
        ({ createArchilFs } = await import("@archildata/just-bash"));
      } catch {
        throw new Error(
          "Archil packages not installed. Install with: npm install @archildata/client @archildata/just-bash"
        );
      }

      this._archilClient = await ArchilClient.connect({
        region: this.config.archil.region ?? "aws-us-east-1",
        diskName: this.config.archil.diskName,
        authToken: this.config.archil.authToken,
      });

      const archilOpts: any = {};
      if (this.config.archil.subdirectory) {
        archilOpts.subdirectory = this.config.archil.subdirectory;
      }
      const fs = await createArchilFs(this._archilClient, archilOpts);
      this.bash = this.createBash(fs);
    }

    return this.bash!;
  }

  private async seed(): Promise<void> {
    if (this._seeded || !this._seedFiles) return;
    this._seeded = true;
    const bash = await this.init();
    for (const [path, content] of Object.entries(this._seedFiles)) {
      const normalized = path.startsWith("/") ? path : `/${path}`;
      const dir = normalized.substring(0, normalized.lastIndexOf("/"));
      if (dir) await bash.exec(`mkdir -p "${dir}"`);
      await bash.fs.writeFile(normalized, content);
    }
  }

  async exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const bash = await this.init();
    await this.seed();
    const result = await bash.exec(command);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  async readFile(path: string): Promise<string> {
    const bash = await this.init();
    await this.seed();
    const result = await bash.exec(`cat "${path}"`);
    if (result.exitCode !== 0) throw new Error(`File not found: ${path}`);
    return result.stdout;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const bash = await this.init();
    await this.seed();
    const dir = path.substring(0, path.lastIndexOf("/"));
    if (dir) await bash.exec(`mkdir -p "${dir}"`);
    await bash.fs.writeFile(path, content);
  }

  async dispose(): Promise<void> {
    if (this._archilClient) {
      await this._archilClient.close();
      this._archilClient = null;
    }
  }
}
