import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DocmostAdapter } from "../docmost/adapter.js";
import { cancelledResult, jsonContent, parseDocmostResponse } from "./shared.js";
import { markdownToProseMirror, proseMirrorToMarkdown, type ProseMirrorNode } from "../convert/prosemirror.js";
import { requireConfirmation } from "../security/confirm.js";
import { generateJitteredKeyBetween } from "fractional-indexing-jittered";
import { logMutation } from "../logging/mutation-log.js";

interface DocmostPage {
  title: string;
  content: ProseMirrorNode;
  spaceId: string;
  space?: { name?: string };
  parentPageId: string | null;
  updatedAt: string;
}

interface SidebarPageItem {
  id: string;
  title: string;
  position: string;
  parentPageId: string | null;
  hasChildren: boolean;
}

interface PageTreeItem {
  id: string;
  title: string;
  parentPageId: string | null;
  path: string[];
}

export function registerPageTools(server: McpServer, adapter: DocmostAdapter): void {
  server.registerTool(
    "get_recent_pages",
    {
      description: "Lista as páginas recentes do usuário autenticado no Docmost.",
    },
    async () => {
      const res = await adapter.request("POST", "/api/pages/recent");
      const data = await parseDocmostResponse(res);
      return jsonContent(data);
    },
  );

  server.registerTool(
    "get_page",
    {
      description: "Conteúdo de uma página do Docmost, convertido de ProseMirror para Markdown.",
      inputSchema: {
        pageId: z.string(),
      },
    },
    async ({ pageId }) => {
      const res = await adapter.request("POST", "/api/pages/info", { pageId });
      const body = (await parseDocmostResponse(res, `Página '${pageId}' não encontrada.`)) as { data: DocmostPage };
      const page = body.data;

      return jsonContent({
        title: page.title,
        spaceId: page.spaceId,
        space: page.space?.name,
        parentPageId: page.parentPageId,
        updatedAt: page.updatedAt,
        markdown: proseMirrorToMarkdown(page.content),
      });
    },
  );

  server.registerTool(
    "list_pages",
    {
      description:
        "Árvore de páginas de um space do Docmost (id, título, página-pai, caminho de breadcrumb) — só metadados de navegação, sem conteúdo. Use get_page para o conteúdo de uma página específica.",
      inputSchema: {
        spaceId: z.string(),
      },
    },
    async ({ spaceId }) => {
      const pages = await buildPageTree(adapter, spaceId);
      return jsonContent({ spaceId, pages });
    },
  );

  server.registerTool(
    "create_page",
    {
      description:
        "Cria uma página no Docmost a partir de Markdown (convertido para ProseMirror). Exige confirmação explícita antes de executar.",
      inputSchema: {
        spaceId: z.string(),
        title: z.string(),
        markdown: z.string(),
        parentPageId: z.string().optional().describe("Id da página-pai, para criar como subpágina. Omitir cria na raiz do space."),
      },
    },
    async ({ spaceId, title, markdown, parentPageId }) => {
      const confirmed = await requireConfirmation(server, {
        tool: "create_page",
        target: `Space ${spaceId}${parentPageId ? `, sob a página ${parentPageId}` : ""}`,
        effect: `Isso vai CRIAR a página "${title}" no Docmost com o conteúdo Markdown fornecido.`,
      });
      if (!confirmed) return cancelledResult();

      const res = await adapter.request("POST", "/api/pages/create", {
        spaceId,
        title,
        content: markdownToProseMirror(markdown),
        format: "json",
        parentPageId: parentPageId ?? null,
      });
      try {
        const data = await parseDocmostResponse(res);
        return jsonContent(data);
      } finally {
        await logMutation({
          tool: "create_page",
          target: { spaceId, parentPageId: parentPageId ?? null, title },
          status: res.status,
        });
      }
    },
  );

  server.registerTool(
    "update_page",
    {
      description:
        "Edita o conteúdo de uma página do Docmost a partir de Markdown, no modo replace/append/prepend. " +
        "Em append/prepend, o parâmetro markdown deve conter APENAS o trecho a adicionar (o conteúdo já " +
        "existente é buscado e preservado automaticamente) — nunca reenvie o conteúdo atual da página junto, " +
        "ou ele fica duplicado. Só use replace com o Markdown completo da página. Exige confirmação explícita antes de executar.",
      inputSchema: {
        pageId: z.string(),
        markdown: z
          .string()
          .describe(
            "Em append/prepend: só o trecho novo a adicionar, sem repetir o conteúdo já existente na página. Em replace: o Markdown completo que vai substituir a página.",
          ),
        mode: z.enum(["replace", "append", "prepend"]),
      },
    },
    async ({ pageId, markdown, mode }) => {
      const modeEffect: Record<typeof mode, string> = {
        replace: "SUBSTITUIR todo o conteúdo atual pelo Markdown fornecido",
        append: "ADICIONAR o Markdown fornecido ao final do conteúdo atual (o conteúdo atual é preservado automaticamente, não deve estar repetido no Markdown fornecido)",
        prepend: "ADICIONAR o Markdown fornecido ao início do conteúdo atual (o conteúdo atual é preservado automaticamente, não deve estar repetido no Markdown fornecido)",
      };
      const confirmed = await requireConfirmation(server, {
        tool: "update_page",
        target: `Página ${pageId}`,
        effect: `Isso vai ${modeEffect[mode]} (modo: ${mode}).`,
      });
      if (!confirmed) return cancelledResult();

      const content =
        mode === "replace"
          ? markdownToProseMirror(markdown)
          : await mergeWithExistingContent(adapter, pageId, markdownToProseMirror(markdown), mode);

      // O merge de append/prepend já é feito no cliente (mergeWithExistingContent),
      // então `content` aqui já é o doc final completo. A API exige o campo
      // `operation`, mas sempre enviamos "replace": se mandássemos "append"/"prepend"
      // o servidor aplicaria o merge de novo sobre um conteúdo que já foi mesclado,
      // duplicando o resultado (bug real encontrado na validação da etapa 08).
      const res = await adapter.request("POST", "/api/pages/update", {
        pageId,
        content,
        format: "json",
        operation: "replace",
      });
      try {
        const data = await parseDocmostResponse(res, `Página '${pageId}' não encontrada.`);
        return jsonContent(data);
      } finally {
        await logMutation({ tool: "update_page", target: { pageId }, mode, status: res.status });
      }
    },
  );

  server.registerTool(
    "move_page",
    {
      description:
        "Move/reposiciona uma página na hierarquia do Docmost, inclusive entre spaces diferentes. Omitir parentPageId mantém o pai atual e só reordena a posição. Exige confirmação explícita antes de executar.",
      inputSchema: {
        pageId: z.string(),
        parentPageId: z
          .string()
          .nullable()
          .optional()
          .describe("Novo pai da página (pode ser de outro space). Omitir mantém o pai atual. Passe null para mover para a raiz do space."),
        position: z
          .string()
          .optional()
          .describe("Índice fracionário de posição entre os irmãos. Omitir coloca a página como última entre os irmãos do novo pai."),
      },
    },
    async ({ pageId, parentPageId, position }) => {
      const source = await getPageLocation(adapter, pageId);
      const target = parentPageId ? await getPageLocation(adapter, parentPageId) : null;
      const targetSpaceId = target ? target.spaceId : source.spaceId;
      const crossSpace = targetSpaceId !== source.spaceId;
      const effectiveParentPageId = parentPageId !== undefined ? parentPageId : source.parentPageId;

      const confirmed = await requireConfirmation(server, {
        tool: "move_page",
        target: `Página ${pageId}`,
        effect: [
          crossSpace ? `Isso vai MOVER a página para o space ${targetSpaceId}` : "Isso vai REPOSICIONAR a página",
          effectiveParentPageId ? ` dentro da página ${effectiveParentPageId}` : (crossSpace ? " (raiz do space)" : ""),
          position ? ` (posição: ${position})` : "",
          ".",
        ].join(""),
      });
      if (!confirmed) return cancelledResult();

      // Mover entre spaces é uma operação separada no Docmost — ela sempre reseta a
      // página para a raiz do space de destino, então o reparenting (se pedido)
      // precisa de uma segunda chamada a /api/pages/move já dentro do mesmo space.
      // Uma única linha de log cobre a chamada da tool inteira, mesmo quando ela
      // dispara duas requisições HTTP internamente (status = a última recebida).
      let status = 0;
      try {
        if (crossSpace) {
          const moveRes = await adapter.request("POST", "/api/pages/move-to-space", { pageId, spaceId: targetSpaceId });
          status = moveRes.status;
          await parseDocmostResponse(moveRes, `Página '${pageId}' não encontrada.`);
        }

        const resolvedPosition =
          position ?? (await nextSiblingPosition(adapter, targetSpaceId, effectiveParentPageId));

        const res = await adapter.request("POST", "/api/pages/move", {
          pageId,
          parentPageId: effectiveParentPageId,
          position: resolvedPosition,
        });
        status = res.status;
        const data = await parseDocmostResponse(res, `Página '${pageId}' não encontrada.`);
        return jsonContent(data);
      } finally {
        await logMutation({
          tool: "move_page",
          target: { pageId, parentPageId: effectiveParentPageId, crossSpace, spaceId: targetSpaceId },
          status,
        });
      }
    },
  );

  server.registerTool(
    "duplicate_page",
    {
      description: "Duplica uma página do Docmost (título + conteúdo). Exige confirmação explícita antes de executar.",
      inputSchema: {
        pageId: z.string(),
      },
    },
    async ({ pageId }) => {
      const confirmed = await requireConfirmation(server, {
        tool: "duplicate_page",
        target: `Página ${pageId}`,
        effect: "Isso vai CRIAR uma cópia completa desta página (mesmo título e conteúdo) no Docmost.",
      });
      if (!confirmed) return cancelledResult();

      const res = await adapter.request("POST", "/api/pages/duplicate", { pageId });
      try {
        const data = await parseDocmostResponse(res, `Página '${pageId}' não encontrada.`);
        return jsonContent(data);
      } finally {
        await logMutation({ tool: "duplicate_page", target: { pageId }, status: res.status });
      }
    },
  );

  server.registerTool(
    "delete_page",
    {
      description: "Remove uma página do Docmost. Ação IRREVERSÍVEL. Exige confirmação explícita reforçada antes de executar.",
      inputSchema: {
        pageId: z.string(),
      },
    },
    async ({ pageId }) => {
      const infoRes = await adapter.request("POST", "/api/pages/info", { pageId });
      const info = (await parseDocmostResponse(infoRes, `Página '${pageId}' não encontrada.`)) as { data: DocmostPage };

      const confirmed = await requireConfirmation(server, {
        tool: "delete_page",
        target: `Página "${info.data.title}" (${pageId})`,
        effect: `Isso vai APAGAR PERMANENTEMENTE a página "${info.data.title}" no Docmost. Essa ação é IRREVERSÍVEL — não há como desfazer ou recuperar o conteúdo depois.`,
      });
      if (!confirmed) return cancelledResult();

      const res = await adapter.request("POST", "/api/pages/delete", { pageId });
      try {
        const data = await parseDocmostResponse(res, `Página '${pageId}' não encontrada.`);
        return jsonContent(data);
      } finally {
        await logMutation({ tool: "delete_page", target: { pageId, title: info.data.title }, status: res.status });
      }
    },
  );
}

async function mergeWithExistingContent(
  adapter: DocmostAdapter,
  pageId: string,
  incoming: ProseMirrorNode,
  mode: "append" | "prepend",
): Promise<ProseMirrorNode> {
  const res = await adapter.request("POST", "/api/pages/info", { pageId });
  const body = (await parseDocmostResponse(res, `Página '${pageId}' não encontrada.`)) as { data: DocmostPage };
  const existing = body.data.content?.content ?? [];
  const incomingBlocks = incoming.content ?? [];

  return {
    type: "doc",
    content: mode === "append" ? [...existing, ...incomingBlocks] : [...incomingBlocks, ...existing],
  };
}

async function getPageLocation(
  adapter: DocmostAdapter,
  pageId: string,
): Promise<{ spaceId: string; parentPageId: string | null }> {
  const res = await adapter.request("POST", "/api/pages/info", { pageId });
  const body = (await parseDocmostResponse(res, `Página '${pageId}' não encontrada.`)) as { data: DocmostPage };
  return { spaceId: body.data.spaceId, parentPageId: body.data.parentPageId };
}

// O Docmost exige um "position" (índice fracionário, 5-12 chars) em toda chamada
// a /api/pages/move — não há um valor default tipo "last". Para colocar a página
// como última entre os irmãos, buscamos a posição do último irmão existente (a
// listagem de sidebar-pages já vem ordenada por position) e geramos a próxima
// chave com o mesmo algoritmo que o Docmost usa internamente.
async function nextSiblingPosition(
  adapter: DocmostAdapter,
  spaceId: string,
  parentPageId: string | null,
): Promise<string> {
  const siblings = await fetchSidebarChildren(adapter, spaceId, parentPageId ?? undefined);
  const lastPosition = siblings.length > 0 ? siblings[siblings.length - 1].position : null;
  return generateJitteredKeyBetween(lastPosition, null);
}

async function buildPageTree(
  adapter: DocmostAdapter,
  spaceId: string,
  pageId?: string,
  ancestorPath: string[] = [],
): Promise<PageTreeItem[]> {
  const children = await fetchSidebarChildren(adapter, spaceId, pageId);
  const result: PageTreeItem[] = [];

  for (const child of children) {
    const path = [...ancestorPath, child.title];
    result.push({ id: child.id, title: child.title, parentPageId: child.parentPageId, path });

    if (child.hasChildren) {
      const nested = await buildPageTree(adapter, spaceId, child.id, path);
      result.push(...nested);
    }
  }

  return result;
}

async function fetchSidebarChildren(
  adapter: DocmostAdapter,
  spaceId: string,
  pageId: string | undefined,
): Promise<SidebarPageItem[]> {
  const items: SidebarPageItem[] = [];
  let page = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await adapter.request("POST", "/api/pages/sidebar-pages", {
      spaceId,
      pageId,
      page,
      limit: 100,
    });
    const body = (await parseDocmostResponse(res)) as { data: { items: SidebarPageItem[]; meta: { hasNextPage: boolean } } };
    items.push(...body.data.items);

    if (!body.data.meta.hasNextPage) break;
    page++;
  }

  return items;
}
