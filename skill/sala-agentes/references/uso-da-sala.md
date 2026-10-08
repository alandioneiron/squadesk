# Como a sala funciona no dia a dia

Para o Tech Lead, que delega às mesas, e para o usuário que quer entender o que aparece na tela.

## 1. O que a sala mostra

- **Personagens:** o Tech Lead e cada subagente aparecem como personagens. Cada um senta na mesa do seu papel.
- **Mesas extras:** a mesa do papel é do primeiro agente dele. Se outro agente do mesmo papel começa enquanto ela está ocupada, senta na primeira mesa extra livre. Quem termina libera a mesa.
- **Atividade:** cada personagem mostra o que faz: pensando, lendo, editando, rodando comando, delegando, aguardando você, concluído, ocioso ou livre.
- **Tokens e cronômetros:** cada linha mostra quanto o agente gastou em tokens. Os cronômetros da lista são atualizados a cada 15 s.
- **Aprovação:** quando uma ferramenta pede aprovação, o personagem fica parado com o aviso "aguardando você", e o cabeçalho conta quantos esperam. Quando a ferramenta roda, o personagem volta ao trabalho.
- **Papel temporário:** uma tarefa "Papel: tarefa" com papel fora da equipe abre uma mesa na hora, com o nome desse papel. Ela some quando o agente termina.
- **Resumo do dia:** `/sala resumo` mostra, por papel, as tarefas, o tempo e os tokens do dia neste chat. O texto sai em Markdown, pronto para colar no log de alterações.
- **Painel web:** `/sala painel` mostra os links do painel, que reúne as salas de todos os chats da máquina. Tem três modos: Lista (padrão), Mosaico (várias telas ao mesmo tempo, com borda laranja em quem aguarda você) e TV (um chat por vez, troca sozinho e para em quem aguarda você). A porta padrão é 8787.

## 2. O guia automático

No começo de cada conversa, e de novo depois de `/clear` ou de uma compactação, a sala põe no contexto do Tech Lead um bloco `salaAgentes`. Ele traz o líder, as mesas do projeto (com até 5 palavras cada) e seis regras de delegação. O usuário não precisa pedir.

- `/sala guia` mostra o texto que o modelo recebe naquele projeto.
- `"orientar": false` no `sala-agentes.json` desliga o guia. No arquivo do projeto, vale só para ele. No `~/.claude`, vale para os projetos sem arquivo próprio.

As regras, em resumo:
1. **Pedido pequeno** (uma pergunta, um arquivo, um comando): o Tech Lead faz sozinho. Cada agente começa sem contexto, então delegar tarefa pequena custa mais do que economiza.
2. **Pedido com várias partes:** planeja e delega às mesas desde o começo. Partes independentes vão em paralelo, com várias chamadas Agent na mesma resposta. Dois agentes nunca editam o mesmo arquivo ao mesmo tempo.
3. **Formato da chamada:** `description` no formato "Papel: tarefa curta"; `prompt` começa com "Você é o <Papel>." e traz objetivo, arquivos, critério de pronto e o pedido de um resumo curto.
4. **Modelo:** é o da mesa, em minúsculas. Haiku para documentação, conferência, buscas e testes simples; Sonnet para código, depuração e QA ponta a ponta; Opus fica com o Tech Lead e só vai para um agente quando a tarefa exige raciocínio difícil.
5. **Falta especialidade:** papel temporário, com description "Novo Papel: tarefa". Se a especialidade vai se repetir ou o projeto é grande, mesa fixa no `.claude/sala-agentes.json` (até 11 mesas).
6. **Vários agentes do mesmo papel:** os que sobram sentam em mesas extras.

As mensagens que começam com "[Sala dos Agentes]" vêm do plugin, não do usuário. Um subagente (cujo prompt começa com "Você é o <Papel>.") ignora o guia e faz só a sua tarefa.

## 3. Exemplos de chamadas Agent

**Dev implementando:**

```
description: "Dev Backend: criar o endpoint de login"
model: "sonnet"
prompt: "Você é o Dev Backend. Objetivo: criar o endpoint POST /login, validando usuário e senha.
Arquivos: os de autenticação já existentes e as rotas do projeto.
Pronto quando: os testes de login passam e nenhum outro arquivo mudou.
Devolva um resumo curto do que mudou."
```

**QA conferindo:**

```
description: "QA: conferir o login depois da mudança"
model: "haiku"
prompt: "Você é o QA. Objetivo: conferir o fluxo de login (sucesso, senha errada, usuário bloqueado) contra o que foi pedido.
Não edite código. Liste o que passou e o que falhou, com arquivo e linha.
Devolva um resumo curto."
```

**Papel temporário "QA Android":**

```
description: "QA Android: testar o login no app"
model: "sonnet"
prompt: "Você é o QA Android. Objetivo: testar o login no app Android, seguindo o roteiro de login do projeto.
Pronto quando todos os passos do roteiro forem executados.
Devolva um resumo curto com os passos que falharam."
```

"QA Android" não está na equipe, então vira uma mesa temporária com o modelo da chamada (Sonnet). Ela some quando o agente termina.

## 4. Como a sala escolhe a mesa

A sala escolhe a mesa de cada subagente nesta ordem:

0. **Prefixo "Papel:".** Se o texto antes dos dois-pontos é o nome ou um apelido de uma mesa da equipe, vai para ela. Se não é, e parece nome de papel (até 3 palavras, com inicial maiúscula, sem ser verbo nem etapa como "Fazer:" ou "Bug 12:"), vira mesa temporária.
1. **Nome ou apelido citado** na descrição e, depois, no prompt. Vale o que aparece primeiro. No mesmo ponto, vale o nome mais longo: "QA E2E" não cai na mesa "QA". O nome precisa vir inteiro: "Dev Backend" manda direto, "backend" sozinho só se for apelido.
2. **Palavras-chave:** entre as mesas do modelo do agente (ou todas, se nenhuma tiver esse modelo), vence a que mais casa palavras da descrição e do tipo do agente. Empate: a primeira da lista.
3. **Menos ocupada:** sem palavra casada, vai para a mesa com menos agentes ativos entre as candidatas.

## 5. Mudar as mesas

Há três jeitos:
- **No chat:** `/sala mesas` lista; `/sala mesa + Nome | Modelo | palavra, palavra | apelido` adiciona; `/sala mesa - Nome` tira.
- **No painel web:** botão **Mesas**, na sala escolhida. Só funciona no próprio computador. Pela rede, só com `"allowRemoteEdit": true` no `web.json`.
- **À mão:** edite o JSON.

Limites: de 1 a 11 mesas, nome de até 22 caracteres e único. A última mesa não pode ser tirada.

**De onde vem a equipe.** A sala procura, nesta ordem:
1. `.claude/sala-agentes.json` na pasta do projeto e nas de cima, como o git faz. A busca começa na pasta atual e depois passa pela pasta em que o chat abriu. A pasta pessoal (`~`) fica de fora.
2. `~/.claude/sala-agentes.json`.
3. A equipe padrão: QA, Documentador, Dev Backend, Dev Frontend e Dev Infra.

`/sala mesa +` cria `.claude/sala-agentes.json` a partir da equipe em uso, quando o projeto ainda não tem arquivo. `/sala equipe` cria o arquivo com a equipe padrão.

**Quando a mudança vale.** A sala relê a equipe em até 10 s. Se uma mesa entrou, saiu ou trocou de modelo, grava na conversa daquele chat uma mensagem "[Sala dos Agentes] A equipe deste projeto mudou…", com a nova formação e o lembrete de delegar com "Papel: tarefa" na descrição e "Você é o <Papel>." no prompt.

## 6. Comandos /sala

| Comando | O que faz |
|---|---|
| `/sala` | Abre a sala e mostra de onde veio a equipe em uso. |
| `/sala mesas` | Lista as mesas e mostra como adicionar e tirar. |
| `/sala mesa + Nome \| Modelo \| palavras \| apelido` | Adiciona uma mesa fixa. |
| `/sala mesa - Nome` | Tira uma mesa fixa. |
| `/sala equipe` | Cria `.claude/sala-agentes.json` do projeto com a equipe padrão, se ainda não existir. |
| `/sala guia` | Mostra o guia que o Tech Lead recebe neste projeto. |
| `/sala resumo` | Mostra o resumo do dia deste chat, por papel. |
| `/sala painel` | Mostra os links do painel na rede. |

## 7. Privacidade

- O texto dos pedidos do usuário não entra no retrato da sala nem no painel. Aparecem papéis, atividades, arquivos e comandos.
- O link do painel tem a chave (token). Compartilhe só com quem pode ver nomes de arquivos, comandos e andamento dos chats.
- Para trocar a chave e invalidar os links antigos, apague a linha `token` do `web.json` e reinicie o painel.
- O painel não mexe no firewall. Na primeira vez, o Windows pode perguntar se o Node pode acessar a rede, e quem decide é o usuário.
