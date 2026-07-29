import { getCredentials } from "../security/credentials.js";

export class DocmostAdapter {
  private jwt: string | null = null;

  constructor(private readonly baseUrl: string) {}

  async login(): Promise<void> {
    const creds = await getCredentials();
    if (!creds) {
      throw new Error("Nenhuma credencial configurada. Rode 'docmost-mcp login' primeiro.");
    }

    const start = Date.now();
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: creds.email, password: creds.password }),
    });
    logCall("POST", "/api/auth/login", res.status, Date.now() - start);

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error("Credenciais inválidas.");
      }
      throw new Error(`Falha no login (status ${res.status}).`);
    }

    const token = extractAuthToken(res);
    if (!token) {
      throw new Error("Login respondeu OK mas não trouxe o cookie authToken.");
    }
    this.jwt = token;
  }

  async request(method: string, path: string, body?: unknown): Promise<Response> {
    if (!this.jwt) {
      await this.login();
    }

    let res = await this.doRequest(method, path, body);
    if (res.status === 401) {
      await this.login();
      res = await this.doRequest(method, path, body);
      if (res.status === 401) {
        throw new Error(`Não autenticado em ${path} mesmo após novo login.`);
      }
    }
    return res;
  }

  private async doRequest(method: string, path: string, body?: unknown): Promise<Response> {
    const start = Date.now();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: `authToken=${this.jwt}`,
      },
      // A API interna do Docmost espera um corpo JSON mesmo em endpoints sem
      // parâmetros (ex. /workspace/info) — "{}" em vez de nenhum corpo.
      body: JSON.stringify(body ?? {}),
    });
    logCall(method, path, res.status, Date.now() - start);
    return res;
  }
}

function extractAuthToken(res: Response): string | null {
  const cookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""].filter(Boolean);

  for (const cookie of cookies) {
    const match = cookie.match(/(?:^|;\s*)authToken=([^;]+)/);
    if (match) return match[1];
  }
  return null;
}

// Nunca loga corpo de request/response — só endpoint, status e latência.
// Vai para stderr (não stdout): o stdout é o canal do protocolo MCP (stdio).
function logCall(method: string, path: string, status: number, latencyMs: number): void {
  console.error(`[docmost] ${method} ${path} -> ${status} (${latencyMs}ms)`);
}
