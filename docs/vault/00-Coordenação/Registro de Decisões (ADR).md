---
tags: [coordenacao, adr]
---
# Registro de Decisões (ADR)

Toda decisão de arquitetura ou tecnologia ganha uma entrada. Crie o ADR a partir do [[Template - ADR]] e mantenha aqui o próximo número.

As decisões 0002 a 0006 foram tomadas antes de o vault existir. Elas foram registradas aqui em 2026-11-03, com a data em que passaram a valer.

Próximo número: **ADR-0008**

| ADR | Data | Decisão | Status |
|---|---|---|---|
| ADR-0001 | 2026-11-03 | Adotar o método tech-lead-vault no modo Adotar | Aceito |
| ADR-0002 | 2026-10-07 | Editar só em `plugin/` e publicar na máquina com `scripts/publicar.mjs` | Aceito |
| ADR-0003 | 2026-10-07 | Carregar o plugin por `CLAUDE_CODE_PLUGIN_DIRS`, não pelo marketplace | Aceito |
| ADR-0004 | 2026-10-08 | Nome público Squadesk; manter os nomes técnicos `/sala` e `sala-agentes` | Aceito |
| ADR-0005 | 2026-10-08 | Repositório público limpo: sem dados pessoais, prints do QA fora do git | Aceito |
| ADR-0006 | 2026-10-08 | Painel web com chave por porta e edição de mesas só pelo próprio PC | Aceito |
| ADR-0007 | 2026-11-11 | Tokens separados em campos novos; o total e a sua regra não mudam | Aceito |

## ADR-0001 - Adotar o método tech-lead-vault
- **Data:** 2026-11-03
- **Status:** Aceito
- **Contexto:** o projeto já tinha processo: publicação testada, testes, a equipe da Sala e um backup de contexto. Mas as regras e as decisões viviam na memória das sessões e num backup fora do git, e uma sessão nova numa máquina nova não as achava.
- **Decisão:** adotar o método no modo **Adotar**:
  - o vault em `docs/vault` é a memória;
  - o GitHub é o fluxo;
  - toda sessão termina com um handoff.

  O que já existia continua valendo. O roteamento de modelos fica com a própria Sala dos Agentes.
- **Alternativas:**
  - modo Install completo: duplicaria o roteamento e mudaria o fluxo de branches;
  - deixar como estava: as regras continuariam fora do repositório.
- **Consequências:**
  - o vault é público junto com o código, então segue a regra de dados pessoais (ADR-0005);
  - labels, quadro, proteção da `main` e releases esperam o OK do dono;
  - ver a seção `tech-lead-vault` do `CLAUDE.md`.

## ADR-0002 - Editar só em `plugin/`, publicar com `publicar.mjs`
- **Data:** 2026-10-07
- **Status:** Aceito
- **Contexto:** todos os chats carregam a cópia instalada e a recarregam sozinhos (`CLAUDE_CODE_PLUGIN_DIR_WATCH=1`). Um arquivo salvo pela metade quebra a sala em todos eles. Outros chats já tinham editado a cópia instalada direto.
- **Decisão:** a fonte é `plugin/`, neste repositório. `node scripts/publicar.mjs` valida, testa e copia. Ele recusa a cópia se a pasta instalada foi editada por fora; os hashes ficam em `.publicado.json`.
- **Consequências:** toda entrega sobe a `version` do `plugin.json`, e o rodapé da sala mostra a versão de cada chat.

## ADR-0003 - Carregar o plugin por variável de ambiente
- **Data:** 2026-10-07
- **Status:** Aceito
- **Contexto:** pelo marketplace, o cache prendia os chats numa versão velha do plugin.
- **Decisão:** o instalador grava duas variáveis no bloco `env` do `~/.claude/settings.json`:
  - `CLAUDE_CODE_PLUGIN_DIRS` com a pasta do plugin;
  - `CLAUDE_CODE_PLUGIN_DIR_WATCH=1`.
- **Consequências:** a atualização chega a todos os chats sem reiniciar. O instalador precisa mexer no `settings.json` com cuidado: grava pelo link e nunca apaga arquivo fora do pacote.

## ADR-0004 - Nome público Squadesk
- **Data:** 2026-10-08
- **Status:** Aceito
- **Contexto:** o projeto ia virar código aberto e precisava de um nome próprio, sem ligação com empresas.
- **Decisão:** a marca é **Squadesk**. Continuam iguais:
  - os comandos `/sala`;
  - o arquivo `sala-agentes.json`;
  - o id do plugin, `sala-agentes`.
- **Consequências:** quem já usava não precisa mudar nada. A documentação explica que "Sala dos Agentes" e Squadesk são o mesmo projeto.

## ADR-0005 - Repositório público sem dados pessoais
- **Data:** 2026-10-08
- **Status:** Aceito
- **Contexto:** a história antiga tinha e-mail pessoal e nomes de empresa. Os prints do QA mostravam chats reais e a chave do painel.
- **Decisão:**
  - repositório novo, com história limpa;
  - commits com o e-mail `noreply` do GitHub, configurado só neste repo;
  - documentação sem caminhos de máquina;
  - `docs/prints/qa-*` e `_backup-contexto/` no `.gitignore`.
- **Consequências:** antes de cada push, conferir os prints e os textos novos. Ver [[Riscos]].

## ADR-0006 - Painel com chave por porta e edição só local
- **Data:** 2026-10-08
- **Status:** Aceito
- **Contexto:** o painel mostra os chats para a rede local (celular, TV), e o editor de mesas grava arquivos no disco.
- **Decisão:**
  - o painel exige a chave do `web.json` no primeiro acesso;
  - depois guarda um cookie `sala_t_<porta>`; o antigo `sala_t` continua aceito;
  - o editor de mesas só funciona pelo `localhost`, salvo com `allowRemoteEdit`.
- **Consequências:** cada aparelho abre o link completo uma vez. Num navegador novo, o endereço sem `?t=` mostra "Acesso negado". Os detalhes estão no `docs/MANUAL.md`, seção 5.12.

## ADR-0007 - Tokens separados sem mudar o total
- **Data:** 2026-11-11
- **Status:** Aceito
- **Contexto:** o dono quis saber se a contagem era de entrada ou de saída. O total somava entrada nova, gravação de cache e saída, sem mostrar as partes, e deixava a leitura de cache de fora sem dizer quanto era.
- **Decisão:** três campos novos em cada agente, no retrato e no resumo do dia:
  - `tokIn`: entrada nova mais gravação de cache;
  - `tokOut`: saída;
  - `tokCache`: leitura de cache, fora do total.

  O campo `tokens` continua com a mesma regra (`tokIn + tokOut`). O desenho da sala, a lista de chats, o Mosaico e a TV continuam só com o total.
- **Alternativas:**
  - somar o cache lido no total: o número inflaria sem refletir o custo, que é cerca de 10% do normal;
  - trocar `tokens` por um objeto: quebraria painéis e retratos 0.6.x.
- **Consequências:** retratos antigos não têm os campos, e o painel trata a falta como zero, sem detalhe. Chats abertos antes da 0.7.0 só separam os turnos novos. Contrato em `plugin/web/SNAPSHOT.md`.
