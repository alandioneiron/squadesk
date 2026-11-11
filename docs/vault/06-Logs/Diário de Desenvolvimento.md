---
tags: [log]
---
# Diário de Desenvolvimento

Mais recente primeiro. Use o [[Template - Log Diário]]. Seja honesto: registre falhas e resultados parciais.

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
