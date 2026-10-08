# Painel web da Sala dos Agentes

Servidor Node leve (sem dependências) que mostra, ao vivo e numa página, as salas de todos os chats do Claude Code desta máquina. Abre no PC, no celular ou em qualquer aparelho da LAN/VPN. É de leitura, com uma única exceção: o editor de mesas (`POST /api/equipe`), que só mexe em `<pasta do projeto>\.claude\sala-agentes.json` e só aceita pedidos feitos no próprio computador.

- Lê os retratos de `%USERPROFILE%\.claude\sala-agentes\live\*.json` (formato em `SNAPSHOT.md`). Retratos com mais de 24 h são apagados.
- Sobe sozinho com o Windows pelo atalho `sala-agentes-painel.vbs` na pasta Inicializar (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`). Cópia de origem: `%USERPROFILE%\.claude\sala-agentes\start-painel.vbs`.
- Rotas: `/` (todas as salas), `/sala/<id>` (uma sala; 404 se não existir), `/api/salas` (JSON), `POST /api/equipe` (editor de mesas), `/health` (sem chave).

## Modos de visualização
Seletor no topo: **Lista**, **Mosaico**, **TV** (a escolha fica guardada no navegador). Parâmetros de URL sobrescrevem e servem para deixar um favorito pronto: `?modo=lista|mosaico|tv&div=auto|1|4|6|9|16&tempo=5|10|20|30` (ex.: `http://<ip>:8787/?t=<chave>&modo=tv&tempo=20` na TV; depois da primeira abertura a chave sai da URL e vale o cookie).
- **Lista** (padrão): chats à esquerda, sala escolhida grande à direita (desenho, agentes, eventos, botão Mesas). Se outro chat passar a aguardar você, aparece um aviso clicável no topo em vez de trocar a seleção.
- **Mosaico** (estilo CFTV): divisão Auto/1/4/6/9/16, só o desenho e uma tarja por tela; borda laranja em quem aguarda você; 6 = uma tela grande + 5; paginação ‹ 1/2 ›; clique numa tela abre o detalhe ao lado.
- **TV**: um chat por vez, troca sozinho a cada 5/10/20/30 s, para em quem aguarda você, botões pausar/anterior/próximo; letras grandes.
- Mosaico e TV ocupam a janela inteira (sem rolagem). Chats parados (sem sinal) só aparecem na Lista.

## Editor de mesas
Botão **Mesas** (na sala escolhida) abre um painel para adicionar ou tirar papéis fixos da equipe do projeto daquele chat. Grava `<pasta do projeto>\.claude\sala-agentes.json` (cria a partir da equipe atual se ainda não existir); o Tech Lead do chat é avisado da nova formação no turno seguinte (a sala relê a equipe em até 10 s). Limites: 1 a 11 papéis, nome de 1 a 22 caracteres e único.
- Só aparece e funciona abrindo o painel **no próprio computador** (localhost). Para liberar a edição pela LAN/VPN, ponha `"allowRemoteEdit": true` no `web.json` (vale em até 5 s, sem reiniciar).
- Proteções: chave, cabeçalho `X-Sala-Edit`, checagem de `Origin`, corpo até 8 KB, gravação atômica e nada fora de `<projeto>\.claude\`. Detalhes em `SNAPSHOT.md`.

## Ligar e desligar
- Ligar agora: dê dois cliques em `%USERPROFILE%\.claude\sala-agentes\start-painel.vbs` (se já estiver no ar, a nova instância sai sozinha).
- Desligar de vez: apague `sala-agentes-painel.vbs` da pasta Inicializar e encerre o processo `node.exe` do painel (Gerenciador de Tarefas, ou `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? CommandLine -like '*sala-agentes*web*server.mjs*' | % { Stop-Process -Id $_.ProcessId }`).

## Link de acesso e chave
- A chave (token) e os links prontos ficam em `%USERPROFILE%\.claude\sala-agentes\web.json` (campo `urls`; também aparecem na seção do plugin). Abra o link completo uma vez em cada aparelho: o navegador guarda um cookie por 30 dias.
- Porta e interface: campos `port` e `host` do mesmo arquivo (padrão `8787` e `0.0.0.0`). Campo opcional `allowRemoteEdit` (veja Editor de mesas).
- Trocar a chave: apague a linha `"token"` do `web.json` e reinicie o painel; uma nova chave é gerada e os links antigos deixam de valer.
- Na primeira vez o Windows pode perguntar se o Node pode acessar a rede: quem decide é você (o painel não mexe no firewall). Sem liberar, só o `localhost` funciona.

## Aviso
O painel mostra nomes de arquivos, comandos e andamento dos chats. Compartilhe o link só com quem pode ver isso.
