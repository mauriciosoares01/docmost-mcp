import { getPassword, setPassword, deletePassword } from "@napi-rs/keyring/keytar.js";
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdir, readFile, writeFile, rm, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";

const SERVICE = "docmost-mcp";

export interface DocmostCredentials {
  baseUrl: string;
  email: string;
  password: string;
}

interface EncryptedPassword {
  iv: string;
  authTag: string;
  ciphertext: string;
}

interface StoredFile {
  mode: "native" | "fallback";
  baseUrl: string;
  email: string;
  encrypted?: EncryptedPassword;
}

function storedFilePath(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "docmost-mcp", "credentials");
  }
  return join(homedir(), ".config", "docmost-mcp", "credentials");
}

// Mitigação para ambientes headless (sem cofre nativo disponível), não um
// cofre de segredos de verdade: a chave é derivada de material local
// previsível (usuário do SO + salt fixo do app), não de um segredo do usuário.
const APP_SALT = "docmost-mcp:fallback:v1";

function deriveKey(): Buffer {
  return scryptSync(userInfo().username, APP_SALT, 32);
}

function encryptPassword(password: string): EncryptedPassword {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptPassword(enc: EncryptedPassword): string {
  const key = deriveKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(enc.iv, "base64"));
  decipher.setAuthTag(Buffer.from(enc.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

async function writeStoredFile(data: StoredFile): Promise<void> {
  const filePath = storedFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data), { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function readStoredFile(): Promise<StoredFile | null> {
  const filePath = storedFilePath();
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as StoredFile;
}

export async function saveCredentials(creds: DocmostCredentials): Promise<void> {
  const { baseUrl, email, password } = creds;
  try {
    await setPassword(SERVICE, email, password);
    await writeStoredFile({ mode: "native", baseUrl, email });
  } catch {
    // Cofre nativo indisponível (ex. headless sem gnome-keyring/kwallet) —
    // cai no fallback cifrado. Nunca grava a senha em plaintext.
    const encrypted = encryptPassword(password);
    await writeStoredFile({ mode: "fallback", baseUrl, email, encrypted });
  }
}

export async function getCredentials(): Promise<DocmostCredentials | null> {
  const stored = await readStoredFile();
  if (!stored) return null;

  if (stored.mode === "fallback" && stored.encrypted) {
    return {
      baseUrl: stored.baseUrl,
      email: stored.email,
      password: decryptPassword(stored.encrypted),
    };
  }

  const password = await getPassword(SERVICE, stored.email);
  if (password == null) return null;
  return { baseUrl: stored.baseUrl, email: stored.email, password };
}

export async function deleteCredentials(): Promise<void> {
  const stored = await readStoredFile();
  if (stored) {
    try {
      await deletePassword(SERVICE, stored.email);
    } catch {
      // Ignora — pode não existir no cofre nativo (ex. quando o modo é fallback).
    }
  }
  const filePath = storedFilePath();
  if (existsSync(filePath)) {
    await rm(filePath);
  }
}
