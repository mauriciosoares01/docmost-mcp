import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ConfirmationDescription {
  tool: string;
  target: string;
  effect: string;
}

// Guarda-corpo de escrita (§5 da arquitetura): não é enforcement de acesso —
// é sobre previsibilidade. O RBAC do Docmost já decide o que a conta pode
// fazer; isto só garante que o usuário viu o alvo/efeito antes da mutação.
export async function requireConfirmation(
  server: McpServer,
  description: ConfirmationDescription,
): Promise<boolean> {
  const result = await server.server.elicitInput({
    message:
      `${description.effect}\n\nAlvo: ${description.target}\n\n` +
      `Confirmar? Responda "Sim" para prosseguir ou "Não" para cancelar.`,
    requestedSchema: {
      type: "object",
      properties: {
        confirm: {
          type: "string",
          title: 'Confirmar (Sim/Não)',
          description: `Confirma a execução de '${description.tool}'?`,
          enum: ["yes", "no"],
          enumNames: ["Sim, confirmar", "Não, cancelar"],
        },
      },
      required: ["confirm"],
    },
  });

  if (result.action !== "accept") return false;
  return result.content?.confirm === "yes";
}
