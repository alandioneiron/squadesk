---
tags: [coordenacao, processo]
---
# Fluxo de Desenvolvimento (dev para produção)

Como uma mudança sai da ideia e chega a quem usa.

## Ambientes
| Ambiente | Onde | Notas |
|---|---|---|
| Desenvolvimento | `plugin/`, `skill/` e `scripts/` neste clone | Testes com `claude plugin test ./plugin`. O instalador é testado numa conta simulada (`SALA_HOME` e `SALA_STARTUP_DIR`) |
| CI | GitHub Actions (`.github/workflows/tests.yml`) | Só a parte em Node: sintaxe dos scripts e o instalador em `--simular`. O CI não tem o Claude Code |
| Produção na máquina | `~/.claude/mods/sala-agentes` | A cópia que todos os chats carregam. Só muda por `node scripts/publicar.mjs` |
| Produção pública | `main` em `github.com/alandioneiron/squadesk` | Quem instala de fora clona daqui. A branch local `limpo` acompanha a `origin/main` |

## O caminho de uma mudança
1. **Pedido.** Vira uma issue no GitHub (ver [[Template - Tarefa]]) e uma nota de checklist em `05-Checklists/`. Sem `gh`, ou sem OK para criar a issue, a nota registra o comando em "Pendente no GitHub".
2. **Código.** Só em `plugin/`, nunca na cópia instalada, numa branch `task/<n>-<slug>` ou na `limpo`.
   - Delegue pelas mesas da Sala (`.claude/sala-agentes.json`).
   - O Revisor de Código olha as mudanças de segurança, do painel e do instalador.
3. **Testes.** `claude plugin validate ./plugin` e `claude plugin test ./plugin`. Se mexeu no instalador, teste também numa conta simulada.
4. **Docs vivas.**
   - [[Changelog]] e [[Diário de Desenvolvimento]].
   - `docs/MANUAL.md` e `README.md`, se o usuário vê a mudança.
   - [[Definition of Done]] marcada.
5. **Publicar na máquina** (com OK do usuário):
   - subir a `version` no `plugin.json`;
   - rodar `node scripts/publicar.mjs`;
   - reiniciar o painel, se `web/server.mjs` mudou;
   - rodar `node scripts/gerar-skill.mjs`.
6. **Publicar no GitHub** (com OK do usuário):
   - commit;
   - conferir dados pessoais e prints;
   - push da `limpo` para a `origin/main`;
   - quando houver releases: tag `vX.Y.Z` e release com o `.skill`.

   Ver [[Promover para Produção]].
7. **Rollback.**
   - Na máquina: rodar o `publicar.mjs` de uma versão anterior (checkout da tag ou do commit).
   - No GitHub: um commit que reverte.

## Regras
- Nada vai para a cópia instalada nem para a `main` pública sem o OK do usuário.
- A `main` é pública: o que entra nela é publicado na hora.
- Segredos nunca vão para o git. A chave do painel fica só no `web.json` da máquina.
- O CI só roda testes: sem segredos e sem publicação.
