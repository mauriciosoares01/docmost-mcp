# docmost-mcp

![docmost-mcp](assets/header.png)

Plugin + servidor MCP local para **Docmost self-hosted** — dá ao Claude Code tools de leitura e escrita (spaces, páginas, comentários) usando a API interna do Docmost (a mesma que o frontend usa), autenticado com **e-mail e senha próprios de cada pessoa**.

> **Modelo de autorização:** este MCP não define permissões próprias. Toda operação roda com a identidade de quem fez login — o que você consegue ler ou escrever é exatamente o que o seu papel/permissões já concedem no Docmost. Escritas exigem **confirmação explícita** antes de executar (ver [Segurança](#segurança-e-privacidade)).

**Versão validada:** `docmost-mcp 1.1.0` testado contra **Docmost v0.80.2** (self-hosted). A API interna usada aqui não é versionada oficialmente pelo Docmost — se você estiver numa versão bem diferente, valide os endpoints antes de confiar em escrita (ver [Compatibilidade](#compatibilidade)).

## Instalação

### Via marketplace (recomendado)

```
/plugin marketplace add mauriciosoares01/docmost-mcp
/plugin install docmost-mcp
```

Na primeira execução, o servidor instala as dependências e compila automaticamente (`server/bin/start.js`) — não precisa rodar `npm install`/`npm run build` manualmente nesse caminho.

### Via clone manual

```
git clone https://github.com/mauriciosoares01/docmost-mcp.git
cd docmost-mcp/server
npm install
npm run build
```

Depois registre o servidor no Claude Code (escopo do projeto onde você quer usar as tools):

```
claude mcp add docmost --scope local -- node /caminho/completo/para/docmost-mcp/server/dist/index.js
```

## Pré-requisitos por sistema operacional

As credenciais vão para o **cofre nativo do SO** via [`@napi-rs/keyring`](https://github.com/napi-rs/keyring-node):

| SO | Backend usado | Pré-requisito |
|:--|:--|:--|
| Linux | Secret Service API (GNOME Keyring / KWallet) | pacote `libsecret` instalado + `gnome-keyring` ou `kwallet` ativo (padrão em GNOME/KDE) |
| macOS | Keychain | Nenhum — nativo |
| Windows | Credential Manager | Nenhum — nativo |

Sem cofre nativo disponível (ex. servidor Linux headless), o plugin cai automaticamente para um **fallback cifrado em arquivo** (AES-256-GCM, `0600`) — nunca em plaintext.

## Setup (uma vez, por máquina/pessoa)

Na primeira vez que o Claude Code conectar ao plugin sem credenciais salvas, o próprio servidor MCP pede a base URL, e-mail e senha via um formulário interativo (elicitation) — nada para rodar manualmente antes. **Aviso:** esse formulário é do host (Claude Code), não do terminal, e não mascara a senha na tela (o protocolo MCP não tem campo de senha dedicado); evite compartilhar tela nesse momento. Depois de enviado, a senha é gravada no cofre nativo do SO (ou no fallback cifrado) e nunca fica em texto plano em disco.

Alternativa (mascarada, via terminal), útil para configurar antes de qualquer conexão ou trocar de conta:

```
node server/bin/cli.js login
```

Pede a base URL do Docmost, e-mail e senha, e grava no cofre (ou no fallback cifrado). A senha nunca é ecoada no terminal nem fica em nenhum arquivo do repositório.

Nos dois casos, depois disso o Claude Code já tem acesso às tools do Docmost com as permissões da sua conta — não é mais necessário configurar `DOCMOST_BASE_URL` como variável de ambiente.

## Tools disponíveis

Ver [`skills/docmost/SKILL.md`](skills/docmost/SKILL.md) para a lista completa, os gatilhos de uso, e o comportamento de confirmação antes de escritas. Resumo:

- **Leitura:** `list_spaces`, `get_space`, `get_workspace_info`, `get_recent_pages`, `list_pages`, `get_page`, `search`, `list_comments`.
- **Escrita** (sempre com confirmação explícita): `create_page`, `update_page`, `move_page`, `duplicate_page`, `delete_page`, `create_comment`.

## Segurança e privacidade

- **Nunca** commite credenciais, `.env` com segredos, ou o arquivo de fallback cifrado (`~/.config/docmost-mcp/credentials` no Linux/macOS, `%APPDATA%\docmost-mcp\credentials` no Windows) — já cobertos pelo `.gitignore`, mas confira antes de abrir PR.
- A senha só é usada para obter um JWT via `POST /api/auth/login`; o JWT fica cacheado em memória do processo do MCP, nunca em disco.
- Logs (stderr do processo) registram só endpoint, status HTTP e latência — nunca corpo de requisição/resposta, senha ou JWT.
- Mutações (criar/editar/mover/duplicar/apagar/comentar) geram uma linha num log local JSONL (`~/.local/state/docmost-mcp/mutations.jsonl` no Linux, `~/Library/Logs/docmost-mcp/` no macOS, `%LOCALAPPDATA%\docmost-mcp\logs\` no Windows) — só metadados (ferramenta, alvo, status), nunca conteúdo. Esse log rotaciona automaticamente (5 MB) e expira em 30 dias, configurável via `DOCMOST_MCP_LOG_MAX_SIZE_MB` / `DOCMOST_MCP_LOG_MAX_AGE_DAYS` / `DOCMOST_MCP_LOG_MAX_FILES`.
- Toda escrita pede confirmação explícita antes de executar — o modelo nunca muta o Docmost silenciosamente.

## Compatibilidade

A API interna do Docmost usada por este plugin **não é versionada oficialmente** — os endpoints foram validados manualmente contra a versão listada no topo deste README. Se a sua instância for de uma versão muito diferente, alguns payloads podem não bater; nesse caso, os erros retornados pelo Docmost são repassados de forma legível (nunca um "500 genérico" sem contexto) para facilitar o diagnóstico.

Recursos que dependem de **licença Enterprise (EE)** do Docmost (ex. resolver comentário) não estão disponíveis neste plugin — ele fala só com a API do backend open-source.

## Reportar bugs / contribuir

Abra uma issue em `https://github.com/mauriciosoares01/docmost-mcp/issues` descrevendo: tool usada, payload (sem credenciais), erro completo retornado, e a versão do Docmost testada.

## Licença

[MIT](LICENSE).
