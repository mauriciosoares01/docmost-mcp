import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCredentials, saveCredentials } from "./credentials.js";

// Roda uma vez, logo após conectar o transport: se não há credenciais no
// cofre, pede baseUrl/e-mail/senha via elicitation (formulário nativo do
// host) e salva. Nunca lança nem derruba o processo — se o host não suportar
// elicitation ou o usuário cancelar, só orienta a rodar 'docmost-mcp login'
// manualmente. Isso evita repetir o bug original: process.exit() antes do
// handshake stdio, que o host reporta como "-32000 failed to reconnect" sem
// nenhum contexto útil.
export async function ensureCredentialsInteractive(server: McpServer): Promise<void> {
  if (await getCredentials()) return;

  try {
    const result = await server.server.elicitInput({
      message:
        "Docmost MCP ainda não está configurado. Informe a URL da sua instância, e-mail e senha " +
        "(aviso: este formulário não mascara a senha na tela).",
      requestedSchema: {
        type: "object",
        properties: {
          baseUrl: {
            type: "string",
            title: "Base URL do Docmost",
            description: "Ex.: https://docs.suaempresa.com",
            format: "uri",
          },
          email: {
            type: "string",
            title: "E-mail",
            format: "email",
          },
          password: {
            type: "string",
            title: "Senha",
            description: "Não mascarada nesta tela — o protocolo MCP não tem campo de senha dedicado.",
          },
        },
        required: ["baseUrl", "email", "password"],
      },
    });

    if (result.action !== "accept" || !result.content) {
      console.error("Configuração cancelada. Rode 'node bin/cli.js login' quando quiser tentar de novo.");
      return;
    }

    const baseUrl = String(result.content.baseUrl ?? "").replace(/\/+$/, "");
    const email = String(result.content.email ?? "");
    const password = String(result.content.password ?? "");

    if (!baseUrl || !email || !password) {
      console.error("Dados incompletos recebidos na configuração inicial.");
      return;
    }

    await saveCredentials({ baseUrl, email, password });
    console.error(`Credenciais salvas para ${email} (${baseUrl}).`);
  } catch (err) {
    console.error(
      "Não foi possível configurar via formulário interativo:",
      err instanceof Error ? err.message : String(err),
      "— rode 'node bin/cli.js login' manualmente.",
    );
  }
}
