---
tags: [checklist, dod]
---
# Definition of Done (DoD)

Nada é "concluído" até todos os itens estarem marcados. Vale para qualquer agente.

- [ ] Requisito atendido e demonstrado (teste ou evidência)
- [ ] Código revisado pelo Tech Lead, e também pelo Revisor de Código se mexe em segurança, no painel ou no instalador
- [ ] `claude plugin test ./plugin` passando, com testes novos para o que mudou (ou a falta justificada)
- [ ] Se o instalador mudou: testado numa conta simulada (`SALA_HOME`, `SALA_STARTUP_DIR`)
- [ ] Sem segredos em código, commits, logs ou prints, inclusive a chave do painel
- [ ] Sem dados pessoais: e-mails, caminhos da máquina, IPs ou nomes de clientes
- [ ] Documentação viva atualizada:
  - [ ] [[Diário de Desenvolvimento]]
  - [ ] [[Changelog]] (se mudou comportamento)
  - [ ] `docs/MANUAL.md` e `README.md` (se o usuário vê a mudança)
  - [ ] Spec do módulo (ver [[Especificações de Módulos]])
  - [ ] [[Arquitetura]] (se afetada)
- [ ] Checklists do processo marcados item a item
- [ ] Decisões registradas como ADR no [[Registro de Decisões (ADR)]] (se houve)
- [ ] Uma linha no [[Log de Sessões de IA]]
- [ ] [[Último Agente - Handoff]] reescrito (fim da sessão)
