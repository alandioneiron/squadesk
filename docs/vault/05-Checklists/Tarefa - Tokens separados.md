---
tags: [tarefa]
---
# Tarefa: tokens separados em entrada, saída e cache lido

- **Issue:** `pendente` (ver abaixo)
- **Branch:** `limpo`
- **Fase / milestone:** 0.7.0 ([[Roteiro]])
- **Spec:** `plugin/web/SNAPSHOT.md`, ADR-0007 no [[Registro de Decisões (ADR)]]
- **Pedido (2026-11-11):** o dono perguntou se a contagem era de entrada ou de saída e pediu para separar, depois atualizar no GitHub.
- **Critérios de aceite:**
  - [x] Cada agente guarda `tokIn`, `tokOut` e `tokCache`; `tokens` continua com a mesma regra
  - [x] O retrato do chat traz os campos no chat, nos agentes e no resumo do dia
  - [x] `/sala` mostra o detalhe nas linhas de agente e no resumo do dia; o desenho mostra só o total
  - [x] O painel mostra o detalhe no cartão "tokens hoje", no cabeçalho da sala, nos agentes e na tabela do dia
  - [x] Retratos antigos (0.6.x) continuam funcionando, sem detalhe ("–" nas colunas do dia)

## Passos
- [x] Dev Plugin (Sonnet): hooks, tipos, testes, versão 0.7.0 (25 de 25; teste existente ampliado)
- [x] Dev Painel Web (Sonnet): `server.mjs`, `SNAPSHOT.md`, dados de exemplo
- [x] Tech Lead: `docs/MANUAL.md` (5.8, 5.10, 5.12)
- [x] Tech Lead: revisar o diff das duas mesas ("–" em vez de "0" nas colunas sem divisão)
- [x] Regenerar os exemplos (`node scripts/gerar-exemplos.mts`)
- [x] `claude plugin validate` e `claude plugin test` (25 de 25)
- [x] Conferência visual do painel com os exemplos (PC e 375 px)
- [x] Publicar na máquina (`publicar.mjs`), reiniciar o painel, gerar o `.skill`
- [ ] Commit e push para a `main` (o dono pediu "atualiza no github")

## Pendente no GitHub
- Abrir a issue desta tarefa e ligar a esta nota (não foi aberta: o pedido foi só de atualizar o código).

## Processo (obrigatório)
- [x] Docs de conhecimento lidos
- [x] Documentação viva atualizada ([[Diário de Desenvolvimento]], spec, [[Changelog]])
- [x] Checklist marcado item a item
- [x] DoD: cada linha da [[Definition of Done]] conferida para esta tarefa (instalador não mudou)
- [x] [[Log de Sessões de IA]]
