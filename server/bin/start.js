#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

// Bootstrap do MCP server: um clone limpo do plugin (via /plugin install) não
// traz node_modules/ nem dist/ (build artifacts, corretamente fora do git) —
// garante os dois antes de iniciar o servidor real. Saída do npm vai para
// stderr (fd 2), nunca stdout (fd 1): stdout é o canal do protocolo MCP e
// qualquer texto solto ali antes do handshake corrompe a conexão.
const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = join(serverDir, "dist", "index.js");

if (!existsSync(join(serverDir, "node_modules")) || !existsSync(distEntry)) {
  const stdio = ["ignore", 2, 2];
  execSync("npm install --silent", { cwd: serverDir, stdio });
  execSync("npm run build --silent", { cwd: serverDir, stdio });
}

await import(pathToFileURL(distEntry).href);
