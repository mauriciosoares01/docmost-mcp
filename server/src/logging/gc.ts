import { rename, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mutationLogPath } from "./paths.js";

export interface GcConfig {
  maxSizeMB: number;
  maxAgeDays: number;
  maxFiles: number;
}

const DEFAULTS: GcConfig = { maxSizeMB: 5, maxAgeDays: 30, maxFiles: 5 };
const DEFAULT_GC_INTERVAL_MUTATIONS = 100;

// Casa com o nome gerado por rotateBySize: mutations-YYYYMMDD.jsonl, com
// sufixo -2, -3... quando mais de uma rotação acontece no mesmo dia.
const ROTATED_FILE_RE = /^mutations-\d{8}(?:-\d+)?\.jsonl$/;

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveConfig(overrides?: Partial<GcConfig>): GcConfig {
  return {
    maxSizeMB: overrides?.maxSizeMB ?? envNumber("DOCMOST_MCP_LOG_MAX_SIZE_MB", DEFAULTS.maxSizeMB),
    maxAgeDays: overrides?.maxAgeDays ?? envNumber("DOCMOST_MCP_LOG_MAX_AGE_DAYS", DEFAULTS.maxAgeDays),
    maxFiles: overrides?.maxFiles ?? envNumber("DOCMOST_MCP_LOG_MAX_FILES", DEFAULTS.maxFiles),
  };
}

const gcIntervalMutations = envNumber("DOCMOST_MCP_LOG_GC_INTERVAL", DEFAULT_GC_INTERVAL_MUTATIONS);
let mutationsSinceGc = 0;

// Chamado pelo logMutation após cada gravação — dispara a GC a cada N
// mutações (§5.1). Fire-and-forget: nunca atrasa nem bloqueia a tool que
// acabou de gravar o log.
export function notifyMutationLogged(): void {
  mutationsSinceGc++;
  if (mutationsSinceGc >= gcIntervalMutations) {
    mutationsSinceGc = 0;
    void runGarbageCollection().catch((err) => warn(err));
  }
}

// Best-effort, nesta ordem (§5.1): rotação por tamanho -> retenção por idade
// -> retenção por contagem. Qualquer falha aqui nunca deve impedir uma
// mutação real no Docmost — por isso todo erro cai em warning, nunca throw.
export async function runGarbageCollection(overrides?: Partial<GcConfig>): Promise<void> {
  const config = resolveConfig(overrides);
  try {
    await rotateBySize(config.maxSizeMB);
    await enforceRetention(config);
  } catch (err) {
    warn(err);
  }
}

async function rotateBySize(maxSizeMB: number): Promise<void> {
  const activePath = mutationLogPath();
  const info = await stat(activePath).catch(() => null);
  if (!info || info.size <= maxSizeMB * 1024 * 1024) return;

  const dir = dirname(activePath);
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let target = join(dir, `mutations-${datePart}.jsonl`);
  for (let suffix = 2; await pathExists(target); suffix++) {
    target = join(dir, `mutations-${datePart}-${suffix}.jsonl`);
  }

  await rename(activePath, target); // rename = atômico dentro do mesmo diretório/volume
}

async function enforceRetention(config: GcConfig): Promise<void> {
  const dir = dirname(mutationLogPath());
  const entries = await readdir(dir).catch(() => [] as string[]);
  const rotatedNames = entries.filter((name) => ROTATED_FILE_RE.test(name));

  const withStats = await Promise.all(
    rotatedNames.map(async (name) => {
      const fullPath = join(dir, name);
      const info = await stat(fullPath).catch(() => null);
      return info ? { fullPath, mtimeMs: info.mtimeMs } : null;
    }),
  );
  const files = withStats.filter((f): f is { fullPath: string; mtimeMs: number } => f !== null);

  const maxAgeMs = config.maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const survivors: typeof files = [];
  for (const file of files) {
    if (now - file.mtimeMs > maxAgeMs) {
      await unlink(file.fullPath).catch((err) => warn(err));
    } else {
      survivors.push(file);
    }
  }

  survivors.sort((a, b) => b.mtimeMs - a.mtimeMs); // mais recente primeiro
  for (const excess of survivors.slice(config.maxFiles)) {
    await unlink(excess.fullPath).catch((err) => warn(err));
  }
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function warn(err: unknown): void {
  console.error(`[docmost-mcp] garbage collection do log de mutações falhou: ${(err as Error).message}`);
}
