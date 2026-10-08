# Catálogo de mesas

Use este arquivo na instalação. Ele transforma os segmentos que o usuário escolheu numa equipe `sala-agentes.json`. Quem valida e grava é o instalador (`scripts/instalar.mjs`).

## 1. Formato do arquivo

Onde fica:
- `.claude/sala-agentes.json` na pasta do projeto: vale só nele;
- `~/.claude/sala-agentes.json`: vale para os projetos que não têm arquivo próprio.

Exemplo completo, com 5 mesas. O exemplo mostra o formato; a ordem das mesas de uma equipe real vem da regra da seção 5.

```json
{
  "lider": { "nome": "Tech Lead", "modelo": "Opus" },
  "orientar": true,
  "papeis": [
    {
      "nome": "Dev Backend",
      "modelo": "Sonnet",
      "palavras": ["back", "api", "endpoint", "servico", "service", "rota", "auth", "controller"],
      "apelidos": ["Backend"]
    },
    {
      "nome": "Dev Frontend",
      "modelo": "Sonnet",
      "palavras": ["front", "react", "tela", "componente", "css", "html", "layout", "pagina"],
      "apelidos": ["Frontend"]
    },
    {
      "nome": "Banco de Dados",
      "modelo": "Sonnet",
      "palavras": ["banco", "sql", "database", "tabela", "migra", "indice", "query", "schema"],
      "apelidos": ["DBA"]
    },
    {
      "nome": "QA",
      "modelo": "Haiku",
      "palavras": ["qa", "test", "valid", "smoke", "confer", "verific", "checklist", "regress"]
    },
    {
      "nome": "Documentador",
      "modelo": "Haiku",
      "palavras": ["documen", "docs", "readme", "changelog", "manual", "guia", "handoff", "registr", "anot"]
    }
  ]
}
```

Campos:

| Campo | Obrigatório | Regra |
|---|---|---|
| `lider` | não | `nome` (padrão "Tech Lead") e `modelo` (padrão Opus). Modelo desconhecido vira Opus, sem aviso. |
| `orientar` | não | Padrão `true`. `false` desliga o guia automático. |
| `papeis` | sim | Lista de mesas. |
| `papeis[].nome` | sim | Até 22 caracteres. |
| `papeis[].modelo` | recomendado | Opus, Sonnet, Haiku ou Fable. Outro valor faz o arquivo ser recusado. Sem modelo, a mesa só entra na escolha quando nenhuma mesa tem o modelo do agente. |
| `papeis[].palavras` | recomendado | Começos de palavra que puxam tarefas para a mesa (seção 2). |
| `papeis[].apelidos` | não | Outros nomes da mesa (seção 2). |

Regras:
- De 1 a 11 mesas.
- O nome é único. Nome com mais de 22 caracteres é cortado com reticências na sala. Nome repetido é recusado pelo `/sala mesa +` e pelo painel.
- A ordem importa: as 2 primeiras mesas ficam ao lado do líder. Ponha primeiro as que mais vão trabalhar.
- `_como_usar`, se existir, é só texto de instrução. A sala ignora.

## 2. Palavras e apelidos

**`palavras`** são começos de palavra. A sala compara o início das palavras da descrição da tarefa, sem diferença de maiúsculas e sem acento. Por isso:
- `test` pega "testes" e "testar", mas não "contestar";
- escreva em minúsculas e sem acento: `servico`, não `serviço`;
- use de 5 a 12 por mesa;
- inclua termos em português e em inglês, porque a descrição pode vir em qualquer um dos dois;
- não repita a mesma palavra em duas mesas do mesmo modelo. A sala escolhe primeiro entre as mesas do modelo do agente, e a palavra repetida só causa empate; no empate, vence a mesa que vem antes na lista;
- evite começos curtos que pegam outro assunto: `doc` pega "docker", `bi` pega "biblioteca", `log` pega "login", `post` pega "postgres", `print` pega "printer". Prefira `documen` e `docs`. Começos de 2 ou 3 letras só valem para siglas da área que quase nunca aparecem em outro sentido (`ui`, `ux`, `ia`, `ml`, `ios`, `qa`, `sql`);
- uma entrada pode ter mais de uma palavra (`power bi`, `ponta a ponta`). Ela casa quando a descrição traz essa sequência com espaço simples, e o último termo também conta como começo de palavra.

**`apelidos`** são outros nomes da mesa. Quando a descrição ou o prompt cita o nome ou um apelido inteiro, o agente vai direto para a mesa, antes de a sala olhar as palavras:
- "Dev Backend: criar a rota" vai para a mesa Dev Backend;
- "backend" sozinho só vai para a mesa se for apelido;
- maiúsculas, acentos e espaço, hífen ou `_` entre as palavras não fazem diferença;
- use apelido curto e específico. Um apelido genérico desvia tarefas alheias: "Redes" pegaria "redes sociais".

## 3. Modelo por tipo de trabalho

| Modelo | Use para | Por quê |
|---|---|---|
| Haiku | documentação, conferência, checklists, buscas, testes simples | É o mais barato e o mais rápido. São tarefas mecânicas, que não pedem raciocínio profundo. |
| Sonnet | código, depuração, integração, QA ponta a ponta, revisão de código | Equilíbrio entre custo e qualidade para trabalho que exige entender código. |
| Opus | só mesa de arquitetura ou pesquisa difícil | É o mais caro. O Tech Lead já é Opus, então delegar a Opus só compensa quando a tarefa exige raciocínio difícil. |
| Fable | só se o usuário pedir | A sala aceita, mas nenhuma mesa do catálogo usa. |

## 4. Catálogo de segmentos

Os nomes já cabem em 22 caracteres. As palavras estão em minúsculas e sem acento, e não se repetem entre mesas do mesmo modelo. Pesquisa fica em Sonnet; use Opus só se a pesquisa for difícil.

| Segmento | Nome da mesa | Modelo | Palavras | Apelidos |
|---|---|---|---|---|
| Dev Backend | Dev Backend | Sonnet | back, api, endpoint, servico, service, rota, auth, controller | Backend |
| Dev Frontend | Dev Frontend | Sonnet | front, react, vue, angular, tela, componente, css, html, layout, pagina | Frontend |
| Dev Mobile | Dev Mobile | Sonnet | mobile, android, ios, flutter, kotlin, swift, celular, aplicativo, apk, tablet | Mobile |
| Dev Infra/DevOps | Dev Infra | Sonnet | infra, docker, kubernetes, deploy, nginx, servidor, server, pipeline, devops, container | DevOps |
| Banco de Dados | Banco de Dados | Sonnet | banco, sql, database, tabela, migra, indice, query, schema, postgres, mysql | DBA |
| Dados/BI | Dados/BI | Sonnet | dados, dashboard, kpi, etl, planilha, relatorio, indicador, power bi | BI |
| IA/ML | IA/ML | Sonnet | ia, ml, machine learning, llm, treino, classif, embedding, prompt | IA |
| QA | QA | Haiku | qa, test, valid, smoke, confer, verific, checklist, regress | (nenhum) |
| QA E2E | QA E2E | Sonnet | e2e, ponta a ponta, navegador, browser, playwright, cypress, selenium, screenshot, fluxo | E2E |
| Segurança | Segurança | Sonnet | seguran, security, vulnerab, owasp, pentest, lgpd, criptograf, credencia, hardening | Security |
| Revisor de Código | Revisor de Código | Sonnet | revis, review, refator, qualidade, padr, legibil, lint, simplific | Revisor |
| Documentador | Documentador | Haiku | documen, docs, readme, changelog, manual, guia, handoff, registr, anot, wiki, tutorial | (nenhum) |
| UX/UI Design | UX/UI Design | Sonnet | ux, ui, design, usabilidade, wireframe, prototipo, acessibilidade, jornada, figma, mockup | UX |
| Redes/Telecom | Redes/Telecom | Sonnet | rede, network, vlan, mikrotik, roteador, firewall, vpn, ddns, telecom, ramal | Telecom |
| Automação/Scripts | Automação/Scripts | Sonnet | automa, script, powershell, bash, crontab, agendad, robo, batch, python | Scripts |
| Integrações/APIs | Integrações/APIs | Sonnet | integr, webhook, terceiro, conector, oauth, sincroniz, externa, externo, parceiro, sdk | Integrações, APIs externas |
| Suporte/Helpdesk | Suporte/Helpdesk | Haiku | suporte, chamado, ticket, helpdesk, atendimento, triagem, incidente, usuario | Helpdesk |
| Conteúdo/Marketing | Conteúdo/Marketing | Haiku | copy, marketing, campanha, anuncio, newsletter, blog, seo, redes sociais, legenda, conteudo | Marketing |
| Pesquisa | Pesquisa | Sonnet | pesquis, research, investig, levantamento, benchmark, estudo, compara, fontes, explor | (nenhum) |
| Arquiteto | Arquiteto | Opus | arquitet, architect, escalabilidade, decisao, modelagem, adr, trade-off, diagrama | Arquitetura |

## 5. Equipes prontas por tipo de projeto

| Tipo de projeto | Mesas, na ordem |
|---|---|
| Sistema web | Dev Backend, Dev Frontend, Banco de Dados, QA, QA E2E, Revisor de Código, Documentador, Dev Infra |
| App mobile | Dev Mobile, Dev Backend, UX/UI Design, QA, QA E2E, Documentador, Revisor de Código |
| Infraestrutura/redes | Dev Infra, Redes/Telecom, QA, Segurança, Automação/Scripts, Documentador, Revisor de Código |
| Dados/BI | Dados/BI, Banco de Dados, QA, IA/ML, Automação/Scripts, Documentador, Revisor de Código |
| Automação/scripts | Automação/Scripts, Integrações/APIs, QA, Documentador, Revisor de Código |
| Site/landing page | Dev Frontend, UX/UI Design, QA, Conteúdo/Marketing, QA E2E, Documentador |
| Documentação/conteúdo | Documentador, Conteúdo/Marketing, Pesquisa, QA |
| Desconhecido ou misto | Dev Backend, Dev Frontend, QA, Documentador, Dev Infra, QA E2E, Revisor de Código |

**Montar a proposta.** Esta é a única regra para qualquer quantidade N de mesas, inclusive 3, 5 e 7:
1. Pegue as N primeiras mesas da linha do tipo de projeto, na ordem.
2. Se a linha tiver menos de N mesas, complete com estas, pulando as que já entraram: QA, Documentador, QA E2E, Revisor de Código, Dev Infra, Segurança.
3. Com N maior ou igual a 3 e sem QA entre as escolhidas, troque a última por QA: toda equipe precisa de alguém que confira.
4. A ordem final é a da linha. As 2 primeiras ficam ao lado do líder; por isso as linhas começam pelas mesas que mais trabalham.

Exemplos:
- App mobile com 4 mesas: Dev Mobile, Dev Backend, UX/UI Design, QA.
- Infraestrutura com 3 mesas: Dev Infra, Redes/Telecom, QA.
- Automação com 7 mesas: as 5 da linha, mais QA E2E e Dev Infra.

O usuário pode trocar qualquer mesa na rodada 2. Mesa só faz sentido quando o trabalho dela se repete no projeto; especialidade de uma tarefa só vira papel temporário, sem mesa fixa.

## 6. Segmento que não está no catálogo

1. **Nome:** use a área com o papel, como "Dev Mobile". Até 22 caracteres e único na equipe.
2. **Modelo:** siga a seção 3.
3. **Palavras:** de 5 a 12 começos de palavra tirados da descrição do segmento, em português e em inglês, sem acento e sem repetir palavras de mesas do mesmo modelo.
4. **Apelidos:** só se houver um nome curto e distinto.
5. **Proposta:** mostre a mesa ao usuário junto com as demais, com o modelo.

Exemplo: o segmento "Cloud/AWS" vira `"nome": "Cloud/AWS"`, `"modelo": "Sonnet"`, `"palavras": ["aws", "cloud", "terraform", "lambda", "bucket", "iam", "ec2"]` e `"apelidos": ["AWS"]`.
