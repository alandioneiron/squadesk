---
name: sala-agentes
description: Instala, atualiza e configura a Squadesk (Sala dos Agentes) no Claude Code — o painel /sala que mostra o Tech Lead e cada subagente na mesa do seu papel (atividade, tokens, cronômetro, aprovações), com painel web na rede e um guia automático que faz o modelo delegar às mesas sozinho. Na instalação pergunta primeiro quantas mesas a equipe terá e o segmento de cada uma, e grava a equipe. Use sempre que o usuário quiser instalar, reinstalar, atualizar, verificar ou remover a Sala dos Agentes; montar, ampliar ou trocar a equipe de mesas/agentes (quantidade, especialidade, modelo); ligar o painel web; ou entender como o Tech Lead e os Devs devem usar as mesas — mesmo que fale só em "squadesk", "sala", "mesas", "equipe de agentes", "/sala" ou "painel dos agentes".
compatibility: Claude Code (CLI ou app desktop) com plugins de function hooks. Node 18+ para o instalador e o painel web. Windows recomendado (atalho de inicialização do painel); macOS/Linux funcionam sem o atalho.
---

# Squadesk · Sala dos Agentes

A Sala dos Agentes é um plugin do Claude Code com três partes:

| Parte | O que faz | Onde fica |
|---|---|---|
| Plugin | Painel `/sala` com o Tech Lead e os subagentes nas mesas; guia automático de delegação no começo de cada conversa | `~/.claude/mods/sala-agentes/`, carregado pela variável `CLAUDE_CODE_PLUGIN_DIRS` do `~/.claude/settings.json` |
| Equipe | As mesas: nome, modelo e palavras que puxam tarefas para cada uma | `~/.claude/sala-agentes.json` (toda a conta) ou `<projeto>/.claude/sala-agentes.json` (um projeto) |
| Painel web (opcional) | Página com as salas de todos os chats, para ver no PC, no celular ou na TV da rede | `~/.claude/sala-agentes/` (link e chave no `web.json`) |

Nos comandos abaixo, `<SKILL_DIR>` é a pasta desta skill: a "Base directory" mostrada quando ela carregou. Os arquivos do plugin estão em `<SKILL_DIR>/assets/plugin/` e o instalador é `<SKILL_DIR>/scripts/instalar.mjs`.

## 1. Ver o estado

```bash
node "<SKILL_DIR>/scripts/instalar.mjs" --verificar --projeto "<pasta atual>"
```

O comando mostra a versão instalada e a do pacote, as variáveis, as equipes encontradas e o painel. Resuma ao usuário em 2 ou 3 linhas.
- Sem `node`: veja **Sem Node** no fim.
- Se a sala já está instalada e o pedido é só mudar a equipe, vá para **5. Mudar a equipe**.
- Se aparecer **equipe do projeto**, avise: ela vale neste projeto no lugar da equipe da conta. Uma equipe nova gravada na conta não muda este projeto.

## 2. Perguntas iniciais

Faça estas perguntas antes de gravar qualquer coisa. A sala só ajuda quando as mesas espelham o trabalho do projeto: uma equipe genérica faz os agentes caírem em mesas erradas e o modelo delegar pior. Se o usuário já respondeu alguma delas no pedido, não repita: só confirme.

**Rodada 1.** Use a ferramenta de perguntas (AskUserQuestion) se existir. Se não existir, faça uma mensagem só, com as perguntas numeradas.

1. **Quantas mesas a equipe vai ter, além do Tech Lead?**
   - **5 mesas (Recomendado):** o tamanho certo para a maioria dos projetos.
   - **3 mesas:** projetos pequenos.
   - **7 mesas:** projetos grandes, com QA ponta a ponta e revisão de código.
   - O usuário pode digitar outro número, de 1 a 11, na opção livre que a ferramenta já oferece. Não crie uma opção "Outro".

   Quais mesas entram é decidido pelo tipo de projeto e pela rodada 2, não por esta pergunta.
2. **Qual o tipo principal dos projetos?**
   - Opções: Sistema web, App mobile, Infraestrutura/redes, Dados/automação; Outro.
   - Serve para propor os segmentos.
   - Pule esta pergunta se a pasta atual deixa o tipo claro (`package.json`, `*.csproj`, `docker-compose.yml`, `pubspec.yaml`…).
3. **Onde a equipe vale?**
   - Todos os projetos desta conta (Recomendado).
   - Só este projeto (`<pasta>`).
4. **Ligar o painel web na rede?**
   - Sim, e iniciar com o Windows (Recomendado).
   - Sim, só agora.
   - Não.

**Rodada 2: o segmento de cada mesa.** Esta pergunta é aberta, então faça no chat. Monte a proposta pela regra **"Montar a proposta"** de `references/mesas.md` §5: as N primeiras mesas da linha do tipo de projeto, completadas e com QA garantido. Depois pergunte assim (exemplo de sistema web com 5 mesas):

> Qual o segmento de cada mesa? Minha proposta:
> 1. Dev Backend (Sonnet): APIs, banco, regras de negócio
> 2. Dev Frontend (Sonnet): telas, layout, componentes
> 3. Banco de Dados (Sonnet): tabelas, consultas, migrações
> 4. QA (Haiku): testes e conferência
> 5. QA E2E (Sonnet): testes ponta a ponta no navegador
>
> Responda "ok" ou diga o que trocar (ex.: "3 = Dev Infra", "5 = Documentador", "tira o Banco de Dados").

Se o usuário trocar algo, mostre a lista final numa linha (ex.: "Fica: Dev Mobile, Dev Backend, UX/UI Design, Segurança") e siga, sem pedir outro "ok".

O modelo de cada mesa segue a regra de `references/mesas.md`:
- **Haiku:** documentação, conferência e testes simples;
- **Sonnet:** código, depuração, QA ponta a ponta e revisão;
- **Opus:** só para uma mesa de arquitetura.

Mostre o modelo na proposta, para o usuário poder trocar. Se ele citar um segmento fora do catálogo, crie a mesa pela descrição dele.

## 3. Montar e instalar

1. **Montar o JSON** da equipe conforme `references/mesas.md`:
   - `lider` = Tech Lead (Opus), salvo outro pedido;
   - em cada mesa: `nome` (até 22 caracteres), `modelo`, `palavras` (5 a 12 começos de palavra, minúsculas e sem acento, em português e em inglês) e `apelidos` se ajudarem;
   - as duas mesas mais usadas vêm primeiro, porque ficam ao lado do líder.

   Grave num arquivo temporário (a pasta de rascunho da sessão ou a pasta temporária do sistema), não no destino: quem valida e grava é o instalador.

2. **Dizer em uma linha o que vai mudar:**
   - pasta do plugin;
   - variável no `settings.json` (o instalador guarda uma cópia antes);
   - arquivo da equipe;
   - painel e atalho de inicialização, se pedidos.

   Depois rode:

   ```bash
   node "<SKILL_DIR>/scripts/instalar.mjs" --equipe "<tmp>/sala-agentes.json" --onde conta --painel --iniciar-com-windows
   ```

   Variações:
   - **Só um projeto:** `--onde projeto --projeto "<pasta>"`. Com `--onde conta` não passe `--projeto`, ou o instalador recusa (código 1).
   - **Painel só agora:** só `--painel`.
   - **Sem painel:** tire as duas opções do painel.
   - **Outra porta:** `--porta N`, se a 8787 estiver ocupada (outro programa ou outra conta do Windows com o painel). Só vale na primeira vez; depois, mude `port` no `web.json`.
   - **Prévia sem gravar:** `--simular`.

3. **Ler o código de saída:**
   - **0, deu certo:** siga para a etapa 4.
   - **2, precisa de confirmação:** já existe uma equipe diferente no destino, ou a versão instalada é mais nova. Mostre ao usuário o que existe e pergunte. Só com o "sim" dele rode de novo com `--substituir` (guarda `.bak` da equipe antiga) ou `--forcar`.
   - **1, erro:** mostre a mensagem, corrija a causa (JSON da equipe, `settings.json` inválido, pasta inexistente) e rode de novo. Não repita o mesmo comando às cegas.

## 4. Fechar com o usuário

Diga, curto:
- **Próximo passo:** abrir um **chat novo** e digitar `/sala`. Chats já abertos não leem a variável nova; se a sala não aparecer, reinicie o app.
- **Guia automático:** daí em diante cada conversa nova recebe o guia da sala, e o Tech Lead delega às mesas sozinho, sem o usuário pedir. `/sala guia` mostra o texto e `"orientar": false` no arquivo da equipe desliga.
- **Painel, se ligado:**
  - entregue o primeiro link que o instalador mostrou, que costuma ser o da rede local, e o do `localhost` para abrir no próprio PC. Se houver vários IPs, o usuário escolhe o da rede dele: os outros costumam ser adaptadores virtuais (WSL, Hyper-V, VPN);
  - o link contém a chave, então só deve ser compartilhado com quem pode ver nomes de arquivos e comandos dos chats;
  - na primeira vez o Windows pode perguntar se o Node pode acessar a rede. Quem decide é o usuário; nunca altere firewall ou configurações de segurança.
- **Comandos:** `/sala mesas`, `/sala mesa + Nome | Modelo | palavra, palavra | apelido`, `/sala mesa - Nome`, `/sala resumo`, `/sala painel`.

## 5. Mudar a equipe

- **Algumas mesas:** o usuário digita `/sala mesa + …` ou `/sala mesa - …`, ou usa o botão **Mesas** do painel no próprio PC. Você também pode editar o `sala-agentes.json` direto.
- **Equipe nova:** refaça as perguntas da etapa 2 só no que muda e rode o instalador com `--equipe … --substituir`.

Em todos os casos a sala relê o arquivo em até 10 s e avisa o Tech Lead daquele chat com a mensagem "[Sala dos Agentes] A equipe deste projeto mudou…".

## 6. Usar a sala no dia a dia

O plugin já entrega estas regras ao Tech Lead em cada conversa. Siga-as também quando esta skill estiver carregada, porque são elas que fazem a sala economizar tempo e tokens:

- **Papel do Tech Lead.** Você é o Tech Lead (Opus): entende o pedido, planeja, divide, delega, revisa e integra.
- **Quando delegar.**
  - Pedido pequeno (uma pergunta, um arquivo, um comando): faça você mesmo. Cada agente começa sem contexto, então delegar trabalho pequeno custa mais do que resolve.
  - Pedido com várias partes: delegue às mesas desde o começo. Partes independentes vão em paralelo, com várias chamadas Agent na mesma resposta. Nunca ponha dois agentes no mesmo arquivo ao mesmo tempo.
- **Formato de cada chamada Agent:**
  - `description`: "Papel: tarefa curta";
  - `prompt`: começa com "Você é o <Papel>." e traz objetivo, arquivos, critério de pronto e o pedido de um resumo curto;
  - `model`: o da mesa, em minúsculas.

  É assim que o agente senta na mesa certa.
- **Quantas mesas usar.** Use as que o projeto precisar.
  - Faltou especialidade: papel temporário com a description "Novo Papel: tarefa" (ex.: "QA Android: testar o login"). A mesa abre na hora e some ao terminar.
  - Especialidade recorrente ou projeto grande: mesa fixa no `.claude/sala-agentes.json` do projeto, até 11 mesas.
  - Vários agentes do mesmo papel ao mesmo tempo sentam em mesas extras.
- **Mensagens do plugin.** As que começam com "[Sala dos Agentes]" vêm do plugin, não do usuário.

Exemplos de chamadas, como a sala escolhe a mesa e todos os comandos estão em `references/uso-da-sala.md`.

## Atualizar e remover

- **Atualizar:** com a skill nova, rode `instalar.mjs` sem `--equipe`. A equipe atual fica, e o painel reinicia sozinho se mudou.
- **Remover:** `instalar.mjs --desinstalar`. Saem a pasta do plugin, a variável, o atalho e o painel em execução; as equipes e o `web.json` ficam. Confirme com o usuário antes.

## Sem Node

O instalador e o painel precisam do Node 18+. Sem ele, ofereça duas saídas. O painel web não funciona sem Node.

**Opção A, recomendada:** o usuário instala o Node LTS de nodejs.org e você roda o instalador depois. Não baixe nem execute instaladores por ele.

**Opção B:** a instalação à mão, só do plugin e da equipe, com as ferramentas de arquivo:
1. Copiar `<SKILL_DIR>/assets/plugin/` inteira para `~/.claude/mods/sala-agentes/`.
2. No `~/.claude/settings.json`, guardar uma cópia e, dentro de `"env"`:
   - incluir `"CLAUDE_CODE_PLUGIN_DIRS"` com o caminho absoluto dessa pasta. Se já existir, acrescente com `;` no Windows ou `:` nos outros sistemas;
   - incluir `"CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"`;
   - preservar todo o resto.
3. Gravar a equipe montada na etapa 3 em `~/.claude/sala-agentes.json` ou no `.claude/` do projeto.

## Cuidados

- O instalador só mexe em:
  - `~/.claude/mods/sala-agentes/`;
  - no bloco `env` do `~/.claude/settings.json`, com cópia antes;
  - no arquivo da equipe escolhido;
  - em `~/.claude/sala-agentes/`;
  - no atalho da pasta Inicializar.
- No fim, o instalador roda `claude plugin validate`. O próprio Claude Code pode aproveitar e atualizar outras chaves do `settings.json` (ex.: o nome do modelo); o `settings.json.bak-sala-*` guarda o original.
- Para testar sem tocar na conta real, defina `SALA_HOME` (pasta que faz o papel da pasta pessoal) e `SALA_STARTUP_DIR` (pasta Inicializar), e use uma porta livre. O instalador avisa "MODO DE TESTE".
- Nada de firewall, antivírus ou outras configurações de segurança.
- A sala não grava o texto dos pedidos do usuário: o retrato e o painel mostram papéis, atividades, arquivos e comandos.
