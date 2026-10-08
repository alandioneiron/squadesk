# Manual do Squadesk · Sala dos Agentes

Guia completo para instalar, entender e usar o Squadesk em qualquer computador: Windows, macOS ou Linux.

**Convenção de caminhos.** Neste manual, `~` é a sua pasta pessoal:

| Sistema | `~` é |
|---|---|
| Windows | `C:\Users\<você>` |
| macOS | `/Users/<você>` |
| Linux | `/home/<você>` |

Assim, `~/.claude` é a pasta de configuração do Claude Code. No Windows ela fica em `C:\Users\<você>\.claude`.

## Índice

1. [O que é e como funciona](#1-o-que-é-e-como-funciona)
2. [Requisitos](#2-requisitos)
3. [Instalação](#3-instalação)
4. [Primeiros passos](#4-primeiros-passos)
5. [Recursos e como ativar cada um](#5-recursos-e-como-ativar-cada-um)
6. [Comandos /sala](#6-comandos-sala)
7. [O arquivo da equipe](#7-o-arquivo-da-equipe)
8. [Onde fica cada coisa](#8-onde-fica-cada-coisa)
9. [Atualizar e desinstalar](#9-atualizar-e-desinstalar)
10. [Solução de problemas](#10-solução-de-problemas)
11. [Privacidade e segurança](#11-privacidade-e-segurança)

---

## 1. O que é e como funciona

Quando você pede algo ao Claude Code, o modelo principal pode criar **subagentes** para fazer partes do trabalho. O Squadesk mostra esse trabalho como uma sala de escritório:
- o modelo principal é o **Tech Lead**;
- cada subagente senta na **mesa** do seu papel: Dev Backend, QA, Documentador e outros;
- em cada mesa você vê o que o agente está fazendo, quanto gastou, há quanto tempo está na tarefa e se espera sua aprovação.

O Squadesk tem quatro peças:

| Peça | O que é | Precisa de |
|---|---|---|
| **Plugin** | Roda dentro do Claude Code, observa os eventos do chat e desenha a sala no painel `/sala` | Só o Claude Code |
| **Arquivo da equipe** | `sala-agentes.json`: quais mesas existem, o modelo de cada uma e as palavras que puxam tarefas para ela | Opcional; sem ele vale uma equipe padrão |
| **Painel web** | Página que mostra as salas de **todos** os chats da máquina, para ver no PC, no celular ou numa TV da rede | Node 18+ |
| **Skill de instalação** | Instala tudo conversando com você: pergunta quantas mesas e o segmento de cada uma | Node 18+ |

**O caminho dos dados:**

```
Claude Code ──carrega──▶ plugin (pasta indicada em CLAUDE_CODE_PLUGIN_DIRS)
   │                         │
   │ eventos do chat         ├─▶ desenha a sala no painel /sala
   │ (pedido, ferramentas,   ├─▶ põe o guia da equipe no começo de cada conversa
   │  subagentes, aprovação) └─▶ grava um "retrato" do chat a cada 1,5 s em
   │                              ~/.claude/sala-agentes/live/<chat>.json
   │                                        │
   └────────────────────────────────────────┴──▶ painel web lê os retratos
                                                 e mostra todos os chats
```

Nada vai para a internet. O plugin só grava arquivos na sua pasta pessoal, e o painel web é um servidor local que você liga se quiser.

## 2. Requisitos

- **Claude Code** com suporte a plugins de *function hooks*. Vale a versão de terminal (CLI) e o app desktop, no Windows, no macOS ou no Linux. Use uma versão recente.
- **Node.js 18 ou mais novo**, só para o instalador e o painel web. O plugin em si não precisa de Node. Baixe em [nodejs.org](https://nodejs.org) a versão LTS. Para conferir: `node --version`.
- **Git**, opcional, para clonar o repositório.

## 3. Instalação

Escolha **um** dos três caminhos. Em todos, ao terminar, **abra um chat novo**: chats que já estavam abertos não carregam a sala.

### Opção A: com a skill, a instalação guiada

Recomendada para quem não quer mexer em arquivos.

1. Gere o pacote da skill a partir de um clone do repositório. Isso pede Node e Python 3:
   ```bash
   git clone https://github.com/alandioneiron/squadesk.git
   cd squadesk
   node scripts/gerar-skill.mjs
   ```
   O pacote sai em `dist/sala-agentes.skill`, que é um zip.
2. Instale a skill:
   - **Claude Code:** descompacte o `.skill` dentro de `~/.claude/skills/`. Deve ficar `~/.claude/skills/sala-agentes/SKILL.md`.
   - **claude.ai:** nas configurações, na área de Skills, envie o arquivo `.skill`.
3. Num chat, peça: **"instala a sala dos agentes"**.
4. A skill pergunta:
   - quantas mesas a equipe terá, de 1 a 11;
   - o tipo dos seus projetos;
   - se a equipe vale para a conta toda ou para um projeto;
   - se você quer o painel web;
   - por fim, o segmento de cada mesa. Ela já propõe uma lista com o modelo de cada mesa, e você só confirma ou troca.
5. A skill grava a equipe, instala o plugin e, se você pediu, liga o painel. No fim ela mostra o link do painel.

### Opção B: instalador pelo terminal

Para quem já tem o repositório clonado e quer uma linha só.

```bash
git clone https://github.com/alandioneiron/squadesk.git
cd squadesk
node skill/sala-agentes/scripts/instalar.mjs --painel
```

**Opções do instalador:**

| Opção | O que faz |
|---|---|
| *(nenhuma)* | Instala ou atualiza o plugin e as variáveis do `settings.json` |
| `--verificar` | Só mostra o estado: versão, variáveis, equipes, painel. Não muda nada |
| `--simular` | Mostra tudo o que faria, sem gravar |
| `--equipe arquivo.json` | Grava essa equipe (formato na [seção 7](#7-o-arquivo-da-equipe)) |
| `--onde conta` / `--onde projeto --projeto <pasta>` | Onde a equipe vale: em todos os projetos (padrão) ou só em um |
| `--substituir` | Troca uma equipe que já existe, guardando cópia `.bak` |
| `--painel` | Liga o painel web agora |
| `--iniciar-com-windows` | Com `--painel`, no Windows: o painel sobe sozinho ao entrar no Windows |
| `--porta N` | Porta do painel na primeira configuração (padrão 8787) |
| `--forcar` | Instala mesmo se a versão instalada for mais nova |
| `--desinstalar` | Remove o plugin, as variáveis, o atalho e o painel em execução. Equipes e configurações do painel ficam |
| `--ajuda` | Lista as opções |

**Códigos de saída:**
- `0`: deu certo;
- `1`: erro; a mensagem diz o que mudou e o que não mudou;
- `2`: precisa da sua confirmação, por exemplo quando já existe uma equipe diferente.

**O que o instalador faz:**
1. Copia o plugin para `~/.claude/mods/sala-agentes/`.
2. No `~/.claude/settings.json`, acrescenta as duas variáveis da Opção C, com uma cópia de segurança `settings.json.bak-sala-*` antes. O resto do arquivo não é tocado.
3. Se você passou `--equipe`, grava o arquivo da equipe.
4. Se você passou `--painel`, liga o painel e, com `--iniciar-com-windows`, cria o atalho na pasta Inicializar do Windows.
5. Valida o plugin com `claude plugin validate`, se o comando `claude` existir.

Ele nunca mexe em firewall nem em outras configurações de segurança.

### Opção C: à mão, sem Node

Instala só o plugin; o painel web precisa de Node.

**1. Copie a pasta `plugin/` do repositório para `~/.claude/mods/sala-agentes/`.**

- macOS e Linux:
  ```bash
  mkdir -p ~/.claude/mods
  cp -R plugin ~/.claude/mods/sala-agentes
  ```
- Windows (PowerShell):
  ```powershell
  New-Item -ItemType Directory -Force "$HOME\.claude\mods" | Out-Null
  Copy-Item -Recurse plugin "$HOME\.claude\mods\sala-agentes"
  ```

**2. Diga ao Claude Code para carregar essa pasta.** Abra `~/.claude/settings.json` (crie o arquivo se não existir). Dentro de `"env"`, acrescente as duas linhas abaixo, sem apagar o que já estiver lá. Use o caminho completo da sua pasta pessoal.

- Windows (barras invertidas dobradas no JSON):
  ```json
  {
    "env": {
      "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\<você>\\.claude\\mods\\sala-agentes",
      "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
    }
  }
  ```
- macOS:
  ```json
  { "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/Users/<você>/.claude/mods/sala-agentes", "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1" } }
  ```
- Linux:
  ```json
  { "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/home/<você>/.claude/mods/sala-agentes", "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1" } }
  ```

O que cada variável faz:
- `CLAUDE_CODE_PLUGIN_DIRS`: pastas de plugin que o Claude Code carrega em todo chat. Se já existir com outra pasta, junte as duas, separadas por `;` no Windows ou `:` no macOS/Linux.
- `CLAUDE_CODE_PLUGIN_DIR_WATCH`: `"1"` faz os chats abertos recarregarem o plugin sozinhos quando os arquivos dele mudam, por exemplo numa atualização.

**3. Opcional: crie a equipe.** Veja a [seção 7](#7-o-arquivo-da-equipe), ou deixe a equipe padrão e mude depois pelo `/sala mesa`.

### Conferir a instalação

1. Abra um **chat novo** no Claude Code.
2. A sala abre sozinha. Se não abrir, digite `/sala`.
3. O rodapé da sala mostra a versão do plugin e de onde veio a equipe.
4. Pelo terminal, `node skill/sala-agentes/scripts/instalar.mjs --verificar` mostra o estado completo.

## 4. Primeiros passos

1. Abra um chat novo num projeto seu. A sala aparece com o Tech Lead e as mesas livres.
2. Peça algo com várias partes. Exemplo: "crie a tela de cadastro, o endpoint que salva e os testes".
3. O Tech Lead planeja e cria subagentes. Cada um senta na sua mesa e mostra o que faz: lendo um arquivo, editando, rodando um comando.
4. Quando um agente precisa da sua aprovação, ele levanta a mão e aparece "aguardando você".
5. No fim, `/sala resumo` mostra quanto cada papel trabalhou no dia.

Você não precisa ensinar o modelo a usar a sala: o [guia automático](#57-guia-automático-de-delegação) cuida disso.

## 5. Recursos e como ativar cada um

Resumo:

| Recurso | Já vem ligado? | Como usar ou ligar |
|---|---|---|
| Sala no chat | Sim | Abre sozinha; `/sala` reabre |
| Equipe e mesas | Sim, a equipe padrão | `/sala equipe`, `/sala mesa`, arquivo JSON |
| Mesa certa para cada agente | Sim | Automático; ajuda escrever "Papel: tarefa" |
| Mesas extras | Sim | Automático |
| Papel temporário | Sim | Tarefa no formato "Novo Papel: tarefa" |
| Aviso de mudança de equipe | Sim | Automático |
| Guia automático de delegação | Sim | `/sala guia` mostra; `"orientar": false` desliga |
| Tokens, cronômetro e histórico | Sim | Automático |
| Aviso de aprovação | Sim | Automático (som só no Windows) |
| Resumo do dia | Sim | `/sala resumo` ou botão |
| Outros chats | Sim | Automático, na sala |
| Painel web | **Não** | Ligar o servidor (5.12) |
| Editor de mesas no painel | Sim, com o painel | Botão **Mesas**, no próprio PC |

### 5.1 Sala no chat

**O que é:** o desenho da equipe, com uma linha por agente e a lista de eventos.

**Como usar:**
- Abre sozinha quando o chat começa; se você fechar, `/sala` reabre.
- No app desktop ela fica num painel ao lado da conversa. Se não couber, alargue a janela.

**O que mostra, de cima para baixo:**
- **Desenho:** o Tech Lead e as mesas. A cor do personagem segue o modelo: dourado para Opus, laranja para Sonnet, verde-água para Haiku. O balão mostra a atividade. A linha tracejada liga quem delegou a quem recebeu.
- **Lista:** papel, modelo, atividade (pensando, lendo, editando, rodando comando, delegando, aguardando você, concluído), o arquivo ou comando atual, a tarefa, o cronômetro e os tokens. "Histórico" abre os últimos passos daquele agente.
- **Outros chats:** veja 5.11.
- **Hoje neste chat:** veja 5.10.
- **Eventos:** quem delegou o quê, quem concluiu, quem pediu aprovação.
- **Rodapé:** a versão do plugin e de onde veio a equipe. Se o arquivo da equipe tiver erro, o aviso aparece aqui.
- **Botões:** "Copiar resumo do dia", "Copiar link do painel" (com o painel ligado) e "Zerar sala", que limpa o desenho e os eventos deste chat.

Agentes concluídos saem da sala 15 s depois de terminar.

### 5.2 Equipe e mesas

**O que é:** a lista de mesas fixas. Cada mesa é um papel com nome, modelo e palavras-chave.

**Ligado por padrão:** sim. Sem arquivo, vale a equipe padrão: QA, Documentador, Dev Backend, Dev Frontend e Dev Infra.

**De onde vem a equipe**, nesta ordem:
1. `.claude/sala-agentes.json` do projeto, procurado na pasta atual e nas de cima, como o git faz. Abrir um chat numa subpasta não muda a equipe.
2. Senão, `~/.claude/sala-agentes.json`, que vale para todos os projetos sem arquivo próprio.
3. Senão, a equipe padrão.

**Como criar a equipe de um projeto:**
- `/sala equipe` cria `.claude/sala-agentes.json` com a equipe padrão, pronta para editar;
- ou `/sala mesa + …` cria o arquivo a partir da equipe em uso e já acrescenta a mesa;
- ou peça ao próprio modelo, por exemplo: "crie a equipe da sala deste projeto com 6 mesas: …".

O formato completo está na [seção 7](#7-o-arquivo-da-equipe).

### 5.3 Mesa certa para cada agente

**O que é:** a sala decide em que mesa cada subagente senta.

**Ligado por padrão:** sim. A ordem da escolha:
1. A descrição da tarefa começa com **"Papel: …"** (ex.: "Dev Backend: criar o login"): vai para essa mesa.
2. O nome ou um apelido da mesa aparece na descrição ou no começo do prompt (ex.: "Você é o QA…").
3. As palavras-chave da descrição, entre as mesas do mesmo modelo do agente.
4. A mesa menos ocupada desse modelo.

O guia automático (5.7) já ensina o modelo a escrever "Papel: tarefa", então normalmente você não precisa fazer nada.

### 5.4 Mesas extras

**O que é:** se dois agentes do mesmo papel trabalham ao mesmo tempo, o segundo senta numa mesa extra, abaixo da linha "MESAS EXTRAS", com o nome "Dev Backend 2". São até 9 extras.

**Ligado por padrão:** sim, é automático.

### 5.5 Papel temporário

**O que é:** uma mesa criada na hora para uma especialidade que a equipe não tem. Ela some quando o agente termina.

**Como usar:** a descrição da tarefa começa com o novo papel, por exemplo "QA Android: testar o login no app". O guia automático faz o modelo usar isso sozinho quando falta uma especialidade.

### 5.6 Mesas fixas: adicionar e tirar

**Pelo chat:**
```
/sala mesas
/sala mesa + Dev Mobile | Sonnet | android, ios, flutter | Mobile
/sala mesa - Dev Mobile
```
No `+`, os campos vão separados por `|`:
- nome;
- modelo: Opus, Sonnet, Haiku ou Fable;
- palavras-chave, separadas por vírgula;
- apelidos, opcional.

Se o projeto ainda não tem arquivo, ele é criado a partir da equipe em uso.

**Pelo painel web:** botão **Mesas** na sala escolhida (modo Lista). Só funciona no próprio computador; veja 5.12.

**À mão:** edite o `sala-agentes.json`.

**Aviso ao Tech Lead:** em qualquer dos três jeitos, a sala relê a equipe em até 10 s. Se uma mesa entrou, saiu ou trocou de modelo, o Tech Lead daquele chat recebe na conversa uma mensagem "[Sala dos Agentes] A equipe deste projeto mudou…" com a nova formação. Assim ele passa a delegar para as mesas novas.

O limite é de 11 mesas fixas.

### 5.7 Guia automático de delegação

**O que é:** no começo de cada conversa, e de novo depois de `/clear` ou de uma compactação, o plugin põe no contexto do modelo um bloco com as mesas do projeto e estas regras:
- **Pedido pequeno:** o modelo faz sozinho. Delegar custa mais tokens do que resolve.
- **Pedido com várias partes:** ele divide e delega às mesas desde o começo, e roda em paralelo o que é independente.
- **Formato:** cada tarefa vai como "Papel: tarefa", com o prompt "Você é o <Papel>…" e o modelo da mesa. Haiku cuida de documentação e conferência, Sonnet de código e QA ponta a ponta; o Opus fica com o Tech Lead.
- **Falta de especialidade:** ele cria um papel temporário ou, em projeto grande, uma mesa fixa.

**Ligado por padrão:** sim. Os subagentes não recebem o guia.

**Como ver:** `/sala guia` mostra o texto exato que o modelo recebe naquele projeto.

**Como desligar:** ponha `"orientar": false` no `sala-agentes.json`.
- No arquivo do projeto, desliga só naquele projeto.
- No `~/.claude/sala-agentes.json`, desliga nos projetos que não têm arquivo próprio.

### 5.8 Tokens, cronômetro e histórico

**Ligado por padrão:** sim, é automático.
- **Tokens:** gasto de cada agente (entrada nova, gravação de cache e saída), somado ao fim de cada turno. Aparece na mesa, na lista e no total do cabeçalho.
- **Cronômetro:** há quanto tempo o agente está na tarefa atual.
- **Histórico:** os últimos 30 passos de cada agente (operação e alvo). Fica em "histórico" na lista.

### 5.9 Aviso de aprovação

**O que é:** quando uma ferramenta de um agente espera a sua permissão, o personagem levanta a mão e fica laranja com "aguardando você", e o cabeçalho conta quantos esperam. Também aparece uma notificação no Claude Code e, **no Windows**, toca um som. No macOS e no Linux não há som. No painel web, a sala ganha borda laranja, e o modo TV para nela.

**Ligado por padrão:** sim, é automático. Quando você responde, o personagem volta ao trabalho.

### 5.10 Resumo do dia

**O que é:** por papel, quantas tarefas foram concluídas hoje neste chat, quanto tempo levaram e quantos tokens gastaram. Vem em Markdown, pronto para colar num relatório.

**Como usar:** `/sala resumo` ou o botão "Copiar resumo do dia". A seção "Hoje neste chat" da sala mostra o mesmo.

### 5.11 Outros chats

**O que é:** uma seção da sala com os outros chats abertos na mesma máquina: título, projeto, se estão trabalhando ou esperando você, e os tokens. Chats sem sinal há mais de 6 horas saem da lista.

**Ligado por padrão:** sim, é automático. Não precisa do painel web.

### 5.12 Painel web

**O que é:** uma página com as salas de **todos** os chats da máquina, ao vivo. Abre no navegador do próprio PC ou de qualquer aparelho da rede local, como celular ou TV.

**Ligado por padrão:** **não**. É um servidor Node que você liga.

**Ligar agora:**
```bash
node ~/.claude/mods/sala-agentes/web/server.mjs
```
No Windows (PowerShell), `node "$HOME\.claude\mods\sala-agentes\web\server.mjs"`. Pelo instalador, é a opção `--painel`. Se o painel já estiver no ar, a segunda cópia sai sozinha.

**O link de acesso:**
- Na primeira vez, o painel cria `~/.claude/sala-agentes/web.json` com a porta, uma **chave** aleatória e os links prontos (campo `urls`), um por endereço de rede da máquina.
- Os links também aparecem em `/sala painel` e no botão "Copiar link do painel".
- Abra o link completo, com `?t=<chave>`, uma vez em cada aparelho. O navegador guarda um cookie por 30 dias e a chave sai da barra de endereço.
- Sem a chave, o acesso é negado.

**Acessar de outro aparelho:**
- Use o link com o IP da rede local, como `http://192.168.0.10:8787/?t=…`. Se aparecerem vários IPs, os de adaptadores virtuais (WSL, Hyper-V, VPN) costumam não servir.
- Na primeira vez o sistema pode perguntar se o Node pode aceitar conexões da rede:
  - no Windows, "Redes privadas" basta;
  - no macOS, permita conexões de entrada;
  - no Linux com firewall, libere a porta, por exemplo `sudo ufw allow 8787/tcp`.

  A decisão é sua: o Squadesk não mexe no firewall. Sem liberar, só o próprio PC acessa (`localhost`).

**Modos de visualização** (seletor no topo; a escolha fica guardada no navegador):
- **Lista:** chats à esquerda e a sala escolhida grande à direita, com desenho, agentes, eventos e botão Mesas.
- **Mosaico:** estilo câmeras de segurança, com divisão Auto, 1, 4, 6, 9 ou 16, paginação e borda laranja em quem espera você. Clique numa tela para ver os detalhes.
- **TV:** um chat por vez, que troca sozinho a cada 5, 10, 20 ou 30 s e para em quem espera você. Tem letras grandes.

Para deixar um favorito pronto, use os parâmetros na URL: `?modo=lista|mosaico|tv&div=auto|1|4|6|9|16&tempo=5|10|20|30`. Exemplo para uma TV: `http://<ip>:8787/?t=<chave>&modo=tv&tempo=20`. Uma sala só fica em `/sala/<id-do-chat>`.

**Editor de mesas:**
- O botão **Mesas** na sala escolhida adiciona ou tira mesas fixas do projeto daquele chat.
- Só aparece abrindo o painel **no próprio computador**.
- Para liberar pela rede, ponha `"allowRemoteEdit": true` no `web.json`. Vale em até 5 s, sem reiniciar.

**Configurações no `~/.claude/sala-agentes/web.json`:**

| Campo | Padrão | Para quê |
|---|---|---|
| `port` | `8787` | Porta do painel. Reinicie o painel depois de mudar |
| `host` | `0.0.0.0` | `0.0.0.0` aceita a rede local; `127.0.0.1` deixa só o próprio PC |
| `token` | aleatório | A chave. Para trocar, apague a linha e reinicie: os links antigos deixam de valer |
| `allowRemoteEdit` | ausente (`false`) | `true` libera o editor de mesas pela rede |
| `urls` | gerado | Links prontos. O painel regrava este campo |

**Subir junto com o sistema:**
- **Windows:** rode o instalador com `--painel --iniciar-com-windows`. Ele cria um atalho oculto na pasta Inicializar (`shell:startup`).
- **macOS (launchd):** crie `~/Library/LaunchAgents/com.squadesk.painel.plist`. Troque o caminho do node pelo resultado de `which node` e `<você>` pelo seu usuário:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>Label</key><string>com.squadesk.painel</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/bin/node</string>
      <string>/Users/<você>/.claude/mods/sala-agentes/web/server.mjs</string>
    </array>
    <key>RunAtLoad</key><true/>
  </dict>
  </plist>
  ```
  Depois rode `launchctl load -w ~/Library/LaunchAgents/com.squadesk.painel.plist`.
- **Linux (systemd do usuário):** crie `~/.config/systemd/user/squadesk-painel.service`. Troque `/usr/bin/node` pelo resultado de `which node`:
  ```ini
  [Unit]
  Description=Painel web do Squadesk

  [Service]
  ExecStart=/usr/bin/node %h/.claude/mods/sala-agentes/web/server.mjs
  Restart=on-failure

  [Install]
  WantedBy=default.target
  ```
  Depois rode `systemctl --user enable --now squadesk-painel`.

**Desligar:**
- Encerre o processo `node` do `server.mjs`:
  - no Windows, pelo Gerenciador de Tarefas;
  - no macOS/Linux, `pkill -f sala-agentes/web/server.mjs`.
- Para não subir mais com o sistema:
  - no Windows, apague `sala-agentes-painel.vbs` de `shell:startup`;
  - no macOS, `launchctl unload -w <plist>`;
  - no Linux, `systemctl --user disable --now squadesk-painel`.

Os retratos de chats com mais de 24 horas são apagados pelo painel.

## 6. Comandos /sala

| Comando | O que faz |
|---|---|
| `/sala` | Abre a sala e relê a equipe |
| `/sala mesas` | Lista as mesas e mostra como adicionar e tirar |
| `/sala mesa + Nome \| Modelo \| palavra, palavra \| apelido` | Adiciona uma mesa fixa ao projeto |
| `/sala mesa - Nome` | Tira uma mesa fixa |
| `/sala equipe` | Cria `.claude/sala-agentes.json` no projeto com a equipe padrão |
| `/sala guia` | Mostra o guia que o modelo recebe neste projeto |
| `/sala resumo` | Resumo do dia deste chat, por papel |
| `/sala painel` | Links do painel web (precisa do painel já ter rodado uma vez) |

## 7. O arquivo da equipe

Nome: `sala-agentes.json`. Fica em `.claude/` do projeto (vale só nele) ou em `~/.claude/` (vale para todos os projetos sem arquivo próprio).

```json
{
  "lider": { "nome": "Tech Lead", "modelo": "Opus" },
  "orientar": true,
  "papeis": [
    { "nome": "Dev Backend", "modelo": "Sonnet", "palavras": ["back", "api", "endpoint", "servico", "auth"], "apelidos": ["Backend"] },
    { "nome": "Dev Frontend", "modelo": "Sonnet", "palavras": ["front", "react", "tela", "componente", "css"] },
    { "nome": "QA", "modelo": "Haiku", "palavras": ["qa", "test", "valid", "confer", "smoke"] },
    { "nome": "Documentador", "modelo": "Haiku", "palavras": ["documen", "readme", "changelog", "manual", "guia"] }
  ]
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `papeis` | sim | De 1 a 11 mesas, na ordem do desenho. As 2 primeiras ficam ao lado do líder |
| `papeis[].nome` | sim | Até 22 caracteres, único |
| `papeis[].modelo` | recomendado | `Opus`, `Sonnet`, `Haiku` ou `Fable`. Agentes desse modelo preferem esta mesa |
| `papeis[].palavras` | recomendado | Começos de palavra, em minúsculas e sem acento: `test` pega "testes" e "testar" |
| `papeis[].apelidos` | não | Outros nomes da mesa. Citar o nome ou um apelido manda o agente direto para ela |
| `lider` | não | Nome e modelo do líder (padrão: Tech Lead, Opus) |
| `orientar` | não | `false` desliga o guia automático |

Se o arquivo tiver erro, a sala usa a equipe padrão e mostra o motivo no rodapé.

O catálogo com 20 segmentos prontos (Dev Mobile, Segurança, Dados/BI, Redes, UX…) e equipes sugeridas por tipo de projeto está em [`skill/sala-agentes/references/mesas.md`](../skill/sala-agentes/references/mesas.md).

## 8. Onde fica cada coisa

| Caminho | O que é |
|---|---|
| `~/.claude/mods/sala-agentes/` | O plugin instalado |
| `~/.claude/settings.json` → `env` | As variáveis que carregam o plugin |
| `~/.claude/sala-agentes.json` | Equipe da conta (opcional) |
| `<projeto>/.claude/sala-agentes.json` | Equipe do projeto (opcional) |
| `~/.claude/sala-agentes/live/` | Retratos dos chats, lidos pelo painel e pela seção "Outros chats" |
| `~/.claude/sala-agentes/web.json` | Configuração e chave do painel web |
| `~/.claude/sala-agentes/instalacao.json` | Registro do instalador, usado para desinstalar |
| `~/.claude/sala-agentes/start-painel.vbs` | (Windows) Script que liga o painel oculto |

## 9. Atualizar e desinstalar

**Atualizar:** baixe a versão nova (`git pull`) e rode de novo o instalador ou a skill.
- A equipe atual fica, e o painel em execução é reiniciado se o código dele mudou.
- Os chats abertos recarregam o plugin sozinhos (graças ao `CLAUDE_CODE_PLUGIN_DIR_WATCH`).
- Na instalação à mão, copie a pasta `plugin/` de novo por cima.

**Desinstalar:**
```bash
node skill/sala-agentes/scripts/instalar.mjs --desinstalar
```
- **O que sai:** o plugin, as variáveis, o atalho de inicialização e o painel em execução.
- **O que fica:** as equipes, o `web.json` e os retratos. Apague à mão se quiser.
- **Instalação à mão:** apague `~/.claude/mods/sala-agentes` e as duas linhas do `settings.json`.

## 10. Solução de problemas

| Sintoma | O que fazer |
|---|---|
| A sala não aparece | Abra um **chat novo**: chats abertos antes da instalação não leem a variável. Se persistir, reinicie o app. Confira o `settings.json` com `instalar.mjs --verificar` e rode `claude plugin validate ~/.claude/mods/sala-agentes` |
| "A sala não coube" | Alargue a janela do Claude Code |
| Todos os agentes caem na mesma mesa | Dê palavras-chave às mesas, ou peça tarefas no formato "Papel: tarefa". Confira com `/sala guia` se o guia está ligado |
| A equipe não mudou | Confira se o projeto tem um `.claude/sala-agentes.json` próprio: ele vale no lugar do da conta. O rodapé da sala diz de onde veio a equipe |
| Rodapé com aviso de erro na equipe | O JSON está inválido ou uma regra foi quebrada; a mensagem diz qual. Corrija o arquivo: a sala relê em 10 s |
| `/sala painel` diz que o painel não está ligado | Ligue o servidor (5.12). O `web.json` só aparece depois da primeira execução |
| O painel não abre em outro aparelho | Use o IP da rede local, e não o `localhost`. Libere o Node no firewall. Confira se `host` não está `127.0.0.1` |
| "Acesso negado" no painel | Abra o link completo, com `?t=<chave>` |
| Porta 8787 ocupada | Mude `port` no `web.json` e reinicie, ou instale com `--porta N` |
| Sem som no aviso de aprovação | O som só existe no Windows; a notificação aparece em todos os sistemas |

## 11. Privacidade e segurança

- **O que fica local:** tudo. Não há servidor externo, conta nem telemetria.
- **O que aparece no painel:** os papéis, as atividades, os nomes de arquivos, os comandos e o andamento dos chats. O **texto dos seus pedidos não aparece**: nem no retrato, nem no painel.
- **A chave do painel:** o link carrega a chave. Compartilhe só com quem pode ver essas informações, e troque a chave quando quiser (5.12).
- **O editor de mesas:** só funciona no próprio PC, salvo `allowRemoteEdit`. Ele só grava `<projeto>/.claude/sala-agentes.json`.
- **Rede e firewall:** o instalador e o painel nunca mudam firewall ou outras configurações de segurança.
