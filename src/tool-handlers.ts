/**
 * Shared tool logic — used by both AI SDK tools and MCP server.
 */

import type { Provider } from "./provider.js";

/** Escape a string for safe use inside single quotes in shell commands. */
function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

export async function handleRead(provider: Provider, params: { path: string }): Promise<string> {
  try {
    return await provider.readFile(params.path);
  } catch (err) {
    return `Error: ${err}`;
  }
}

export async function handleWrite(provider: Provider, params: { path: string; content: string }): Promise<string> {
  try {
    const dir = params.path.substring(0, params.path.lastIndexOf("/"));
    if (dir) await provider.exec(`mkdir -p '${shellEscape(dir)}'`);
    await provider.writeFile(params.path, params.content);
    return `Wrote ${params.content.length} bytes to ${params.path}`;
  } catch (err) {
    return `Error: ${err}`;
  }
}

export async function handleBash(provider: Provider, params: { command: string }): Promise<string> {
  try {
    const result = await provider.exec(params.command);
    let output = "";
    if (result.stdout) output += result.stdout;
    if (result.stderr) output += (output ? "\n" : "") + `stderr: ${result.stderr}`;
    if (result.exitCode !== 0) output += `\nexit code: ${result.exitCode}`;
    return output || "(no output)";
  } catch (err) {
    return `Error: ${err}`;
  }
}

export async function handleGlob(provider: Provider, params: { pattern: string; path?: string }): Promise<string> {
  const dir = params.path ?? "/";
  const result = await provider.exec(`find '${shellEscape(dir)}' -type f -name '${shellEscape(params.pattern)}' 2>/dev/null | sort`);
  return result.stdout || "No files found";
}

export async function handleGrep(provider: Provider, params: { pattern: string; path?: string; include?: string }): Promise<string> {
  const dir = params.path ?? "/";
  let cmd = `grep -rn '${shellEscape(params.pattern)}' '${shellEscape(dir)}'`;
  if (params.include) cmd += ` --include='${shellEscape(params.include)}'`;
  cmd += " 2>/dev/null";
  const result = await provider.exec(cmd);
  return result.stdout || "No matches found";
}
