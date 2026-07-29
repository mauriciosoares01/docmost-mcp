import { DocmostAdapter } from "./docmost/adapter.js";

async function main(): Promise<void> {
  const baseUrl = process.env.DOCMOST_BASE_URL;
  if (!baseUrl) {
    console.error("Defina DOCMOST_BASE_URL antes de rodar o smoke test.");
    process.exitCode = 1;
    return;
  }

  const adapter = new DocmostAdapter(baseUrl);
  await adapter.login();
  console.log("login ok");

  const res = await adapter.request("POST", "/api/workspace/info");
  console.log(`POST /api/workspace/info -> ${res.status}`);
}

main().catch((err) => {
  console.error("Smoke test falhou:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
