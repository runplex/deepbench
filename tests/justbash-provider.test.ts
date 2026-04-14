import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JustBashProvider } from "../src/providers/justbash.js";

describe("JustBashProvider — in-memory files", () => {
  it("seeds files and can read them", async () => {
    const p = new JustBashProvider({
      files: { "/workspace/test.txt": "hello" },
    });
    const content = await p.readFile("/workspace/test.txt");
    expect(content).toBe("hello");
    await p.dispose();
  });

  it("ls sees seeded files", async () => {
    const p = new JustBashProvider({
      files: { "/workspace/src/app.ts": "const x = 1;" },
    });
    const result = await p.exec("ls /workspace/src/");
    expect(result.stdout).toContain("app.ts");
    await p.dispose();
  });

  it("find discovers seeded files", async () => {
    const p = new JustBashProvider({
      files: {
        "/workspace/a.ts": "a",
        "/workspace/sub/b.ts": "b",
      },
    });
    const result = await p.exec("find /workspace -name '*.ts' -type f");
    expect(result.stdout).toContain("a.ts");
    expect(result.stdout).toContain("b.ts");
    await p.dispose();
  });

  it("writeFile creates new files", async () => {
    const p = new JustBashProvider();
    await p.writeFile("/output/result.txt", "done");
    const content = await p.readFile("/output/result.txt");
    expect(content).toBe("done");
    await p.dispose();
  });

  it("exec runs bash commands", async () => {
    const p = new JustBashProvider();
    const result = await p.exec("echo 42");
    expect(result.stdout.trim()).toBe("42");
    expect(result.exitCode).toBe(0);
    await p.dispose();
  });

  it("reports non-zero exit codes", async () => {
    const p = new JustBashProvider();
    const result = await p.exec("false");
    expect(result.exitCode).not.toBe(0);
    await p.dispose();
  });

  it("throws on reading missing file", async () => {
    const p = new JustBashProvider();
    await expect(p.readFile("/nonexistent")).rejects.toThrow();
    await p.dispose();
  });
});

describe("JustBashProvider — real directory", () => {
  it("reads files from a real directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deepbench-test-"));
    writeFileSync(join(dir, "hello.txt"), "world");

    const p = new JustBashProvider({ dir });
    const content = await p.readFile("/hello.txt");
    expect(content).toBe("world");
    await p.dispose();
  });

  it("ls shows real files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deepbench-test-"));
    writeFileSync(join(dir, "a.ts"), "a");
    writeFileSync(join(dir, "b.ts"), "b");

    const p = new JustBashProvider({ dir });
    const result = await p.exec("ls /");
    expect(result.stdout).toContain("a.ts");
    expect(result.stdout).toContain("b.ts");
    await p.dispose();
  });

  it("find works on real directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deepbench-test-"));
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "deep.ts"), "deep");

    const p = new JustBashProvider({ dir });
    const result = await p.exec("find / -name '*.ts' -type f");
    expect(result.stdout).toContain("deep.ts");
    await p.dispose();
  });

  it("throws for nonexistent directory", () => {
    expect(() => new JustBashProvider({ dir: "/nonexistent-dir-12345" })).toThrow();
  });
});

describe("JustBashProvider — python", () => {
  it("runs python3 when enabled", async () => {
    const p = new JustBashProvider({ python: true });
    const result = await p.exec("python3 -c 'print(1 + 1)'");
    expect(result.stdout.trim()).toBe("2");
    await p.dispose();
  });
});

describe("JustBashProvider — config validation", () => {
  it("rejects dir + files together", () => {
    expect(() => new JustBashProvider({ dir: ".", files: { "/a": "b" } })).toThrow();
  });

  it("rejects dir + archil together", () => {
    expect(() =>
      new JustBashProvider({
        dir: ".",
        archil: { diskName: "x", authToken: "y" },
      }),
    ).toThrow();
  });

  it("rejects files + archil together", () => {
    expect(() =>
      new JustBashProvider({
        files: { "/a": "b" },
        archil: { diskName: "x", authToken: "y" },
      }),
    ).toThrow();
  });
});
