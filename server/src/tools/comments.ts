import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocmostAdapter } from "../docmost/adapter.js";
import { cancelledResult, jsonContent, parseDocmostResponse } from "./shared.js";
import { markdownToProseMirror } from "../convert/prosemirror.js";
import { requireConfirmation } from "../security/confirm.js";
import { logMutation } from "../logging/mutation-log.js";

export function registerCommentTools(server: McpServer, adapter: DocmostAdapter): void {
  server.registerTool(
    "create_comment",
    {
      description:
        "Cria um comentário de página no Docmost (não suporta comentário inline associado a um trecho de texto — o destaque/âncora depende da sessão colaborativa em tempo real do editor, fora do alcance da API HTTP). Exige confirmação explícita antes de executar.",
      inputSchema: {
        pageId: z.string(),
        text: z.string().describe("Texto do comentário (aceita a mesma sintaxe Markdown básica das páginas)."),
      },
    },
    async ({ pageId, text }) => {
      const confirmed = await requireConfirmation(server, {
        tool: "create_comment",
        target: `Página ${pageId}`,
        effect: `Isso vai CRIAR um comentário nesta página com o texto fornecido.`,
      });
      if (!confirmed) return cancelledResult();

      const res = await adapter.request("POST", "/api/comments/create", {
        pageId,
        // A API espera `content` como uma STRING JSON (validação @IsJSON no
        // servidor), não o objeto ProseMirror em si — precisa ser serializado.
        content: JSON.stringify(markdownToProseMirror(text)),
      });
      try {
        const data = await parseDocmostResponse(res, `Página '${pageId}' não encontrada.`);
        return jsonContent(data);
      } finally {
        await logMutation({ tool: "create_comment", target: { pageId }, status: res.status });
      }
    },
  );

  server.registerTool(
    "list_comments",
    {
      description: "Lista os comentários (não deletados) de uma página do Docmost.",
      inputSchema: {
        pageId: z.string(),
      },
    },
    async ({ pageId }) => {
      const res = await adapter.request("POST", "/api/comments/", { pageId });
      const data = await parseDocmostResponse(res, `Página '${pageId}' não encontrada.`);
      return jsonContent(data);
    },
  );

  // Não existe tool de "resolver comentário" — é feature Enterprise (EE) do
  // Docmost (a UI de resolver comentário no client vem de `@/ee/comment/...`);
  // o backend open-source não implementa o endpoint. Uma tool `resolve_comment`
  // existiu aqui e sempre retornava 403 num self-host sem licença EE. Não
  // reintroduza sem confirmar que a instância de destino tem licença EE.
}
