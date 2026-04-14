import { describe, it, expect } from "vitest";
import { handleRead, handleWrite, handleBash, handleGlob, handleGrep } from "../src/tool-handlers.js";
import type { Provider } from "../src/provider.js";

/** Minimal mock provider that records calls. */
function mockProvider(opts: {
  execResult?: { stdout: string; stderr: string; exitCode: number };
  readResult?: string;
  readError?: Error;
} = {}): Provider & { calls: { method: string; args: any[] }[] } {
  const calls: { method: string; args: any[] }[] = [];
  return {
    calls,
    async exec(command: string) {
      calls.push({ method: "exec", args: [command] });
      return opts.execResult ?? { stdout: "", stderr: "", exitCode: 0 };
    },
    async readFile(path: string) {
      calls.push({ method: "readFile", args: [path] });
      if (opts.readError) throw opts.readError;
      return opts.readResult ?? "";
    },
    async writeFile(path: string, content: string) {
      calls.push({ method: "writeFile", args: [path, content] });
    },
    async dispose() {},
  };
}

describe("handleRead", () => {
  it("returns file content", async () => {
    const p = mockProvider({ readResult: "hello world" });
    const result = await handleRead(p, { path: "/test.txt" });
    expect(result).toBe("hello world");
    expect(p.calls[0]).toEqual({ method: "readFile", args: ["/test.txt"] });
  });

  it("returns error string on failure", async () => {
    const p = mockProvider({ readError: new Error("not found") });
    const result = await handleRead(p, { path: "/missing" });
    expect(result).toContain("Error");
  });
});

describe("handleWrite", () => {
  it("creates parent directory and writes file", async () => {
    const p = mockProvider();
    const result = await handleWrite(p, { path: "/a/b/file.txt", content: "data" });
    expect(result).toContain("Wrote 4 bytes");
    expect(p.calls[0].method).toBe("exec"); // mkdir -p
    expect(p.calls[0].args[0]).toContain("mkdir");
    expect(p.calls[1]).toEqual({ method: "writeFile", args: ["/a/b/file.txt", "data"] });
  });

  it("skips mkdir for root-level files", async () => {
    const p = mockProvider();
    await handleWrite(p, { path: "file.txt", content: "data" });
    // No mkdir call, just writeFile
    expect(p.calls[0].method).toBe("writeFile");
  });
});

describe("handleBash", () => {
  it("returns stdout", async () => {
    const p = mockProvider({ execResult: { stdout: "hello", stderr: "", exitCode: 0 } });
    const result = await handleBash(p, { command: "echo hello" });
    expect(result).toBe("hello");
  });

  it("includes stderr and exit code on failure", async () => {
    const p = mockProvider({ execResult: { stdout: "", stderr: "fail", exitCode: 1 } });
    const result = await handleBash(p, { command: "bad" });
    expect(result).toContain("stderr: fail");
    expect(result).toContain("exit code: 1");
  });

  it("returns (no output) for empty result", async () => {
    const p = mockProvider({ execResult: { stdout: "", stderr: "", exitCode: 0 } });
    const result = await handleBash(p, { command: "true" });
    expect(result).toBe("(no output)");
  });
});

describe("handleGlob", () => {
  it("runs find with pattern", async () => {
    const p = mockProvider({ execResult: { stdout: "/a.ts\n/b.ts\n", stderr: "", exitCode: 0 } });
    const result = await handleGlob(p, { pattern: "*.ts" });
    expect(result).toContain("/a.ts");
    expect(p.calls[0].args[0]).toContain("find");
    expect(p.calls[0].args[0]).toContain("*.ts");
  });

  it("uses custom path", async () => {
    const p = mockProvider({ execResult: { stdout: "", stderr: "", exitCode: 0 } });
    await handleGlob(p, { pattern: "*.py", path: "/src" });
    expect(p.calls[0].args[0]).toContain("/src");
  });

  it("returns 'No files found' on empty", async () => {
    const p = mockProvider({ execResult: { stdout: "", stderr: "", exitCode: 0 } });
    const result = await handleGlob(p, { pattern: "*.xyz" });
    expect(result).toBe("No files found");
  });
});

describe("handleGrep", () => {
  it("runs grep with pattern", async () => {
    const p = mockProvider({ execResult: { stdout: "/a.ts:1:match", stderr: "", exitCode: 0 } });
    const result = await handleGrep(p, { pattern: "match" });
    expect(result).toContain("/a.ts:1:match");
    expect(p.calls[0].args[0]).toContain("grep");
  });

  it("adds --include filter", async () => {
    const p = mockProvider({ execResult: { stdout: "", stderr: "", exitCode: 0 } });
    await handleGrep(p, { pattern: "test", include: "*.ts" });
    expect(p.calls[0].args[0]).toContain("--include=");
  });
});

describe("shell escaping", () => {
  it("escapes single quotes in glob path", async () => {
    const p = mockProvider({ execResult: { stdout: "", stderr: "", exitCode: 0 } });
    await handleGlob(p, { pattern: "*.ts", path: "/it's a dir" });
    const cmd = p.calls[0].args[0];
    expect(cmd).not.toContain("it's"); // raw quote would break
    expect(cmd).toContain("it"); // should be escaped
  });

  it("escapes single quotes in grep pattern", async () => {
    const p = mockProvider({ execResult: { stdout: "", stderr: "", exitCode: 0 } });
    await handleGrep(p, { pattern: "it's" });
    const cmd = p.calls[0].args[0];
    expect(cmd).toContain("'\\''"); // escaped quote
  });

  it("wraps grep pattern in single quotes to prevent flag injection", async () => {
    const p = mockProvider({ execResult: { stdout: "", stderr: "", exitCode: 0 } });
    await handleGrep(p, { pattern: "--help" });
    const cmd = p.calls[0].args[0];
    expect(cmd).toContain("'--help'"); // wrapped in quotes, not interpreted as flag
  });
});
