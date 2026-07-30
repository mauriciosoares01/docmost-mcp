export interface ProseMirrorMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ProseMirrorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
  text?: string;
  marks?: ProseMirrorMark[];
}

export function proseMirrorToMarkdown(doc: ProseMirrorNode | null | undefined): string {
  if (!doc?.content?.length) return "";
  return `${blocksToMarkdown(doc.content)}\n`;
}

function blocksToMarkdown(nodes: ProseMirrorNode[]): string {
  return nodes
    .map((node) => blockToMarkdown(node))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function blockToMarkdown(node: ProseMirrorNode, depth = 0): string {
  switch (node.type) {
    case "paragraph":
      return inlineToMarkdown(node.content);

    case "heading": {
      const level = clamp(Number(node.attrs?.level ?? 1), 1, 6);
      return `${"#".repeat(level)} ${inlineToMarkdown(node.content)}`;
    }

    case "blockquote":
      return blocksToMarkdown(node.content ?? [])
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");

    case "horizontalRule":
      return "---";

    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const code = (node.content ?? []).map((c) => c.text ?? "").join("");
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }

    case "bulletList":
      return listToMarkdown(node.content ?? [], { ordered: false }, depth);
    case "orderedList":
      return listToMarkdown(node.content ?? [], { ordered: true }, depth);
    case "taskList":
      return listToMarkdown(node.content ?? [], { ordered: false, task: true }, depth);

    case "table":
      return tableToMarkdown(node);

    case "image":
      return imageToMarkdown(node);

    case "callout": {
      // Convenção do vault: :::tipo ... ::: (info | warning | success | danger).
      const calloutType = typeof node.attrs?.type === "string" ? node.attrs.type : "info";
      const inner = blocksToMarkdown(node.content ?? []);
      return `:::${calloutType}\n${inner}\n:::`;
    }

    case "details": {
      // Toggle/accordion do Tiptap — sem equivalente nativo em Markdown puro,
      // usa <details><summary> (HTML embutido, suportado por qualquer renderer GFM).
      const summaryNode = node.content?.find((c) => c.type === "detailsSummary");
      const contentNode = node.content?.find((c) => c.type === "detailsContent");
      const summary = summaryNode ? inlineToMarkdown(summaryNode.content) : "Detalhes";
      const inner = contentNode ? blocksToMarkdown(contentNode.content ?? []) : "";
      return `<details>\n<summary>${summary}</summary>\n\n${inner}\n\n</details>`;
    }

    default:
      // Nó de bloco desconhecido (ex. widgets nativos do Docmost como listagem
      // de subpáginas): preserva o JSON original de forma opaca em vez de só
      // "abrir" o conteúdo em markdown. Bug crítico corrigido: a versão anterior
      // descia recursivamente nos filhos e substituía o wrapper por um comentário
      // de texto solto — ao reconverter esse markdown de volta (replace/append),
      // o node original virava permanentemente um comentário morto, destruindo
      // o widget de verdade. Opaco = não editável pelo modelo, mas nunca perdido.
      return unsupportedPlaceholder(node);
  }
}

function listToMarkdown(
  items: ProseMirrorNode[],
  opts: { ordered: boolean; task?: boolean },
  depth: number,
): string {
  return items.map((item, index) => listItemToMarkdown(item, opts, index, depth)).join("\n");
}

function listItemToMarkdown(
  item: ProseMirrorNode,
  opts: { ordered: boolean; task?: boolean },
  index: number,
  depth: number,
): string {
  const indent = "  ".repeat(depth);
  const marker = opts.task
    ? `- [${item.attrs?.checked ? "x" : " "}] `
    : opts.ordered
      ? `${index + 1}. `
      : "- ";

  const children = item.content ?? [];
  const nestedListTypes = new Set(["bulletList", "orderedList", "taskList"]);
  const lines: string[] = [];
  let firstLineWritten = false;

  for (const child of children) {
    if (nestedListTypes.has(child.type)) {
      const nestedOpts = { ordered: child.type === "orderedList", task: child.type === "taskList" };
      lines.push(listToMarkdown(child.content ?? [], nestedOpts, depth + 1));
      continue;
    }

    const text = blockToMarkdown(child, depth);
    if (!firstLineWritten) {
      lines.push(`${indent}${marker}${text}`);
      firstLineWritten = true;
    } else {
      // Conteúdo adicional dentro do mesmo item (ex. segundo parágrafo) — indenta.
      lines.push(
        text
          .split("\n")
          .map((line) => `${indent}  ${line}`)
          .join("\n"),
      );
    }
  }

  return lines.join("\n");
}

function tableToMarkdown(node: ProseMirrorNode): string {
  const rows = (node.content ?? []).filter((row) => row.type === "tableRow");
  if (rows.length === 0) return "";

  const rowCells = rows.map((row) => (row.content ?? []).map((cell) => tableCellToMarkdown(cell)));
  const [headerRow, ...bodyRows] = rowCells;
  const columnCount = headerRow.length;

  const headerLine = `| ${headerRow.join(" | ")} |`;
  const dividerLine = `| ${Array(columnCount).fill("---").join(" | ")} |`;
  const bodyLines = bodyRows.map((cells) => `| ${cells.join(" | ")} |`);

  return [headerLine, dividerLine, ...bodyLines].join("\n");
}

function tableCellToMarkdown(cell: ProseMirrorNode): string {
  // Tabelas Markdown não suportam quebra de bloco dentro da célula — achata
  // parágrafos/linhas em uma única linha, escapando "|" literais.
  const text = (cell.content ?? []).map((block) => inlineToMarkdown(block.content)).join(" ");
  return text.replace(/\|/g, "\\|").trim();
}

function imageToMarkdown(node: ProseMirrorNode): string {
  // src é relativo à instância Docmost (endpoint autenticado de arquivos) —
  // resolver para URL absoluta/baixar a imagem está fora do escopo desta etapa.
  const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
  const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
  return `![${alt}](${src})`;
}

function inlineToMarkdown(nodes: ProseMirrorNode[] | undefined): string {
  if (!nodes?.length) return "";
  return nodes
    .map((node) => {
      if (node.type === "text") return applyMarks(node.text ?? "", node.marks);
      if (node.type === "hardBreak") return "  \n";
      if (node.type === "image") return imageToMarkdown(node);
      return unsupportedPlaceholder(node);
    })
    .join("");
}

function applyMarks(text: string, marks: ProseMirrorMark[] | undefined): string {
  if (!marks?.length) return text;
  const hasMark = (type: string) => marks.some((m) => m.type === type);

  let result = text;
  if (hasMark("code")) result = `\`${result}\``;
  if (hasMark("italic")) result = `_${result}_`;
  if (hasMark("bold")) result = `**${result}**`;
  if (hasMark("strike")) result = `~~${result}~~`;

  const link = marks.find((m) => m.type === "link");
  const href = link?.attrs?.href;
  if (typeof href === "string" && href.length > 0) {
    result = `[${result}](${href})`;
  }

  return result;
}

// Marcador opaco e reversível para nós de tipo desconhecido (ver comentários
// em blockToMarkdown/inlineToMarkdown). Base64 evita que texto/attrs do node
// original contenham "-->" e fechem o comentário prematuramente.
function unsupportedPlaceholder(node: ProseMirrorNode): string {
  return `<!-- docmost-mcp:raw:${Buffer.from(JSON.stringify(node), "utf8").toString("base64")} -->`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// ---------------------------------------------------------------------------
// Markdown -> ProseMirror (etapa 08)
//
// Cobre o mesmo conjunto de nós/marks da direção inversa (acima), reaproveitando
// as mesmas convenções de formatação já fixadas pelo conversor forward — em
// especial o indentador fixo de 2 espaços por nível de lista (item aninhado ou
// continuação de parágrafo), já que é exatamente o que `listItemToMarkdown`
// produz. Não é um parser CommonMark completo: o objetivo é fazer o roundtrip
// fiel do que o próprio `proseMirrorToMarkdown` gera (e de Markdown escrito à
// mão nesse mesmo subconjunto), não parsear qualquer Markdown arbitrário.
// ---------------------------------------------------------------------------

type ListKind = "bullet" | "ordered" | "task";

interface Cursor {
  lines: string[];
  pos: number;
}

// Espelha unsupportedPlaceholder(): decodifica de volta o node original opaco,
// em vez de recriar um placeholder de texto (isso é o que corrige a perda de
// conteúdo em replace/append sobre páginas com widgets nativos do Docmost).
const RAW_NODE_PATTERN = "<!-- docmost-mcp:raw:([A-Za-z0-9+/=]+) -->";
const RAW_NODE_LINE_RE = new RegExp(`^${RAW_NODE_PATTERN}\\s*$`);
const RAW_NODE_PREFIX_RE = new RegExp(`^${RAW_NODE_PATTERN}`);

function decodeRawNode(match: RegExpMatchArray): ProseMirrorNode | null {
  try {
    return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function markdownToProseMirror(md: string): ProseMirrorNode {
  const cursor: Cursor = { lines: md.replace(/\r\n/g, "\n").split("\n"), pos: 0 };
  return { type: "doc", content: parseBlocks(cursor, 0) };
}

function peekLine(cursor: Cursor): string | undefined {
  return cursor.lines[cursor.pos];
}

function isEof(cursor: Cursor): boolean {
  return cursor.pos >= cursor.lines.length;
}

function lineIndent(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

function parseBlocks(cursor: Cursor, indent: number): ProseMirrorNode[] {
  const blocks: ProseMirrorNode[] = [];

  while (!isEof(cursor)) {
    const raw = peekLine(cursor)!;
    if (raw.trim() === "") {
      cursor.pos++;
      continue;
    }
    if (lineIndent(raw) < indent) break;
    const line = raw.slice(indent);

    const rawNodeMatch = line.match(RAW_NODE_LINE_RE);
    const rawNode = rawNodeMatch && decodeRawNode(rawNodeMatch);

    if (rawNode) {
      blocks.push(rawNode);
      cursor.pos++;
    } else if (/^```/.test(line)) {
      blocks.push(parseCodeBlock(cursor, indent));
    } else if (/^:::\w+\s*$/.test(line)) {
      blocks.push(parseCallout(cursor, indent));
    } else if (/^<details>/.test(line)) {
      blocks.push(parseDetails(cursor, indent));
    } else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "horizontalRule" });
      cursor.pos++;
    } else if (/^#{1,6}\s+/.test(line)) {
      blocks.push(parseHeading(line));
      cursor.pos++;
    } else if (/^>\s?/.test(line)) {
      blocks.push(parseBlockquote(cursor, indent));
    } else if (looksLikeTableStart(cursor, indent)) {
      blocks.push(parseTable(cursor, indent));
    } else if (isListItemLine(line)) {
      blocks.push(parseList(cursor, indent));
    } else if (/^!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) {
      blocks.push(parseImageBlock(line));
      cursor.pos++;
    } else {
      blocks.push(parseParagraph(cursor, indent));
    }
  }

  return blocks;
}

function isBlockStart(line: string): boolean {
  return (
    RAW_NODE_LINE_RE.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^>\s?/.test(line) ||
    /^```/.test(line) ||
    /^:::\w+\s*$/.test(line) ||
    /^<details>/.test(line) ||
    isListItemLine(line) ||
    /^\|.*\|\s*$/.test(line) ||
    /^!\[[^\]]*\]\([^)]*\)\s*$/.test(line)
  );
}

function parseHeading(line: string): ProseMirrorNode {
  const match = line.match(/^(#{1,6})\s+(.*)$/)!;
  return { type: "heading", attrs: { level: match[1].length }, content: parseInline(match[2]) };
}

function parseImageBlock(line: string): ProseMirrorNode {
  const match = line.match(/^!\[([^\]]*)\]\(([^)]*)\)\s*$/)!;
  return { type: "image", attrs: { alt: match[1], src: match[2] } };
}

function parseCodeBlock(cursor: Cursor, indent: number): ProseMirrorNode {
  const language = peekLine(cursor)!.slice(indent).replace(/^```/, "").trim();
  cursor.pos++;

  const codeLines: string[] = [];
  while (!isEof(cursor)) {
    const raw = peekLine(cursor)!;
    const line = lineIndent(raw) >= indent ? raw.slice(indent) : raw;
    cursor.pos++;
    if (/^```\s*$/.test(line)) break;
    codeLines.push(line);
  }

  const code = codeLines.join("\n");
  const node: ProseMirrorNode = { type: "codeBlock", content: code ? [{ type: "text", text: code }] : [] };
  if (language) node.attrs = { language };
  return node;
}

function parseCallout(cursor: Cursor, indent: number): ProseMirrorNode {
  const calloutType = peekLine(cursor)!.slice(indent).match(/^:::(\w+)/)![1];
  cursor.pos++;

  const inner: string[] = [];
  while (!isEof(cursor)) {
    const raw = peekLine(cursor)!;
    const line = lineIndent(raw) >= indent ? raw.slice(indent) : raw;
    cursor.pos++;
    if (line.trim() === ":::") break;
    inner.push(line);
  }

  return {
    type: "callout",
    attrs: { type: calloutType },
    content: parseBlocks({ lines: inner, pos: 0 }, 0),
  };
}

function parseDetails(cursor: Cursor, indent: number): ProseMirrorNode {
  cursor.pos++; // consome <details>

  let summary = "Detalhes";
  const summaryRaw = peekLine(cursor);
  if (summaryRaw !== undefined) {
    const match = summaryRaw.slice(indent).match(/^<summary>(.*)<\/summary>\s*$/);
    if (match) {
      summary = match[1];
      cursor.pos++;
    }
  }

  while (!isEof(cursor) && peekLine(cursor)!.trim() === "") cursor.pos++;

  const inner: string[] = [];
  while (!isEof(cursor)) {
    const raw = peekLine(cursor)!;
    const line = lineIndent(raw) >= indent ? raw.slice(indent) : raw;
    cursor.pos++;
    if (line.trim() === "</details>") break;
    inner.push(line);
  }
  while (inner.length && inner[inner.length - 1].trim() === "") inner.pop();

  return {
    type: "details",
    content: [
      { type: "detailsSummary", content: parseInline(summary) },
      { type: "detailsContent", content: parseBlocks({ lines: inner, pos: 0 }, 0) },
    ],
  };
}

function parseBlockquote(cursor: Cursor, indent: number): ProseMirrorNode {
  const inner: string[] = [];
  while (!isEof(cursor)) {
    const raw = peekLine(cursor)!;
    if (lineIndent(raw) < indent) break;
    const line = raw.slice(indent);
    if (!/^>/.test(line)) break;
    inner.push(line.replace(/^>\s?/, ""));
    cursor.pos++;
  }
  return { type: "blockquote", content: parseBlocks({ lines: inner, pos: 0 }, 0) };
}

function looksLikeTableStart(cursor: Cursor, indent: number): boolean {
  const header = cursor.lines[cursor.pos]?.slice(indent);
  const divider = cursor.lines[cursor.pos + 1]?.slice(indent);
  if (header === undefined || divider === undefined) return false;
  if (!header.trim().startsWith("|")) return false;
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(divider.trim());
}

function parseTable(cursor: Cursor, indent: number): ProseMirrorNode {
  const rows: string[][] = [splitTableRow(peekLine(cursor)!.slice(indent))];
  cursor.pos += 2; // header + linha divisora (alinhamento não é modelado)

  while (!isEof(cursor)) {
    const raw = peekLine(cursor)!;
    if (lineIndent(raw) < indent) break;
    const line = raw.slice(indent);
    if (!line.trim().startsWith("|")) break;
    rows.push(splitTableRow(line));
    cursor.pos++;
  }

  return {
    type: "table",
    content: rows.map((cells) => ({
      type: "tableRow",
      content: cells.map((cellText) => ({
        type: "tableCell",
        content: cellText ? [{ type: "paragraph", content: parseInline(cellText) }] : [],
      })),
    })),
  };
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i++;
      continue;
    }
    if (trimmed[i] === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += trimmed[i];
  }
  cells.push(current.trim());
  return cells;
}

function isListItemLine(line: string): boolean {
  return /^[-*]\s+\[[ xX]\]\s/.test(line) || /^[-*]\s/.test(line) || /^\d+\.\s/.test(line);
}

function detectListKind(line: string): ListKind {
  if (/^[-*]\s+\[[ xX]\]\s/.test(line)) return "task";
  if (/^\d+\.\s/.test(line)) return "ordered";
  return "bullet";
}

function parseList(cursor: Cursor, indent: number): ProseMirrorNode {
  const kind = detectListKind(peekLine(cursor)!.slice(indent));
  const items: ProseMirrorNode[] = [];

  while (!isEof(cursor)) {
    const raw = peekLine(cursor)!;

    if (raw.trim() === "") {
      const after = cursor.lines[cursor.pos + 1];
      const continues =
        after !== undefined &&
        lineIndent(after) >= indent &&
        isListItemLine(after.slice(indent)) &&
        detectListKind(after.slice(indent)) === kind;
      if (!continues) break;
      cursor.pos++;
      continue;
    }

    if (lineIndent(raw) < indent) break;
    const line = raw.slice(indent);
    if (!isListItemLine(line) || detectListKind(line) !== kind) break;

    items.push(parseListItem(cursor, indent, kind));
  }

  const type = kind === "ordered" ? "orderedList" : kind === "task" ? "taskList" : "bulletList";
  return { type, content: items };
}

function parseListItem(cursor: Cursor, indent: number, kind: ListKind): ProseMirrorNode {
  const line = peekLine(cursor)!.slice(indent);
  let rest: string;
  let checked = false;

  if (kind === "task") {
    const match = line.match(/^[-*]\s+\[([ xX])\]\s?(.*)$/)!;
    checked = match[1].toLowerCase() === "x";
    rest = match[2];
  } else if (kind === "ordered") {
    rest = line.match(/^\d+\.\s?(.*)$/)![1];
  } else {
    rest = line.match(/^[-*]\s?(.*)$/)![1];
  }
  cursor.pos++;

  const childIndent = indent + 2;
  const contentLines: string[] = [rest];
  while (!isEof(cursor)) {
    const next = peekLine(cursor)!;
    if (next.trim() === "") {
      const after = cursor.lines[cursor.pos + 1];
      if (after === undefined || lineIndent(after) < childIndent) break;
      contentLines.push("");
      cursor.pos++;
      continue;
    }
    if (lineIndent(next) < childIndent) break;
    contentLines.push(next.slice(childIndent));
    cursor.pos++;
  }

  const blocks = parseBlocks({ lines: contentLines, pos: 0 }, 0);
  // taskList do Docmost usa a extensão TaskItem do Tiptap (@tiptap/extension-list),
  // cujo nó tem tipo "taskItem" — distinto de "listItem" usado por bullet/ordered.
  // Emitir "listItem" com attrs.checked (como antes) produz um nó que o schema do
  // editor não reconhece como item de checklist.
  const node: ProseMirrorNode = {
    type: kind === "task" ? "taskItem" : "listItem",
    content: blocks.length ? blocks : [{ type: "paragraph", content: [] }],
  };
  if (kind === "task") node.attrs = { checked };
  return node;
}

function parseParagraph(cursor: Cursor, indent: number): ProseMirrorNode {
  const rawLines: string[] = [];
  while (!isEof(cursor)) {
    const raw = peekLine(cursor)!;
    if (raw.trim() === "" || lineIndent(raw) < indent) break;
    const line = raw.slice(indent);
    if (isBlockStart(line)) break;
    rawLines.push(line);
    cursor.pos++;
  }
  return { type: "paragraph", content: parseInline(joinParagraphLines(rawLines)) };
}

function joinParagraphLines(lines: string[]): string {
  return lines
    .map((line, idx) => {
      const trimmedEnd = line.replace(/\s+$/, "");
      if (idx === lines.length - 1) return trimmedEnd;
      return / {2,}$/.test(line) ? `${trimmedEnd}  \n` : `${trimmedEnd} `;
    })
    .join("");
}

// Marcador de hard break preservado literalmente por joinParagraphLines ("  \n"),
// igual ao que proseMirrorToMarkdown produz — serve de delimitador de segmentos.
function parseInline(text: string): ProseMirrorNode[] {
  const segments = text.split("  \n");
  const nodes: ProseMirrorNode[] = [];
  segments.forEach((segment, idx) => {
    nodes.push(...parseInlineSegment(segment));
    if (idx < segments.length - 1) nodes.push({ type: "hardBreak" });
  });
  return nodes;
}

function parseInlineSegment(text: string): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  let plain = "";
  let i = 0;

  const flushPlain = () => {
    if (plain) {
      nodes.push({ type: "text", text: plain });
      plain = "";
    }
  };

  while (i < text.length) {
    const token = tryConsumeInlineToken(text.slice(i));
    if (token) {
      flushPlain();
      nodes.push(...token.nodes);
      i += token.length;
      continue;
    }
    plain += text[i];
    i++;
  }

  flushPlain();
  return nodes;
}

const EMPHASIS_MARKERS: Array<{ marker: string; mark: ProseMirrorMark }> = [
  { marker: "~~", mark: { type: "strike" } },
  { marker: "**", mark: { type: "bold" } },
  { marker: "_", mark: { type: "italic" } },
];

function tryConsumeInlineToken(rest: string): { nodes: ProseMirrorNode[]; length: number } | null {
  const rawNodeMatch = rest.match(RAW_NODE_PREFIX_RE);
  if (rawNodeMatch) {
    const decoded = decodeRawNode(rawNodeMatch);
    if (decoded) return { nodes: [decoded], length: rawNodeMatch[0].length };
  }

  const image = rest.match(/^!\[([^\]]*)\]\(([^)]*)\)/);
  if (image) {
    return { nodes: [{ type: "image", attrs: { alt: image[1], src: image[2] } }], length: image[0].length };
  }

  if (rest.startsWith("`")) {
    const close = rest.indexOf("`", 1);
    if (close !== -1) {
      return {
        nodes: [{ type: "text", text: rest.slice(1, close), marks: [{ type: "code" }] }],
        length: close + 1,
      };
    }
  }

  for (const { marker, mark } of EMPHASIS_MARKERS) {
    if (rest.startsWith(marker)) {
      const close = rest.indexOf(marker, marker.length);
      if (close !== -1) {
        const inner = rest.slice(marker.length, close);
        return { nodes: addMark(parseInlineSegment(inner), mark), length: close + marker.length };
      }
    }
  }

  const link = rest.match(/^\[([^\]]*)\]\(([^)]*)\)/);
  if (link) {
    return {
      nodes: addMark(parseInlineSegment(link[1]), { type: "link", attrs: { href: link[2] } }),
      length: link[0].length,
    };
  }

  return null;
}

function addMark(nodes: ProseMirrorNode[], mark: ProseMirrorMark): ProseMirrorNode[] {
  return nodes.map((node) => (node.type === "text" ? { ...node, marks: [...(node.marks ?? []), mark] } : node));
}
