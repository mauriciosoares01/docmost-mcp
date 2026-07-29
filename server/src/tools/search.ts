import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocmostAdapter } from "../docmost/adapter.js";
import { jsonContent, parseDocmostResponse } from "./shared.js";

export function registerSearchTools(server: McpServer, adapter: DocmostAdapter): void {
  server.registerTool(
    "search",
    {
      description: "Busca full-text no Docmost, respeitando os spaces visíveis ao usuário autenticado.",
      inputSchema: {
        query: z.string(),
        spaceId: z.string().optional(),
      },
    },
    async ({ query, spaceId }) => {
      const res = await adapter.request("POST", "/api/search", spaceId ? { query, spaceId } : { query });
      const data = await parseDocmostResponse(res);
      return jsonContent(data);
    },
  );
}
