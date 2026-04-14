/**
 * Shared types for deepbench workspace configuration.
 */

import type { ArchilConfig } from "./providers/justbash.js";

/**
 * Workspace config — sent by the client to tell the server what workspace to create.
 * Archil authToken is deliberately absent — server resolves credentials.
 */
export interface WorkspaceConfig {
  /** Server-local directory to use as workspace. */
  dir?: string;
  /** In-memory seed files. */
  files?: Record<string, string>;
  /** Archil persistent cloud storage. No authToken — server resolves it. */
  archil?: {
    diskName: string;
    region?: string;
    /** Scope workspace to a subdirectory (e.g. "/tenants/acme/user-123") */
    subdirectory?: string;
  };
  /** OCI image for microsandbox execution. */
  image?: string;
  /** Enable Python 3 (WASM CPython, JustBash only). */
  python?: boolean;
}

/**
 * Server policy — controls what clients are allowed to request.
 * Secure by default: if no policy is set, clients cannot override the server's workspace.
 */
export interface ServerPolicy {
  /**
   * Which workspace sources clients may request.
   * Default: [] (clients cannot override — server default only).
   */
  allowSources?: Array<"files" | "dir" | "archil">;

  /**
   * For "dir" source: restrict to paths under these prefixes.
   * Prevents clients from requesting arbitrary server directories.
   */
  allowedDirPrefixes?: string[];

  /**
   * For "archil" source: resolve client's request to full ArchilConfig with credentials.
   * This is the multi-tenant hook — validate the disk/subdirectory, inject auth token.
   * Throw to reject the request.
   */
  resolveArchilConfig?: (diskName: string, region?: string, subdirectory?: string) => ArchilConfig | Promise<ArchilConfig>;

  /** Whether clients may request microsandbox execution. Default: false. */
  allowMicrosandbox?: boolean;

  /** Whether clients may set the OCI image. Default: false. */
  allowImage?: boolean;

  /** Limits for client-provided files. */
  fileLimits?: { maxFiles?: number; maxTotalBytes?: number };
}
