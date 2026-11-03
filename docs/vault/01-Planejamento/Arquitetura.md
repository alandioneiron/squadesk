---
tags: [planejamento, arquitetura]
---
# Arquitetura

Componentes, como conversam, onde ficam os dados e como o projeto é publicado. Atualize esta nota na mesma tarefa de qualquer mudança que a afete. As decisões por trás estão no [[Registro de Decisões (ADR)]].

O caminho dos dados, desenhado, está no `docs/MANUAL.md`, seção 1. A tabela de pastas está no `README.md`, seção "Estrutura".

## Componentes
- **Plugin** (`plugin/`): function hooks do Claude Code.
  - `hooks/register.tsx`: eventos e comandos `/sala`.
  - `hooks/team.ts`: equipe; acha o papel pelo nome, apelido, palavras ou modelo, e cuida do papel temporário "Papel: tarefa".
  - `hooks/room.ts`: desenho SVG e lista.
  - `hooks/live.ts`: retrato do chat para o painel e resumo do dia.
  - `hooks/guide.ts`: guia de delegação que o hook `prompt.context` põe no começo de cada conversa.
- **Contrato do estado:** `plugin/types/index.d.ts`.
- **Painel web** (`plugin/web/server.mjs`): Node puro, sem dependências, na porta 8787 por padrão. Lê os retratos e mostra os chats nos modos Lista, Mosaico e TV.
- **Skill de instalação** (`skill/sala-agentes/`): faz as perguntas iniciais (quantas mesas e o segmento de cada uma) e roda o `scripts/instalar.mjs`.
- **Scripts de desenvolvimento** (`scripts/`):
  - `publicar.mjs`: publica na cópia instalada;
  - `gerar-skill.mjs`: gera o pacote `.skill`;
  - `gerar-exemplos.mts`: gera os retratos de exemplo.

## Dados (tudo local, nada vai para a internet)
- **Equipe do projeto:** `.claude/sala-agentes.json`, procurado subindo as pastas como o git, sem entrar na pasta pessoal. Na falta dele, vale `~/.claude/sala-agentes.json` e, por último, a equipe padrão.
- **Retratos dos chats:** `~/.claude/sala-agentes/live/<chat>.json`. O formato está em `plugin/web/SNAPSHOT.md`.
- **Configuração do painel:** `~/.claude/sala-agentes/web.json`. Guarda a chave de acesso e **nunca** vai para o git.

## Implantação
- **Na máquina:** o plugin é carregado de `~/.claude/mods/sala-agentes` pela variável `CLAUDE_CODE_PLUGIN_DIRS` (ADR-0003). Ele só muda por `publicar.mjs` (ADR-0002).
- **Para outras pessoas:** clonar o repositório e rodar `skill/sala-agentes/scripts/instalar.mjs`, ou instalar a skill. Ver o [[Fluxo de Desenvolvimento]].
