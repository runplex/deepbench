/** Any backend that can exec, readFile, writeFile. */
export interface Provider {
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number; bootMs?: number }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  dispose(): Promise<void>;
}
