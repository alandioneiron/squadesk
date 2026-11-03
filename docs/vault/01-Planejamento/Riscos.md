---
tags: [planejamento, riscos]
---
# Riscos

Riscos que nunca somem (legal, privacidade, termos de plataformas, segurança). Releia esta nota quando uma decisão os tocar.

| Risco | Impacto | Mitigação | ADR relacionado |
|---|---|---|---|
| Dado pessoal ou da máquina num commit público (e-mail, caminho, IP, nome de cliente) | Exposição permanente na história do git | Conferência antes de cada push; e-mail `noreply`; docs com `~` e `SEU_USUARIO` | ADR-0005 |
| Print com a chave do painel ou com chats reais | Qualquer um na rede vê os chats | Prints do QA fora do git; exemplos fictícios; conferir cada print novo | ADR-0005, ADR-0006 |
| Arquivo salvo pela metade na cópia instalada | A sala quebra em todos os chats abertos | Editar só em `plugin/` e publicar pelo `publicar.mjs` | ADR-0002 |
| Mudança na API de plugins do Claude Code | A sala para de carregar ou perde eventos | `claude plugin validate/test` a cada entrega; rodapé mostra a versão | ADR-0003 |
| Instalador mexendo no `settings.json` ou em arquivos do usuário | Configuração do usuário estragada | Conta simulada nos testes; nunca apagar fora do pacote; recusar links simbólicos e junções | ADR-0003 |
| Painel exposto na rede local | Outra pessoa da rede vê os chats | Chave no primeiro acesso, cookie por porta, editor só pelo `localhost` | ADR-0006 |
