import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocmostAdapter } from "../docmost/adapter.js";
import { jsonContent, parseDocmostResponse } from "./shared.js";

export function registerSpaceTools(server: McpServer, adapter: DocmostAdapter): void {
  server.registerTool(
    "list_spaces",
    {
      description: "Lista os spaces do Docmost visíveis para o usuário autenticado.",
    },
    async () => {
      const res = await adapter.request("POST", "/api/spaces");
      const data = await parseDocmostResponse(res);
      return jsonContent(data);
    },
  );

  server.registerTool(
    "get_space",
    {
      description: "Detalhes de um space do Docmost pelo ID.",
      inputSchema: {
        spaceId: z.string(),
      },
    },
    async ({ spaceId }) => {
      const res = await adapter.request("POST", "/api/spaces/info", { spaceId });
      const data = await parseDocmostResponse(res, `Space '${spaceId}' não encontrado.`);
      return jsonContent(data);
    },
  );
}
