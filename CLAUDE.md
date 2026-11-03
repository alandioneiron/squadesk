# CLAUDE.md - Regras operacionais do projeto "Squadesk · Sala dos Agentes"

> Lido automaticamente por toda sessão de IA neste diretório. Estas regras têm prioridade sobre o comportamento padrão.

## O que é este projeto
Plugin de Claude Code que mostra o Tech Lead e os subagentes trabalhando numa sala, cada um na mesa do seu papel, com painel web na rede local e uma skill que instala tudo em outras contas. Código aberto (MIT), em `github.com/alandioneiron/squadesk`.

- Manual do usuário: `docs/MANUAL.md`. Visão geral e estrutura: `README.md`.
- Memória do projeto (decisões, logs, handoff): vault do Obsidian em `docs/vault`, ligado por `[[wikilinks]]`. Comece pela [[Home]].

## Regras do projeto (valem antes das regras gerais)
- **Repositório público.** Nada de dados pessoais: sem e-mails, sem caminhos desta máquina (use `~` e `SEU_USUARIO`), sem IPs da rede, sem nomes de clientes ou empresas. Exemplos e prints usam só projetos fictícios.
- **Prints.** Antes de commitar um print, confira que ele não mostra a chave do painel (`web.json`) nem chats reais. Os prints do QA (`docs/prints/qa-*`) ficam fora do git.
- **Onde editar.** Só em `plugin/`. A cópia instalada (`~/.claude/mods/sala-agentes`) é recarregada por todos os chats: um arquivo salvo pela metade quebra a sala em todos eles.
- **Publicar na máquina.** `node scripts/publicar.mjs` valida, testa e só então copia. Suba `version` em `plugin/.claude-plugin/plugin.json` a cada entrega. Se `plugin/web/server.mjs` mudou, reinicie o painel. Plugin novo: rode `node scripts/gerar-skill.mjs` de novo.
- **Testes.** `claude plugin validate ./plugin` e `claude plugin test ./plugin` (precisam do Claude Code). O CI do GitHub roda só a parte em Node (sintaxe dos scripts e instalador em modo simulação).
- **Nomes técnicos.** `/sala`, `sala-agentes.json` e o id `sala-agentes` ficam como estão, por compatibilidade. "Squadesk" é a marca.
- **Docs para quem é de fora.** O manual descreve instalação, funcionamento e como ligar cada recurso em Windows, macOS e Linux, sem supor a máquina de ninguém.
- **Bash no Windows.** Não use `cd` para subpastas (muda a pasta do chat que a sala acompanha); use caminhos absolutos. Heredoc pode estragar barras invertidas: edite código com Edit/Write.

## Regras de processo

1. **Documentação viva.** Sempre que escrever, editar ou testar código ou configuração, atualize os documentos afetados na MESMA tarefa, antes de considerá-la concluída: [[Diário de Desenvolvimento]], [[Changelog]] (se mudou comportamento), `docs/MANUAL.md` e `README.md` (se mudou o que o usuário vê), a spec do módulo (ver [[Especificações de Módulos]]), a [[Arquitetura]] se afetada, e uma linha no [[Log de Sessões de IA]].
2. **Checklists.** Todo processo segue um checklist em `docs/vault/05-Checklists/`. Marque `[x]` cada item assim que concluí-lo, não em lote. Sem checklist, crie um a partir do [[Template - Tarefa]] antes.
3. **Definition of Done.** Nada é "concluído" sem passar pela [[Definition of Done]].
4. **Decisões.** Toda decisão de arquitetura/tecnologia vira um ADR no [[Registro de Decisões (ADR)]], com o [[Template - ADR]].
5. **Produção só com OK do usuário.** Aqui há duas "produções": a cópia instalada na máquina (`publicar.mjs`) e a `main` pública no GitHub (push, tag, release). As duas só com OK do usuário. Ver [[Fluxo de Desenvolvimento]] e [[Promover para Produção]].
6. **Handoff.** No fim de toda sessão, reescreva o [[Último Agente - Handoff]]: o que está publicado, em andamento, esperando o usuário e os próximos passos.
7. **Commit só quando o usuário pedir ou autorizar; push só com OK.** A branch local `limpo` acompanha a `main` pública, e todo push publica. Commits só de docs adicionam apenas os docs.
8. **Nunca commitar segredos** (chaves, tokens, a chave do painel, credenciais, `.env`). O `.gitignore` protege `dist/`, os prints do QA e o backup local.
9. **Datas** sempre em `AAAA-MM-DD`.

## O GitHub é o fluxo de trabalho
A issue guarda o STATUS; o vault guarda o CONHECIMENTO. Ligue cada issue à sua nota de checklist/spec e vice-versa. As versões seguem SemVer; ver [[Roteiro]] e [[Changelog]].

## Ponto de partida de qualquer sessão
1. Ler a [[Home]] e o [[Último Agente - Handoff]].
2. Ler o [[Roteiro]] e o checklist da tarefa em andamento.
3. Ao terminar, aplicar as regras 1-6.

## Convenções
- Idioma: PT-BR, para o usuário e na documentação.
- Links entre notas: `[[Nome da Nota]]` (sem extensão).
- Riscos recorrentes nunca somem; ver [[Riscos]].

## tech-lead-vault
Método adotado em 2026-11-03, no modo **Adotar** (ver ADR-0001 no [[Registro de Decisões (ADR)]]). O processo que já existia continua valendo; o método só completou o que faltava.

| Peça do método | Neste projeto |
|---|---|
| Regras (CLAUDE.md) | Este arquivo; antes, as regras estavam só na memória das sessões |
| Papéis e roteamento de modelos | A própria Sala dos Agentes: mesas em `.claude/sala-agentes.json` e o guia automático que o plugin põe no começo de cada conversa. Por isso o vault não tem `Roteamento de Modelos` nem `03-Agentes` |
| Fluxo dev para produção | `scripts/publicar.mjs` (cópia instalada) e push da `main` pública, descritos no [[Fluxo de Desenvolvimento]] |
| Testes e CI | `claude plugin test ./plugin` local; `.github/workflows/tests.yml` com a parte em Node |
| Handoff | [[Último Agente - Handoff]], público e sem dados da máquina. Os detalhes da máquina (caminhos, links do painel) ficam em `_backup-contexto/`, fora do git |
| Decisões, changelog, diário, log de sessões | `docs/vault/00-Coordenação` e `docs/vault/06-Logs` |
| Manual do usuário | `docs/MANUAL.md` continua fora do vault: é para quem instala, não para quem desenvolve |

Diferenças deliberadas em relação ao método padrão:
- sem branch `dev`: o trabalho vai numa branch de tarefa (ou na `limpo`) e o OK do usuário vem antes do push;
- regra 7: commit e push só com OK do usuário, porque a `main` é pública;
- labels, milestones, quadro do GitHub, proteção da `main`, tags e releases ficam para quando o usuário der o OK.
