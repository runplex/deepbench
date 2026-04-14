import { describe, it, expect } from "vitest";
import { startServer } from "../src/server/ws-server.js";
import { connectSandbox } from "../src/providers/remote.js";

// Helper: start server, connect client, run assertion, clean up
async function withServerAndClient(
  serverConfig: Parameters<typeof startServer>[0],
  workspace: Parameters<typeof connectSandbox>[1],
  fn: (provider: Awaited<ReturnType<typeof connectSandbox>>) => Promise<void>,
) {
  const port = 3400 + Math.floor(Math.random() * 100);
  const stop = await startServer({ ...serverConfig, port });
  try {
    const provider = await connectSandbox(`ws://localhost:${port}`, workspace);
    try {
      await fn(provider);
    } finally {
      await provider.dispose();
    }
  } finally {
    stop();
  }
}

describe("server policy", () => {
  it("allows no-init connections (backward compat)", async () => {
    await withServerAndClient(
      { dir: "." },
      undefined, // no workspace config
      async (provider) => {
        const result = await provider.exec("echo hello");
        expect(result.stdout.trim()).toBe("hello");
      },
    );
  });

  it("rejects client workspace when no policy set", async () => {
    const port = 3501;
    const stop = await startServer({ dir: ".", port });
    try {
      await expect(
        connectSandbox(`ws://localhost:${port}`, { files: { "/a": "b" } }),
      ).rejects.toThrow("does not allow");
    } finally {
      stop();
    }
  });

  it("allows files when policy permits", async () => {
    await withServerAndClient(
      { policy: { allowSources: ["files"] } },
      { files: { "/test.txt": "hello from client" } },
      async (provider) => {
        const result = await provider.exec("cat /test.txt");
        expect(result.stdout).toBe("hello from client");
      },
    );
  });

  it("rejects archil when only files allowed", async () => {
    const port = 3502;
    const stop = await startServer({ policy: { allowSources: ["files"] }, port });
    try {
      await expect(
        connectSandbox(`ws://localhost:${port}`, { archil: { diskName: "test" } }),
      ).rejects.toThrow('not allowed');
    } finally {
      stop();
    }
  });

  it("rejects too many files", async () => {
    const port = 3503;
    const stop = await startServer({
      policy: { allowSources: ["files"], fileLimits: { maxFiles: 2 } },
      port,
    });
    try {
      await expect(
        connectSandbox(`ws://localhost:${port}`, {
          files: { "/a": "1", "/b": "2", "/c": "3" },
        }),
      ).rejects.toThrow("Too many files");
    } finally {
      stop();
    }
  });

  it("rejects files too large", async () => {
    const port = 3504;
    const stop = await startServer({
      policy: { allowSources: ["files"], fileLimits: { maxTotalBytes: 10 } },
      port,
    });
    try {
      await expect(
        connectSandbox(`ws://localhost:${port}`, {
          files: { "/big": "x".repeat(100) },
        }),
      ).rejects.toThrow("too large");
    } finally {
      stop();
    }
  });

  it("rejects dir with path traversal", async () => {
    const port = 3505;
    const stop = await startServer({
      policy: { allowSources: ["dir"], allowedDirPrefixes: ["/tmp"] },
      port,
    });
    try {
      await expect(
        connectSandbox(`ws://localhost:${port}`, { dir: "/tmp/../etc" }),
      ).rejects.toThrow("traversal");
    } finally {
      stop();
    }
  });

  it("resolves archil credentials via policy callback", async () => {
    let resolvedDisk = "";
    await withServerAndClient(
      {
        policy: {
          allowSources: ["files", "archil"],
          resolveArchilConfig: async (diskName) => {
            resolvedDisk = diskName;
            // Return fake config — we won't actually connect to Archil
            throw new Error("Test: would connect to " + diskName);
          },
        },
      },
      { archil: { diskName: "tenants/acme" } },
      async () => {
        // Won't get here — resolveArchilConfig throws
      },
    ).catch((err) => {
      expect(resolvedDisk).toBe("tenants/acme");
      expect(err.message).toContain("tenants/acme");
    });
  });

  it("rejects multiple sources", async () => {
    const port = 3506;
    const stop = await startServer({
      policy: { allowSources: ["files", "dir"] },
      port,
    });
    try {
      await expect(
        connectSandbox(`ws://localhost:${port}`, {
          files: { "/a": "b" },
          dir: "/tmp",
        }),
      ).rejects.toThrow("only one");
    } finally {
      stop();
    }
  });
});
