import { DocmostAdapter } from "./docmost/adapter.js";

// baseUrl vem do cofre de credenciais (rode 'node bin/cli.js login' antes),
// não mais de env var — mesma fonte usada pelo server real.
async function main(): Promise<void> {
  const adapter = new DocmostAdapter();
  await adapter.login();
  console.log("login ok");

  const res = await adapter.request("POST", "/api/workspace/info");
  console.log(`POST /api/workspace/info -> ${res.status}`);
}

main().catch((err) => {
  console.error("Smoke test falhou:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
