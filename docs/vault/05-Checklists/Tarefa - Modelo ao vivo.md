---
tags: [tarefa]
---
# Tarefa: a mesa mostra o modelo em uso e os tokens por modelo

- **Issue:** `pendente` (ver abaixo)
- **Branch:** `limpo`
- **Fase / milestone:** 0.8.0 ([[Roteiro]])
- **Spec:** `plugin/web/SNAPSHOT.md`, ADR-0008 no [[Registro de Decisões (ADR)]]
- **Pedido (2026-11-17):** o dono perguntou se a skill tinha o `/model opusplan` e se valia uma mesa a mais para o modelo forte. Decidido: sem mesa a mais; a mesa do Tech Lead mostra o modelo que o chat usa de fato. Se ele trocar para Fable no chat, a mesa troca também.
- **Critérios de aceite:**
  - [x] A mesa do Tech Lead (desenho, `/sala`, retrato e painel) mostra o modelo em uso, lido do motor a cada passo; o `lider.modelo` do arquivo da equipe só vale até a primeira resposta
  - [x] Trocar o modelo no meio do chat (`/model`) muda a mesa no passo seguinte (teste; no motor real, chats em Fable e em Sonnet já aparecem com o modelo certo)
  - [x] Com `opusplan`, a mesa alterna entre Opus e Sonnet conforme o passo (teste)
  - [x] Cada agente guarda os tokens por modelo (`byModel`); o resumo do dia também
  - [x] `/sala` e o painel mostram a divisão por modelo quando houve mais de um
  - [x] O guia não fixa mais "Tech Lead (Opus)": usa o modelo em uso
  - [x] Retratos antigos (0.7.x) continuam funcionando, sem divisão ("–")

## Passos
- [x] Dev Plugin (Sonnet): hooks, tipos, testes, versão 0.8.0 (29 de 29, 4 testes novos)
- [x] Dev Painel Web (Sonnet): `server.mjs`, `SNAPSHOT.md`, dados de exemplo
- [x] Tech Lead: `docs/MANUAL.md`, ADR-0008, Roteiro, Changelog, Arquitetura
- [x] Tech Lead: revisar o diff das duas mesas (guia aceita "Opus Plan"; coluna do papel sem quebra no meio da palavra)
- [x] Regenerar os exemplos (`node scripts/gerar-exemplos.mts`)
- [x] `claude plugin validate` e `claude plugin test` (29 de 29)
- [x] Conferência visual do painel com os exemplos (PC e 375 px)
- [x] Publicar na máquina (`publicar.mjs`), reiniciar o painel, gerar o `.skill` (o dono concordou com o fluxo: testes, conferência, publicação e push)
- [x] Conferência no motor real: o `claude -p` está sem login; depois de publicar, os retratos dos chats recarregados mostram Fable, Sonnet e Opus conforme o modelo de cada chat
- [x] Commit e push para a `main`

## Pendente no GitHub
- Abrir a issue desta tarefa e ligar a esta nota.

## Processo (obrigatório)
- [x] Docs de conhecimento lidos
- [x] Documentação viva atualizada ([[Diário de Desenvolvimento]], spec, [[Changelog]])
- [x] Checklist marcado item a item
- [x] DoD: cada linha da [[Definition of Done]] conferida para esta tarefa (instalador não mudou)
- [x] [[Log de Sessões de IA]]
