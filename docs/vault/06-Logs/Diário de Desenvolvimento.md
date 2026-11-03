---
tags: [log]
---
# Diário de Desenvolvimento

Mais recente primeiro. Use o [[Template - Log Diário]]. Seja honesto: registre falhas e resultados parciais.

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
