#!/usr/bin/env node
import { createInterface, type Interface } from "node:readline";
import { saveCredentials } from "./security/credentials.js";

const CTRL_C = 0x03;
const CTRL_D = 0x04;
const BACKSPACE = 0x08;
const DELETE = 0x7f;

function prompt(rl: Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

// Lê a senha sem ecoar no terminal. Precisa ser chamada depois que qualquer
// readline.Interface anterior já foi fechado — do contrário, o listener
// interno de "keypress" do readline continua ativo e ecoa os caracteres,
// mesmo com rl.pause(). Em stdin não interativo (pipe/redirect), não há
// como mascarar — cai para leitura de linha normal.
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;

  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin, terminal: false });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let input = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    // Um único evento "data" pode conter mais de um caractere (ex.: senha colada
    // de um gerenciador de senhas) — precisa iterar, não tratar o chunk como 1 char.
    const onData = (chunk: string) => {
      for (const char of chunk) {
        const code = char.charCodeAt(0);
        if (char === "\n" || char === "\r") {
          cleanup();
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (code === CTRL_C) {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Login cancelado."));
          return;
        }
        if (code === CTRL_D) {
          cleanup();
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (code === BACKSPACE || code === DELETE) {
          input = input.slice(0, -1);
          continue;
        }
        input += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function login(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const baseUrl = (await prompt(rl, "Base URL do Docmost (ex.: https://docs.suaempresa.com): ")).replace(/\/+$/, "");
  const email = await prompt(rl, "E-mail: ");
  rl.close();

  const password = await promptHidden("Senha: ");

  if (!baseUrl || !email || !password) {
    throw new Error("Base URL, e-mail e senha são obrigatórios.");
  }

  await saveCredentials({ baseUrl, email, password });
  console.log(`Credenciais salvas para ${email} (${baseUrl}).`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== "login") {
    console.error("Uso: docmost-mcp login");
    process.exitCode = 1;
    return;
  }
  await login();
}

main().catch((err) => {
  console.error("Falha no login:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
