import { describe, it, expect } from "vitest";
import { createTools, JustBashProvider } from "../src/index.js";

describe("createTools", () => {
  it("returns 5 tools", () => {
    const provider = new JustBashProvider();
    const tools = createTools(provider);
    expect(Object.keys(tools).sort()).toEqual(["bash", "glob", "grep", "read", "write"]);
  });

  it("tools have execute functions", () => {
    const provider = new JustBashProvider();
    const tools = createTools(provider);
    for (const tool of Object.values(tools)) {
      expect(tool).toHaveProperty("execute");
      expect(typeof (tool as any).execute).toBe("function");
    }
  });

  it("read tool reads files through provider", async () => {
    const provider = new JustBashProvider({
      files: { "/test.txt": "hello from test" },
    });
    const tools = createTools(provider);
    const result = await (tools.read as any).execute({ path: "/test.txt" });
    expect(result).toBe("hello from test");
    await provider.dispose();
  });

  it("write tool creates files through provider", async () => {
    const provider = new JustBashProvider();
    const tools = createTools(provider);
    const writeResult = await (tools.write as any).execute({ path: "/out.txt", content: "written" });
    expect(writeResult).toContain("Wrote 7 bytes");
    const readResult = await (tools.read as any).execute({ path: "/out.txt" });
    expect(readResult).toBe("written");
    await provider.dispose();
  });

  it("bash tool executes commands", async () => {
    const provider = new JustBashProvider();
    const tools = createTools(provider);
    const result = await (tools.bash as any).execute({ command: "echo deepbench" });
    expect(result.trim()).toBe("deepbench");
    await provider.dispose();
  });

  it("glob tool finds files", async () => {
    const provider = new JustBashProvider({
      files: { "/src/a.ts": "a", "/src/b.ts": "b", "/src/c.json": "c" },
    });
    const tools = createTools(provider);
    const result = await (tools.glob as any).execute({ pattern: "*.ts", path: "/src" });
    expect(result).toContain("a.ts");
    expect(result).toContain("b.ts");
    expect(result).not.toContain("c.json");
    await provider.dispose();
  });

  it("grep tool searches content", async () => {
    const provider = new JustBashProvider({
      files: {
        "/src/app.ts": "function hello() { return 42; }",
        "/src/util.ts": "function goodbye() { return 0; }",
      },
    });
    const tools = createTools(provider);
    const result = await (tools.grep as any).execute({ pattern: "hello", path: "/src" });
    expect(result).toContain("app.ts");
    expect(result).not.toContain("util.ts");
    await provider.dispose();
  });
});
