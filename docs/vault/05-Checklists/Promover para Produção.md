---
tags: [checklist, release]
---
# Promover para Produção

São duas etapas, cada uma com o OK do usuário. Copie este checklist para a nota da tarefa e marque item a item.

## A. Publicar na máquina (cópia instalada)
- [ ] OK do usuário para publicar
- [ ] [[Definition of Done]] marcada na tarefa
- [ ] `version` subiu em `plugin/.claude-plugin/plugin.json`
- [ ] `claude plugin validate ./plugin` e `claude plugin test ./plugin` passando
- [ ] `node scripts/publicar.mjs` rodou sem erro (sem `--force`, salvo com o motivo anotado)
- [ ] Painel reiniciado, se `plugin/web/server.mjs` mudou
- [ ] `node scripts/gerar-skill.mjs` rodado, se o plugin mudou
- [ ] Conferência: `/sala` abre num chat novo e o rodapé mostra a versão nova

## B. Publicar no GitHub (`main` pública)
- [ ] OK do usuário para o push
- [ ] Nenhum dado pessoal no diff: e-mails, caminhos da máquina, IPs ou nomes de clientes
- [ ] Nenhum print novo mostra a chave do painel ou chats reais
- [ ] Commit com o e-mail `noreply` do repo
- [ ] [[Changelog]]: "Não lançado" renomeado para a versão e a data
- [ ] Push da `limpo` para a `origin/main`
- [ ] CI verde no GitHub
- [ ] Tag `vX.Y.Z` e release com o `dist/sala-agentes.skill` (só com OK do usuário)
- [ ] Issues fechadas e [[Último Agente - Handoff]] atualizado

**Rollback:** publicar a versão anterior na máquina; no GitHub, um commit que reverte. Registre no [[Diário de Desenvolvimento]].
