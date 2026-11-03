---
tags: [conhecimento]
---
# Glossário

Termos do domínio e da arquitetura do projeto. Crie notas de referência ao lado desta e ligue-as aqui.

- **Tech Lead:** o modelo principal do chat. Planeja, delega, revisa e integra.
- **Mesa:** o lugar de um papel na sala (Dev, QA, Documentador e outros), com o modelo indicado para ele.
- **Mesa extra:** um lugar a mais, usado quando vários agentes do mesmo papel trabalham juntos.
- **Papel temporário:** uma mesa criada na hora quando a descrição do agente começa com "Novo Papel: tarefa". Some quando o agente termina.
- **Equipe:** o arquivo `sala-agentes.json`, com o líder, os papéis, os modelos e as palavras que puxam tarefas para cada mesa.
- **Guia automático:** o bloco `salaAgentes` que o plugin põe no começo de cada conversa, com as mesas e a regra de delegação. `"orientar": false` desliga.
- **Retrato:** o JSON que o plugin grava para cada chat e que o painel lê. Formato em `plugin/web/SNAPSHOT.md`.
- **Painel:** o servidor web local que mostra as salas de todos os chats (modos Lista, Mosaico e TV).
- **Chave do painel:** o token do `web.json`. Vai no link `?t=` no primeiro acesso; depois fica num cookie por porta.
- **Cópia instalada:** a pasta `~/.claude/mods/sala-agentes`, que todos os chats carregam.
