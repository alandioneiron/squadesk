---
tags: [log]
---
# Diário de Desenvolvimento

Mais recente primeiro. Use o [[Template - Log Diário]]. Seja honesto: registre falhas e resultados parciais.

## 2026-11-17 - 0.8.0: a mesa mostra o modelo em uso e os tokens por modelo
**Agente:** Tech Lead (Opus), Dev Plugin (Sonnet), Dev Painel Web (Sonnet), QA (Haiku)
**O quê:**
- hook `turn.step`: a mesa do Tech Lead e a dos subagentes mostram o modelo que o motor usou em cada passo;
- `$.session.model()` no começo do chat e de cada turno;
- campo `byModel` no agente, no chat e no resumo do dia, com a coluna Modelos;
- o guia sem "Tech Lead (Opus)" fixo; `opusplan` vira "Opus no plano, Sonnet na execução";
- correção: o `turn.start` mexia no Tech Lead também quando o turno era de um subagente;
- ADR-0008.

Ver [[Tarefa - Modelo ao vivo]].
**Por quê:** o dono perguntou pelo `/model opusplan` e se valia uma mesa a mais para o modelo forte. A resposta foi não: uma mesa é um agente. Mas a mesa do Tech Lead precisa dizer o modelo certo; se ele trocar para Fable no chat, a mesa troca também.
**Resultado:**
- `claude plugin validate` passou; `claude plugin test` deu 29 de 29 (4 testes novos).
- Conferência visual numa instância isolada com os exemplos: divisão no cabeçalho, na linha do agente e na coluna Modelos. A 375 px a tabela do dia rola dentro do quadro, sem estourar a página. O Tech Lead corrigiu a coluna do papel, que quebrava "Dev Backend" no meio da palavra.
- Não deu para rodar o motor real antes de publicar: o `claude -p` desta máquina está sem login. O hook segue o padrão documentado (`yield* next(e)`), e a conferência real foi feita depois de publicar.
- Achado conhecido: no dia da atualização, um papel que soma chats 0.7.x mostra a divisão só da parte nova. Isso está documentado no manual, como na 0.7.0.
- Publicado na máquina, painel reiniciado, `.skill` regerado.
**Docs atualizados:** `docs/MANUAL.md` (5.1, 5.7, 5.8, 5.10, 5.12, 7), `plugin/web/SNAPSHOT.md`, [[Registro de Decisões (ADR)]], [[Arquitetura]], [[Changelog]], [[Roteiro]], [[Último Agente - Handoff]]
**Próximo:** ver o handoff.

## 2026-11-11 - 0.7.0: tokens separados em entrada, saída e cache lido
**Agente:** Tech Lead (Opus), Dev Plugin (Sonnet), Dev Painel Web (Sonnet)
**O quê:**
- campos `tokIn`, `tokOut` e `tokCache` nos agentes, no retrato e no resumo do dia;
- o detalhe aparece no `/sala` e no painel;
- manual 5.8, 5.10 e 5.12;
- ADR-0007.

Ver [[Tarefa - Tokens separados]].
**Por quê:** o dono perguntou se a contagem era de entrada ou de saída. Era a soma das duas, mais a gravação de cache, sem mostrar as partes.
**Resultado:**
- `claude plugin validate` passou; `claude plugin test` deu 25 de 25 (um teste existente foi ampliado, nenhum novo).
- Conferência visual numa instância isolada (porta de teste, chave descartável, exemplos e um retrato 0.6.x): PC e celular de 375 px, sem rolagem lateral.
- Publicado na máquina, painel reiniciado, `.skill` regerado.
- Achado: no dia da atualização, o resumo soma chats 0.6.x sem divisão, e entrada mais saída fica menor que o total. Isso foi documentado no manual. O Tech Lead trocou o "0" das colunas sem divisão por "–".
- O `claude` continua fora do PATH; os testes usaram o executável que vem com o app.
**Docs atualizados:** `docs/MANUAL.md`, `plugin/web/SNAPSHOT.md`, [[Registro de Decisões (ADR)]], [[Changelog]], [[Roteiro]], [[Último Agente - Handoff]]
**Próximo:** ver o handoff.

## 2026-11-03 - Método tech-lead-vault adotado
**Agente:** Tech Lead (Opus)
**O quê:** foram criados:
- o `CLAUDE.md` com as regras do projeto e a seção `tech-lead-vault`;
- o vault em `docs/vault`;
- os modelos de issue e de PR;
- o CI em Node.

As decisões antigas foram registradas como ADR-0002 a ADR-0006 e o changelog foi reconstruído.
**Por quê:** as regras e as decisões viviam na memória das sessões e num backup fora do git. Na mudança de máquina, isso ficou evidente.
**Resultado:** commit local na branch `limpo`, sem push.
- Os testes do plugin não rodaram nesta sessão: o comando `claude` não está no PATH da máquina nova.
- O CI só foi conferido localmente: `node --check` nos scripts e o instalador em `--simular` numa conta simulada passaram.
**Docs atualizados:** [[Home]], [[Registro de Decisões (ADR)]], [[Fluxo de Desenvolvimento]], [[Changelog]], [[Último Agente - Handoff]]
**Próximo:** OK do dono para o push e para os passos no GitHub (ver o handoff).
