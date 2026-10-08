# Formato do retrato de cada chat (v1)

Cada chat com a Sala dos Agentes grava, a cada ~1,5 s quando algo muda (e a cada minuto mesmo sem mudança, para o painel saber que o chat segue aberto), um arquivo:

`~/.claude/sala-agentes/live/<sessionId>.json`

Quem grava: o plugin (`hooks/register.tsx`). Quem lê: o painel web (`web/server.mjs`) e o próprio plugin (seção "Outros chats").
Todos os textos são dados não confiáveis para HTML: sempre escapar; o `svg` só vai para a página como `<img src="data:image/svg+xml,...">` (nunca inline, para nada nele executar).

```ts
type Snapshot = {
  v: 1
  id: string              // id da sessão (nome do arquivo sem .json)
  title: string           // título do chat (o da barra lateral do app); '' até existir
  project: string         // nome da pasta do projeto (basename do cwd)
  cwd: string             // pasta do projeto (caminho absoluto); o editor de mesas grava em <cwd>\.claude\sala-agentes.json
  startedAt: number       // ms epoch: quando a sala carregou neste chat
  updatedAt: number       // ms epoch: última gravação
  ended: boolean          // true quando o chat foi encerrado
  version: string         // versão do plugin (plugin.json)
  team: {
    lead: string          // nome do líder
    leadModel: string     // modelo do líder ('' se não definido)
    source: string        // caminho do arquivo da equipe em uso, ou "padrão"
    roles: { name: string; model: string; keywords?: string[]; aliases?: string[] }[]  // keywords/aliases: o painel trata a falta como []
  }
  svg: string             // desenho da sala, SVG completo (viewBox 760 x altura variável)
  busy: number            // agentes trabalhando agora
  waiting: number         // agentes aguardando aprovação do usuário
  tokens: number          // tokens do chat até agora (soma dos agentes)
  agents: {
    key: string           // id estável da linha
    title: string         // "Tech Lead", "Dev Backend 2", "QA Android"
    model: string         // "Opus" | "Sonnet" | "Haiku" | "Fable" | ""
    activity: string      // livre|ocioso|pensando|lendo|editando|comando|delegando|aprovacao|concluido
    label: string         // rótulo pronto em português ("editando", "aguardando você")
    color: string         // cor do status, #RRGGBB
    detail: string        // o que toca agora: arquivo, comando, busca
    task: string          // a tarefa recebida ('' no Tech Lead: o texto do pedido do usuário não sai do PC)
    taskStart: number     // ms epoch do início da tarefa atual; 0 = sem tarefa
    tokens: number        // tokens deste agente (atualiza ao fim de cada turno dele)
    temp: boolean         // papel temporário (não está no arquivo da equipe)
    trail: { op: string; what: string }[]  // histórico: op = leu|editou|rodou|buscou|abriu; mais recente por último
  }[]
  log: { at: number; text: string }[]   // últimos eventos, mais recente por último (sem o texto dos pedidos)
  daily: { date: string; roles: { role: string; tasks: number; ms: number; tokens: number }[] }  // resumo do dia deste chat; date = YYYY-MM-DD
}
```

Configuração do painel (gravada pelo servidor, lida pelo plugin para mostrar o link):

`%USERPROFILE%\.claude\sala-agentes\web.json` → `{ "port": 8787, "host": "0.0.0.0", "token": "<aleatório>", "urls": ["http://192.168.x.y:8787/?t=<token>", ...] }`

## API do painel

`GET /api/salas` → `{ serverNow: number, canEdit: boolean, salas: Snapshot[] }`. `canEdit` diz se **quem pediu** pode usar o editor de mesas (loopback, ou `"allowRemoteEdit": true` no `web.json`).

### Editor de mesas: `POST /api/equipe`

Única rota que escreve. Adiciona ou tira um papel fixo da equipe do projeto daquele chat.

```json
{ "id": "<id do retrato>", "acao": "adicionar" | "remover", "papel": { "nome": "Dev Mobile", "modelo": "Sonnet", "palavras": ["android", "app"], "apelidos": ["Mobile"] } }
```

- `remover` só usa `papel.nome`. `modelo`: Opus, Sonnet, Haiku, Fable ou vazio. `nome`: 1 a 22 caracteres, único (sem diferenciar maiúsculas/acentos). Equipe: 1 a 11 papéis.
- Alvo: `<cwd>\.claude\sala-agentes.json` (`{ "_como_usar": [], "lider": { "nome", "modelo" }, "papeis": [ { "nome", "modelo", "palavras": [], "apelidos": [] } ] }`). Se não existir, é criado a partir de `team` do retrato. Campos desconhecidos do arquivo são preservados; a gravação é atômica (temporário na mesma pasta + rename), JSON com 2 espaços.
- Resposta: `{ "ok": true, "papeis": ["nome", ...] }` ou `{ "ok": false, "erro": "mensagem" }` com status 400 (pedido inválido, 12º papel, remover o último), 403 (segurança), 404 (chat, pasta ou papel inexistente), 409 (nome duplicado ou arquivo da equipe ilegível).
- Segurança, além do token: só loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) a menos que `web.json` tenha `"allowRemoteEdit": true`; cabeçalho `X-Sala-Edit: 1` e `Content-Type: application/json`; se vier `Origin`, o host dele tem que ser o do `Host`; corpo de até 8 KB; nunca escreve fora de `<cwd>\.claude\` (recusa `.claude` que seja atalho ou junção).
- Quem consome: o plugin relê o arquivo da equipe a cada ~10 s e avisa o Tech Lead da nova formação no turno seguinte.
