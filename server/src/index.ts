import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DocmostAdapter } from "./docmost/adapter.js";
import { registerSpaceTools } from "./tools/spaces.js";
import { registerWorkspaceTools } from "./tools/workspace.js";
import { registerPageTools } from "./tools/pages.js";
import { registerSearchTools } from "./tools/search.js";
import { registerCommentTools } from "./tools/comments.js";
import { runGarbageCollection } from "./logging/gc.js";

const baseUrl = process.env.DOCMOST_BASE_URL;
if (!baseUrl) {
  console.error("DOCMOST_BASE_URL não configurado (defina no .mcp.json ou no ambiente).");
  process.exit(1);
}

const adapter = new DocmostAdapter(baseUrl);

// GC do log de mutações (etapa 11, §5.1) — best-effort, nunca lança.
await runGarbageCollection();

const server = new McpServer({
  name: "docmost-mcp",
  version: "1.0.0",
});

server.registerTool(
  "ping",
  {
    description: "Tool de teste do scaffold — confirma que o MCP server docmost está no ar.",
  },
  async () => {
    const payload = { status: "ok", timestamp: new Date().toISOString() };
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    };
  },
);

registerSpaceTools(server, adapter);
registerWorkspaceTools(server, adapter);
registerPageTools(server, adapter);
registerSearchTools(server, adapter);
registerCommentTools(server, adapter);

const transport = new StdioServerTransport();
await server.connect(transport);
