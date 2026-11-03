---
tags: [log, changelog]
---
# Changelog

Segue SemVer. As notas de release saem daqui. As versões anteriores a 0.6.0 foram reconstruídas a partir do histórico do projeto.

## Não lançado
- Processo: método tech-lead-vault adotado (`CLAUDE.md`, vault em `docs/vault`, modelos de issue e PR, CI em Node). Não muda o plugin.

## 0.6.1 - 2026-10-08
- Manual completo (`docs/MANUAL.md`) para Windows, macOS e Linux, revisado contra o código.
- Fuso horário do sistema, em vez de um fixo.
- Painel:
  - cookie por porta (`sala_t_<porta>`);
  - links conforme o `host`;
  - editor de mesas só pelo `localhost`.
- Instalador:
  - `--parar-painel`;
  - num clone, usa a pasta `plugin/`;
  - valida o plugin com uma configuração temporária.

## 0.6.0 - 2026-10-08
- Primeira versão pública com o nome Squadesk, código aberto (MIT).

## 0.5.x - 2026-10-08
- Guia automático de delegação no começo de cada conversa (`/sala guia`; `"orientar": false` desliga).
- Arquivo da equipe procurado subindo as pastas.
- Arquivo da equipe aceito com BOM.
- Skill de instalação com perguntas iniciais e `instalar.mjs`.

## 0.4.x - 2026-10-07
- Painel web com os modos Lista, Mosaico (1/4/6/9/16) e TV.
- Editor de mesas no painel.
- Comandos `/sala mesas`, `/sala mesa +` e `/sala mesa -`.
- Aviso ao Tech Lead quando a equipe muda.

## 0.3.x - 2026-10-07
- Na sala:
  - tokens, cronômetro e aviso de aprovação;
  - resumo do dia e histórico;
  - outros chats;
  - papel temporário.
- Título do chat no painel; chats sem sinal há 3 minutos aparecem como "Parados".
