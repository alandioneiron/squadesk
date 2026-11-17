---
tags: [log, handoff]
---
# Último Agente - Handoff

> Arquivo vivo. O último agente o reescreve no fim de toda sessão. É a primeira nota a ler depois da [[Home]]. O histórico fica no [[Log de Sessões de IA]] e no [[Diário de Desenvolvimento]].
>
> Esta nota é pública. Detalhes da máquina (caminhos, links do painel, contas) ficam no backup local `_backup-contexto/`, fora do git.

## Última atualização
- **Quando:** 2026-11-17
- **Quem:** Tech Lead (Opus)
- **Sessão:** 0.8.0, a mesa mostra o modelo em uso e os tokens por modelo

## Publicado agora
- **GitHub:** a `main` está na 0.8.0. As tags e as releases ainda não existem.
- **Máquina do dono:** plugin 0.8.0 instalado, painel reiniciado na versão nova e `.skill` regerado.
- **Conferido no chat real:** `/model fable` e depois `/model opus` trocaram a mesa do Tech Lead, e a divisão "Fable · Opus" apareceu no agente, no chat e no resumo do dia.

## Em andamento
- Nada.

## Esperando o usuário
- OK para cada passo no GitHub: labels, milestones, quadro, proteção da `main`, tags das versões e release com o `dist/sala-agentes.skill`.
- Pôr o Claude Code CLI no PATH. Até lá, os testes rodam com o executável que vem com o app desktop (a pasta muda a cada versão do app).
- Fazer login no `claude -p` desta máquina, para testar hooks no motor real antes de publicar.

## Próximos passos (na ordem)
1. O CI avisa que `actions/checkout@v4` e `actions/setup-node@v4` miram o Node 20, que está obsoleto. Quando mexer no workflow, suba as duas para a versão seguinte.
2. Abrir as candidatas do [[Roteiro]] como issues, a partir do [[Template - Tarefa]].
