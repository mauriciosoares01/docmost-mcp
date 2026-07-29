---
name: docmost
description: Consulta e edita páginas, spaces e comentários de um Docmost self-hosted via MCP — leitura (buscar, listar, ler páginas) e escrita (criar, editar, mover, duplicar, apagar páginas, comentar), sempre com confirmação explícita antes de qualquer mutação. Use sempre que o usuário pedir para consultar, buscar, criar, editar, mover, duplicar, apagar uma página no Docmost/wiki, ou comentar em uma página. Gatilhos: "busca a página X no Docmost", "cria uma página no wiki sobre Y", "atualiza a doc Z", "o que tem na página W", "lista os spaces do Docmost", "comenta em X", "move a página X para dentro de Y", "duplica essa página", "apaga a página X".
user-invocable: false
---

# Docmost — MCP de leitura e escrita

Servidor MCP local (`docmost-mcp`) que fala com um Docmost self-hosted pela API interna (a mesma que o frontend usa), autenticado com e-mail/senha próprios do usuário. **Toda operação roda com a identidade e as permissões do usuário logado** — o MCP não impõe restrição própria; o que ele consegue ler/escrever é exatamente o que o RBAC do Docmost já concede à conta dele.

## Setup (uma vez, por máquina/pessoa)

Antes de qualquer tool funcionar, o usuário precisa logar:

```
node server/bin/cli.js login
```

Pede base URL do Docmost, e-mail e senha, e grava no cofre nativo do SO (libsecret/Keychain/Credential Manager, com fallback cifrado se não houver cofre disponível). Nunca peça a senha diretamente no chat — sempre direcione para esse comando no terminal.

## Tools disponíveis

**Leitura (sem confirmação, sem efeito colateral):**

| Tool | Uso |
|:--|:--|
| `list_spaces` / `get_space` | Listar/detalhar spaces visíveis ao usuário |
| `get_workspace_info` | Metadados do workspace |
| `get_recent_pages` | Páginas recentes do usuário |
| `list_pages` | Árvore de páginas de um space (metadados de navegação) |
| `get_page` | Conteúdo de uma página, convertido para Markdown |
| `search` | Busca full-text |
| `list_comments` | Comentários (não deletados) de uma página |

**Escrita (sempre pede confirmação explícita antes de executar — descreve alvo e efeito, e só segue com "sim"):**

| Tool | Uso |
|:--|:--|
| `create_page` | Cria página a partir de Markdown |
| `update_page` | Edita página — modo `replace`/`append`/`prepend`. Em append/prepend, o `markdown` passado deve ser **só o trecho novo**, nunca o conteúdo já existente (o merge com o que já está na página é automático) |
| `move_page` | Move/reposiciona na hierarquia, inclusive entre spaces |
| `duplicate_page` | Duplica página (título + conteúdo) |
| `delete_page` | Remove página — **irreversível**, confirmação reforçada |
| `create_comment` | Comenta em uma página |

## Comportamento de confirmação

Toda tool de escrita dispara um prompt de confirmação (via `elicitInput`) descrevendo o alvo e o efeito antes de chamar o Docmost. **Nunca tente contornar isso** nem simule a confirmação — é o usuário quem decide. Se ele recusar, a operação é cancelada sem nenhuma chamada de rede. `delete_page` reforça a mensagem, deixando explícito que é irreversível.

Permissão insuficiente no Docmost vira um erro `403` legível — nunca tente contornar tentando outro endpoint ou credencial.

## Fluxo recomendado para editar uma página existente

1. `get_page` para ler o conteúdo atual em Markdown.
2. Editar o trecho relevante.
3. `update_page`:
   - Se a edição é pontual (adicionar algo ao final/início), use `append`/`prepend` com **só o trecho novo**.
   - Se é uma reescrita ampla, use `replace` com o Markdown completo.
4. Nunca reenvie o conteúdo já existente dentro do `markdown` em modo `append`/`prepend` — duplica o conteúdo.

## Limitações conhecidas (não oferecer implementar)

- **Comentário inline/associado a um trecho de texto:** `create_comment` só cria comentários de página. O destaque visual de um comentário sobre um trecho específico depende de uma âncora no documento colaborativo em tempo real (Yjs, via WebSocket) — algo que a API HTTP do Docmost usada por este MCP não tem acesso. Uma tentativa anterior de simular isso (guardando só o texto selecionado como metadado, sem a âncora real) criou comentários que não aparecem de forma confiável para o usuário. **Não reintroduza `selection`/`type: "inline"` em `create_comment` a não ser que o usuário peça explicitamente e esteja ciente dessa limitação.**

- **Resolver comentário (não existe tool para isso):** "Resolver comentário" é uma feature **Enterprise (EE)** do Docmost — no código-fonte do client, o componente que faz isso vem de `@/ee/comment/components/resolve-comment`, e o backend open-source não implementa o endpoint correspondente. Uma tool `resolve_comment` chegou a existir neste MCP e sempre retornava 403 num self-host sem licença EE (testado e confirmado). Ela foi **removida**. **Não crie uma tool de resolver comentário a não ser que o usuário confirme explicitamente que a instância de destino tem licença Docmost EE.**

- **Nós de conteúdo não modelados** (ex. widgets nativos do Docmost como listagem de subpáginas) viram um marcador opaco no Markdown (`<!-- docmost-mcp:raw:... -->`) — preservado intacto em qualquer edição, mas não editável pelo modelo. Não tente "abrir" ou reescrever esse marcador; trate como um bloco opaco.
