import { homedir } from "node:os";
import { join } from "node:path";

// Caminhos do §5.1 da arquitetura — local por SO, fora do repo/vault.
export function mutationLogDir(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(base, "docmost-mcp", "logs");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Logs", "docmost-mcp");
  }
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(base, "docmost-mcp");
}

export function mutationLogPath(): string {
  return join(mutationLogDir(), "mutations.jsonl");
}
