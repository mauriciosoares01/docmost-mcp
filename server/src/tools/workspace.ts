import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocmostAdapter } from "../docmost/adapter.js";
import { jsonContent, parseDocmostResponse } from "./shared.js";

export function registerWorkspaceTools(server: McpServer, adapter: DocmostAdapter): void {
  server.registerTool(
    "get_workspace_info",
    {
      description: "Metadados do workspace Docmost atual.",
    },
    async () => {
      const res = await adapter.request("POST", "/api/workspace/info");
      const data = await parseDocmostResponse(res);
      return jsonContent(data);
    },
  );
}
