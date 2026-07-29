import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { mutationLogPath } from "./paths.js";
import { notifyMutationLogged } from "./gc.js";

export interface MutationLogEntry {
  tool: string;
  target: Record<string, unknown>;
  mode?: string;
  status: number;
}

// Nunca grava senha, JWT ou corpo de resposta — só metadados (§5.1). Falha de
// escrita (disco cheio, permissão) é best-effort: nunca deve impedir a
// operação real no Docmost, só avisa em stderr.
export async function logMutation(entry: MutationLogEntry): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  const filePath = mutationLogPath();
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${line}\n`, "utf8");
  } catch (err) {
    console.error(`[docmost-mcp] falha ao gravar log de mutação em ${filePath}: ${(err as Error).message}`);
  }
  // Dispara a GC (etapa 11) a cada N mutações — nunca bloqueia esta chamada.
  notifyMutationLogged();
}
