import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { AgentRow } from '../types'
import { pickTitle } from '../hooks/live'
import { activityFor, detailFor, emptyLead, fmtDuration, fmtTokens, roster, trailText } from '../hooks/room'
import {
  addRoleTo,
  defaultTeam,
  exampleFile,
  isTempRole,
  LEAD,
  looksLikeRole,
  parseTeam,
  pickRole,
  removeRoleFrom,
  roleLabel,
  seatAgent,
  teamDiff,
  teamDirs,
  teamToFile,
} from '../hooks/team'
import { GUIDE_BLOCK } from '../hooks/guide'

const DESKTOP = {
  plugin: 'sala-agentes',
  surface: 'desktop',
  component: 'Pane',
  requestId: 'sala-agentes',
  props: {
    title: 'Sala dos Agentes',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// O que fica embaixo do plugin numa sessão: relógio, ferramentas, turnos, criação de agentes.
function world(on: On) {
  mock.clock(on, { now: 1_000 })
  mock.env(on, {})
  on('tool.call', async () => ({ result: 'ok' }) as never)
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
}

function spawnArgs(id: string, description: string, prompt = '') {
  return {
    tool_use_id: `tu-${id}`,
    prompt,
    description,
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' as const },
    model: 'sonnet',
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  }
}

test('o papel vem do nome citado, das palavras da tarefa e do modelo', async () => {
  const team = defaultTeam()
  const role = (model: string, description: string, prompt = '', load: Record<string, number> = {}) =>
    pickRole(team, load, { model, type: 'general-purpose', description, prompt }).name

  expect(role('claude-sonnet-5-5', 'Ajustar config', 'Você é o Dev Infra. O QA valida depois.')).toBe('Dev Infra')
  expect(role('claude-haiku-4-5', 'Validar entrega', 'Você é o QA. O Dev-Backend implementou X.')).toBe('QA')
  expect(role('claude-haiku-4-5', 'Atualizar log de alterações')).toBe('Documentador')
  expect(role('claude-haiku-4-5', 'Rodar smoke test')).toBe('QA')
  expect(role('claude-sonnet-5-5', 'Tela de login WPF')).toBe('Dev Frontend')
  expect(role('claude-sonnet-5-5', 'Endpoint de pagamento da API')).toBe('Dev Backend')
  expect(role('claude-sonnet-5-5', 'Ajustar compose do nginx')).toBe('Dev Infra')
  // Sem pista: o papel do mesmo modelo menos ocupado.
  expect(role('claude-sonnet-5-5', 'Mapear arquivos', '', { 'dev-backend': 1 })).toBe('Dev Frontend')
})

test('a equipe do arquivo vale; arquivo ruim diz o motivo', async () => {
  const team = parseTeam(
    JSON.stringify({
      lider: { nome: 'Arquiteto', modelo: 'Opus' },
      papeis: [
        { nome: 'Segurança', modelo: 'Sonnet', palavras: ['pentest', 'cve'], apelidos: ['SecOps'] },
        { nome: 'Dev Mobile', modelo: 'Sonnet', palavras: ['android', 'ios'] },
      ],
    }),
    'x.json',
  )
  expect(team.lead.name).toBe('Arquiteto')
  expect(team.roles.map(r => r.name)).toEqual(['Segurança', 'Dev Mobile'])
  // Arquivo salvo com BOM (Bloco de Notas, PowerShell 5) vale igual.
  expect(parseTeam('﻿' + JSON.stringify({ papeis: [{ nome: 'QA', modelo: 'Haiku' }] }), 'bom.json').roles[0]?.name).toBe('QA')
  const pick = (description: string) =>
    pickRole(team, {}, { model: 'sonnet', type: '', description, prompt: '' }).name
  expect(pick('Revisar CVE do OpenSSL')).toBe('Segurança')
  expect(pick('Tela do app Android')).toBe('Dev Mobile')
  expect(pick('Pedido para o secops')).toBe('Segurança')

  // Nome que contém outro ("QA E2E" ⊃ "QA"): vale o mais longo, em qualquer ordem da lista.
  for (const papeis of [
    [{ nome: 'QA', modelo: 'Haiku' }, { nome: 'QA E2E', modelo: 'Sonnet' }],
    [{ nome: 'QA E2E', modelo: 'Sonnet' }, { nome: 'QA', modelo: 'Haiku' }],
  ]) {
    const t = parseTeam(JSON.stringify({ papeis }), 'x.json')
    const p = (description: string, prompt = '') =>
      pickRole(t, {}, { model: 'sonnet', type: '', description, prompt }).name
    expect(p('QA E2E: roteiro do Editar')).toBe('QA E2E')
    expect(p('Testar', 'Você é o QA E2E do projeto. O QA conferiu antes.')).toBe('QA E2E')
    expect(p('Validar', 'Você é o QA. Depois o QA E2E roda.')).toBe('QA')
  }

  // O arquivo que "/sala equipe" cria é a equipe padrão.
  expect(parseTeam(exampleFile(), 'x').roles).toEqual(defaultTeam().roles)

  expect(() => parseTeam('{', 'x')).toThrow('não é um JSON válido')
  expect(() => parseTeam('{"papeis": []}', 'x')).toThrow('pelo menos 1 papel')
  expect(() => parseTeam('{"papeis": [{"nome": "QA", "modelo": "GPT"}]}', 'x')).toThrow('modelo "GPT" desconhecido')
})

test('papel ocupado manda o próximo agente para uma mesa extra', async () => {
  const team = defaultTeam()
  const row = (id: string, born: number): AgentRow => ({
    ...emptyLead(),
    id,
    role: 'dev-backend',
    roleName: 'Dev Backend',
    model: 'Sonnet',
    activity: 'pensando',
    born,
  })
  let m: Record<string, AgentRow> = { [LEAD]: emptyLead() }
  m = seatAgent(m, row('a', 1))
  m = seatAgent(m, row('b', 2))
  m = seatAgent(m, row('c', 3))
  expect([m.a?.desk, m.b?.desk, m.c?.desk]).toEqual([-1, 0, 1])
  expect(roster(team, m).map(l => l.title)).toContain('Dev Backend 3')

  // Quem já concluiu libera a mesa para o próximo.
  m = { ...m, a: { ...m.a!, activity: 'concluido' } }
  m = seatAgent(m, row('d', 4))
  expect(m.a).toBeUndefined()
  expect(m.d?.desk).toBe(-1)
})

test('cada ferramenta vira uma atividade com detalhe legível', async () => {
  expect(activityFor('Edit')).toBe('editando')
  expect(activityFor('Grep')).toBe('lendo')
  expect(activityFor('PowerShell')).toBe('comando')
  expect(activityFor('Agent')).toBe('delegando')
  expect(activityFor('AskUserQuestion')).toBe('aprovacao')
  expect(detailFor('Read', { file_path: 'D:\\app\\src\\ApiClient.cs' })).toBe('ApiClient.cs')
  expect(detailFor('Bash', { command: 'git status\ngit log' })).toBe('$ git status')
  expect(detailFor('WebFetch', { url: 'https://example.com/x' })).toBe('example.com')
})

test('o Tech Lead aparece lendo enquanto a ferramenta roda', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  let during = ''
  on('tool.call', async () => {
    during = await alt()
    return { result: 'ok' } as never
  })
  const pane = await $.ui.mount(DESKTOP)
  const alt = async () => String((await pane.find({ type: 'Svg' }))?.props.alt)

  await $.tool.call({ tool: 'Read', file_path: 'D:/x/ApiClient.cs' })

  expect(during).toContain('Tech Lead: lendo (ApiClient.cs)')
  expect(await alt()).toContain('Tech Lead: pensando (ApiClient.cs)')
  await pane.unmount()
})

test('a sala desenha no desktop e no terminal, e o botão zera', async ($, on) => {
  world(on)
  await $.tool.call({ tool: 'Bash', command: 'dotnet build' })

  const desk = await $.ui.mount(DESKTOP)
  const svg = await desk.find({ type: 'Svg' })
  expect(String(svg?.props.source)).toContain('Dev Backend')
  expect(String(svg?.props.alt)).toContain('Tech Lead: pensando ($ dotnet build)')
  // Como imagem (sem quadro interativo) o SVG ocupa a largura do painel.
  expect(svg?.props.isInteractive).toBeUndefined()
  expect(await desk.find({ type: 'Text', text: /dotnet build/ })).toBeDefined()
  await desk.press({ key: 'reset' })
  expect(String((await desk.find({ type: 'Svg' }))?.props.alt)).toContain('Tech Lead: ocioso')
  await desk.unmount()

  const term = await $.ui.mount({ ...DESKTOP, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /Dev Infra/ })).toBeDefined()
  await term.unmount()
})

test('subagente Haiku de documentação senta na mesa do Documentador e entrega', async ($, on) => {
  world(on)
  on('agent.spawn', async () => ({ model: 'claude-haiku-4-5-20251001', agentId: 'ag-doc' }))
  const pane = await $.ui.mount(DESKTOP)
  const alt = async () => String((await pane.find({ type: 'Svg' }))?.props.alt)

  await $.agent.spawn({ ...spawnArgs('doc', 'Atualizar log de alterações'), model: 'haiku' })
  expect(await alt()).toContain('Documentador: pensando (recebeu a tarefa)')
  expect(String((await pane.find({ type: 'Svg' }))?.props.source)).toContain('class="flow"')

  await $.tool.call({ tool: 'Edit', file_path: 'D:/app/docs/CHANGELOG.md', agentId: 'ag-doc' } as never)
  expect(await alt()).toContain('Documentador: pensando (CHANGELOG.md)')

  await $.turn.complete({
    answer: 'feito',
    durationMs: 1200,
    isAborted: false,
    turnId: 't-1',
    agentId: 'ag-doc',
    reason: 'answer',
  })
  expect(await alt()).toContain('Documentador: concluído (entregou)')
  expect(await pane.find({ type: 'Text', text: /Tech Lead → Documentador \(Haiku\)/ })).toBeDefined()
  await pane.unmount()
})

test('três Devs Backend ao mesmo tempo: um na mesa do papel, dois nas mesas extras', async ($, on) => {
  world(on)
  let n = 0
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5-5', agentId: `be-${++n}` }))
  const pane = await $.ui.mount(DESKTOP)

  for (const task of ['Endpoint de gravação', 'Endpoint de playback', 'Endpoint de eventos']) {
    await $.agent.spawn(spawnArgs(task, task))
  }
  await $.tool.call({ tool: 'Edit', file_path: 'D:/src/Playback.cs', agentId: 'be-2' } as never)

  const svg = String((await pane.find({ type: 'Svg' }))?.props.source)
  expect(svg).toContain('MESAS EXTRAS')
  expect(svg).toContain('Dev Backend 3')
  expect(await pane.find({ type: 'Text', text: 'Dev Backend 2' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Playback\.cs/ })).toBeDefined()
  expect(String((await pane.find({ type: 'Svg' }))?.props.alt)).toContain('Dev Backend 2: pensando (Playback.cs)')
  await pane.unmount()
})

test('a equipe do projeto vem de .claude/sala-agentes.json', async ($, on) => {
  world(on)
  // O caminho chega no formato do sistema (barras invertidas no Windows).
  const file = /proj.\.claude.sala-agentes\.json$/
  const seen: string[] = []
  on('session.cwd', async () => ({ value: 'D:/proj' }))
  on('fs.exists', async (_$, e) => (seen.push(e.path), { value: file.test(e.path) }))
  on('fs.read', async () => ({
    value: JSON.stringify({ papeis: [{ nome: 'Segurança', modelo: 'Sonnet', palavras: ['cve'] }] }),
  }))
  const pane = await $.ui.mount(DESKTOP)

  await $.turn.start({ text: 'revisa as CVEs', turnId: 't-1' })
  expect(seen).toHaveLength(1)

  expect(String((await pane.find({ type: 'Svg' }))?.props.alt)).toContain('Segurança: livre')
  expect(await pane.find({ type: 'Text', text: /Equipe de D:\/proj/ })).toBeDefined()
  await pane.unmount()
})

test('arquivo de equipe com erro: aviso no painel e equipe padrão', async ($, on) => {
  world(on)
  on('session.cwd', async () => ({ value: 'D:/proj' }))
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async () => ({ value: '{ "papeis": [] }' }))
  const pane = await $.ui.mount(DESKTOP)

  await $.turn.start({ text: 'oi', turnId: 't-1' })

  expect(await pane.find({ type: 'Text', text: /pelo menos 1 papel/ })).toBeDefined()
  expect(String((await pane.find({ type: 'Svg' }))?.props.alt)).toContain('Dev Backend: livre')
  await pane.unmount()
})

test('o rodapé mostra a versão da cópia que a sessão carregou', async ($, on) => {
  world(on)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }) as never)
  on('command.register', async () => ({ value: {} }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('fs.read', async (_$, e) => ({ value: /plugin\.json$/.test(e.path) ? '{"version":"9.9.9"}' : '{}' }))
  const pane = await $.ui.mount(DESKTOP)

  await $.session.start({ cwd: 'D:/proj', surface: 'desktop', isInteractive: true } as never)

  expect(await pane.find({ type: 'Text', text: /Sala v9\.9\.9/ })).toBeDefined()
  await pane.unmount()
})

// --- 0.3.0: papel temporário, custo, histórico, resumo do dia, retrato, outros chats, aprovação ---

test('papel temporário: "Papel: tarefa" com um papel que a equipe não tem', async () => {
  const team = defaultTeam()
  const pick = (description: string, model = 'sonnet') => pickRole(team, {}, { model, type: '', description, prompt: '' })

  expect(pick('QA Android: testar o app').name).toBe('QA Android')
  expect(isTempRole(pick('QA Android: testar o app').id)).toBe(true)
  expect(pick('Analista de Dados: relatório mensal').name).toBe('Analista de Dados')
  // Papel que existe continua indo para a mesa dele.
  expect(pick('Dev Backend: resumir módulo').name).toBe('Dev Backend')
  expect(isTempRole(pick('dev-backend: resumir').id)).toBe(false)
  // Verbo, etapa ou código antes dos dois pontos não vira papel.
  for (const description of ['Atualizar: log de alterações', 'F5: gravação', 'Bug 12: travamento', 'Review: PR do player'])
    expect(isTempRole(pick(description).id)).toBe(false)
  expect(looksLikeRole('Segurança')).toBe(true)
  expect(looksLikeRole('revisar código')).toBe(false)
})

test('formatos de tokens, tempo e histórico', async () => {
  expect(fmtTokens(850)).toBe('850')
  expect(fmtTokens(1_700)).toBe('1,7 mil')
  expect(fmtTokens(123_400)).toBe('123 mil')
  expect(fmtTokens(2_500_000)).toBe('2,5 mi')
  expect(fmtDuration(40_000)).toBe('40 s')
  expect(fmtDuration(185_000)).toBe('3 min')
  expect(fmtDuration(3_900_000)).toBe('1 h 05')
  expect(
    trailText([
      { op: 'leu', what: 'a.md' },
      { op: 'editou', what: 'x.cs' },
      { op: 'leu', what: 'b.md' },
    ]),
  ).toBe('leu: b.md, a.md · editou: x.cs')
})

// Sessão completa de mentira: id, pasta, plugin.json, um outro chat e o link do painel.
function session(on: On, opts: { writes?: Map<string, string>; toasts?: string[]; argvs?: string[][]; os?: string } = {}) {
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, opts.os ? { USERPROFILE: 'C:/Users/T', OS: opts.os } : { USERPROFILE: 'C:/Users/T' })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('command.register', async () => ({ value: {} }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', async (_$, e) => (opts.toasts?.push(e.text), { value: undefined }) as never)
  // O findstr/grep do histórico devolve as linhas de título (o renomeado vence o gerado).
  on('process.run', async (_$, e) => {
    // O caminho velho (pasta antiga do chat) não existe mais: a busca não acha nada nele.
    opts.argvs?.push([...e.argv])
    const lookup = /findstr|grep/.test(String(e.argv[0])) && !/velho/.test(String(e.argv[e.argv.length - 1]))
    const stdout = lookup ? '{"type":"ai-title","aiTitle":"Gerado"}\n{"type":"custom-title","customTitle":"Meu chat"}\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '' } } as never
  })
  // Só o histórico novo existe; o caminho velho (pasta antiga do chat) não.
  on('fs.exists', async (_$, e) => ({ value: /\.jsonl$/.test(e.path) && !/velho/.test(e.path) }))
  on('fs.write', async (_$, e) => (opts.writes?.set(e.path, e.text), { value: undefined }) as never)
  on('fs.list', async () => ({
    value: [{ name: 'outro.json', kind: 'file' as const, size: 10, mtimeMs: 1_000, isLink: false }],
  }))
  on('fs.read', async (_$, e) => {
    if (/plugin\.json$/.test(e.path)) return { value: '{"version":"0.3.0"}' }
    if (/web\.json$/.test(e.path))
      return { value: '{"urls":["http://localhost:8787/?t=abc","http://192.168.0.10:8787/?t=abc"]}' }
    if (/outro\.json$/.test(e.path))
      return {
        value: JSON.stringify({
          v: 1,
          id: 'outro',
          title: 'Proposta no GitHub',
          project: 'loja-online',
          busy: 2,
          waiting: 1,
          tokens: 5_000,
          updatedAt: 1_000,
          ended: false,
          agents: [{ key: 'lead', title: 'Tech Lead', label: 'pensando' }],
        }),
      }
    throw new Error('ENOENT')
  })
  return clock
}

const USAGE = {
  input_tokens: 1_000,
  output_tokens: 500,
  cache_read_input_tokens: 9_000,
  cache_creation_input_tokens: 200,
  model: 'claude-sonnet-5-5',
}

test('custo, histórico, resumo do dia, outros chats, link do painel e retrato do chat', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = session(on, { writes })
  on('tool.call', async () => ({ result: 'ok' }) as never)
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5-5', agentId: 'ag-1' }))
  const pane = await $.ui.mount(DESKTOP)
  const text = async (pattern: RegExp) => (await pane.find({ type: 'Text', text: pattern }))?.text

  await $.session.start({ cwd: 'D:/proj', surface: 'desktop', isInteractive: true } as never)
  await $.agent.spawn(spawnArgs('1', 'QA Android: testar o app'))
  await $.tool.call({ tool: 'Edit', file_path: 'D:/app/Main.kt', agentId: 'ag-1' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'D:/app/README.md', agentId: 'ag-1' } as never)
  await clock.advance(120_000)
  await $.turn.complete({
    answer: 'ok',
    durationMs: 5_000,
    isAborted: false,
    turnId: 't-1',
    agentId: 'ag-1',
    reason: 'answer',
    usage: USAGE,
  })

  // Papel temporário com histórico e custo (1.000 + 500 + 200; a leitura de cache fica de fora).
  expect(await text(/\(temporário\)/)).toBeDefined()
  expect(await text(/leu: README\.md · editou: Main\.kt/)).toBeDefined()
  expect(String((await pane.find({ type: 'Svg' }))?.props.source)).toContain('1,7 mil tokens')
  expect(await text(/QA Android: 1 tarefa · 2 min · 1,7 mil tokens/)).toBeDefined()
  expect(await pane.find({ key: 'copy-day' })).toBeDefined()

  // Outros chats e o link do painel (o da rede antes do localhost).
  await clock.advance(10_000)
  expect(await text(/Proposta no GitHub/)).toBeDefined()
  expect(await text(/\(loja-online\)/)).toBeDefined()
  expect(await text(/Painel na rede: http:\/\/192\.168\.0\.10:8787/)).toBeDefined()
  expect(await pane.find({ key: 'copy-web' })).toBeDefined()

  // O retrato gravado para o painel e os outros chats.
  await clock.advance(1_600)
  const file = [...writes.keys()].find(path => /live[\\/]sess-1\.json$/.test(path))
  expect(file).toBeDefined()
  const snap = JSON.parse(writes.get(file ?? '') ?? '{}')
  expect(snap.id).toBe('sess-1')
  expect(snap.project).toBe('proj')
  expect(snap.version).toBe('0.3.0')
  expect(snap.tokens).toBe(1_700)
  expect(snap.agents.some((a: { title: string; temp: boolean }) => a.title === 'QA Android' && a.temp)).toBe(true)
  expect(snap.svg).toContain('<svg')
  expect(snap.title).toBe('Meu chat')
  await pane.unmount()
})

test('o texto do pedido do usuário não sai no retrato', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = session(on, { writes })
  await $.session.start({ cwd: 'D:/proj', surface: 'desktop', isInteractive: true } as never)
  await $.turn.start({ text: 'senha do roteador é 1234', turnId: 't-1' })
  await clock.advance(1_600)
  const raw = [...writes.values()].pop() ?? ''
  expect(raw).not.toContain('1234')
  expect(JSON.parse(raw).agents[0].task).toBe('')
})

test('aprovação: avisa e devolve o personagem ao trabalho quando a ferramenta passa a rodar', async ($, on) => {
  const toasts: string[] = []
  const clock = session(on, { toasts })
  let release = () => {}
  const gate = new Promise<void>(resolve => (release = resolve))
  on('tool.call', async () => {
    await gate
    return { result: 'ok' } as never
  })
  on('classic.PermissionRequest', async () => ({}) as never)
  // O app desenha a linha da ferramenta; aqui basta um texto.
  on('ui.render', { component: 'ToolUse' }, async ($, e) => $.ui.resolve(e).Text({ children: ['linha da ferramenta'] }))
  const pane = await $.ui.mount(DESKTOP)
  const alt = async () => String((await pane.find({ type: 'Svg' }))?.props.alt)
  await $.session.start({ cwd: 'D:/proj', surface: 'desktop', isInteractive: true } as never)

  const running = $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'tu-bash' } as never)
  await clock.advance(10)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' } } as never)
  expect(await alt()).toContain('Tech Lead: aguardando você')
  await clock.advance(1_600)
  expect(toasts.some(t => /Tech Lead aguarda sua aprovação: Bash/.test(t))).toBe(true)

  // A linha da ferramenta aparece parada (diálogo aberto) e depois rodando (aprovada).
  const row = (isRunning: boolean) => ({
    plugin: 'sala-agentes',
    surface: 'desktop' as const,
    component: 'ToolUse' as const,
    requestId: 'tu-bash',
    props: { tool_use_id: 'tu-bash', tool: 'Bash', input: { command: 'npm test' }, isRunning, isErrored: false, isInterrupted: false },
  })
  await (await $.ui.mount(row(false))).unmount()
  await (await $.ui.mount(row(true))).unmount()
  await clock.advance(1_600)
  expect(await alt()).toContain('Tech Lead: executando ($ npm test)')

  release()
  await running
  await pane.unmount()
})

test('título do chat: o renomeado vence o gerado, linhas estranhas são ignoradas', async () => {
  const lines = [
    '{"type":"ai-title","aiTitle":"Primeiro"}',
    '{"parentUuid":"x","type":"assistant","message":"... type\\":\\"custom-title ..."}',
    '{"type":"custom-title","customTitle":"Teste de queda da F4"}',
    'lixo {"type":"custom-title"',
    '{"type":"ai-title","aiTitle":"Último gerado"}',
  ].join('\r\n')
  expect(pickTitle(lines)).toBe('Teste de queda da F4')
  expect(pickTitle('{"type":"ai-title","aiTitle":"Só gerado"}')).toBe('Só gerado')
  expect(pickTitle('')).toBe('')
})

test('título do chat: caminho velho do histórico (chat mudou de pasta) não impede achar o título', async ($, on) => {
  const writes = new Map<string, string>()
  const clock = session(on, { writes })
  on('classic.Stop', async () => ({}) as never)
  await $.session.start({ cwd: 'D:/proj', surface: 'desktop', isInteractive: true } as never)
  await $.classic.Stop({ stop_hook_active: false, transcript_path: 'C:/velho/sess-1.jsonl' } as never)
  await clock.advance(10_000)
  await clock.advance(1_600)
  const raw = [...writes.values()].pop() ?? '{}'
  expect(JSON.parse(raw).title).toBe('Meu chat')
})

// --- 0.4.0: mesas fixas (adicionar/tirar) e aviso ao Tech Lead ---

test('mesas: adicionar, tirar, diferença entre formações e arquivo a partir da equipe', async () => {
  const file = teamToFile(defaultTeam())
  expect((file.papeis as unknown[]).length).toBe(5)
  const added = addRoleTo(file, { nome: 'Dev Mobile', modelo: 'Sonnet', palavras: ['android', 'ios'] })
  expect(parseTeam(JSON.stringify(added), 'x').roles.map(r => r.name)).toContain('Dev Mobile')
  expect(() => addRoleTo(added, { nome: 'dev mobile' })).toThrow('já existe a mesa')
  expect(() => addRoleTo(file, { nome: '' })).toThrow('falta o nome')
  expect(() => addRoleTo(file, { nome: 'Dev Rust', modelo: 'GPT' })).toThrow('modelo "GPT" desconhecido')
  let full = file
  for (let i = 0; i < 6; i++) full = addRoleTo(full, { nome: `Mesa ${i}` })
  expect(() => addRoleTo(full, { nome: 'Mesa 12' })).toThrow('o máximo')
  const removed = removeRoleFrom(added, 'DEV MOBILE')
  expect((removed.papeis as unknown[]).length).toBe(5)
  expect(() => removeRoleFrom(file, 'Ninguém')).toThrow('não existe a mesa')
  expect(() => removeRoleFrom({ papeis: [{ nome: 'QA' }] }, 'QA')).toThrow('pelo menos 1 mesa')

  const before = parseTeam(JSON.stringify(file), 'x')
  const after = parseTeam(JSON.stringify(removeRoleFrom(addRoleTo(file, { nome: 'Dev Mobile', modelo: 'Sonnet' }), 'QA')), 'x')
  const diff = teamDiff(before, after)
  expect(diff.added.map(roleLabel)).toEqual(['Dev Mobile (Sonnet)'])
  expect(diff.removed.map(r => r.name)).toEqual(['QA'])
  expect(diff.changed).toEqual([])
})

// Sessão com o arquivo da equipe do projeto em memória (o teste troca o conteúdo).
function teamSession(on: On, store: { file?: string; writes: string[] }, cwd = 'D:/proj') {
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { USERPROFILE: 'C:/Users/T' })
  const session = mock.session(on)
  const project = /proj.\.claude.sala-agentes\.json$/
  on('session.start', async (_$, e) => ({ cwd: e.cwd }) as never)
  on('session.id', async () => ({ value: 'sess-1' }))
  on('session.cwd', async () => ({ value: cwd }))
  on('command.register', async () => ({ value: {} }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('fs.list', async () => ({ value: [] }))
  on('fs.exists', async (_$, e) => ({ value: project.test(e.path) && store.file !== undefined }))
  on('fs.read', async (_$, e) => {
    if (project.test(e.path) && store.file !== undefined) return { value: store.file }
    throw new Error('ENOENT')
  })
  on('fs.write', async (_$, e) => {
    if (project.test(e.path)) {
      store.file = e.text
      store.writes.push(e.text)
    }
    return { value: undefined } as never
  })
  return { clock, session }
}

test('mesa nova no arquivo da equipe: o Tech Lead recebe a nova formação na conversa', async ($, on) => {
  const store: { file?: string; writes: string[] } = {
    file: JSON.stringify({ papeis: [{ nome: 'QA', modelo: 'Haiku' }, { nome: 'Dev Backend', modelo: 'Sonnet' }] }),
    writes: [],
  }
  const { clock, session } = teamSession(on, store)
  await $.session.start({ cwd: 'D:/proj', surface: 'desktop', isInteractive: true } as never)
  await clock.advance(10_000)
  // A primeira leitura só carrega a equipe: nada de aviso.
  expect(session.appended().length).toBe(0)

  store.file = JSON.stringify({
    papeis: [{ nome: 'QA', modelo: 'Haiku' }, { nome: 'Dev Backend', modelo: 'Sonnet' }, { nome: 'Dev Mobile', modelo: 'Sonnet' }],
  })
  await clock.advance(10_000)
  const texts = session.appended().map(row => JSON.stringify(row.message.content))
  expect(texts.length).toBe(1)
  expect(texts[0]).toContain('Entrou: Dev Mobile (Sonnet)')
  expect(texts[0]).toContain('Formação atual: Tech Lead (Opus, você); QA (Haiku); Dev Backend (Sonnet); Dev Mobile (Sonnet)')
  expect(texts[0]).toContain('Papel: tarefa')
})

test('/sala mesa + e - editam a equipe do projeto e avisam o Tech Lead', async ($, on) => {
  const store: { file?: string; writes: string[] } = { writes: [] }
  const { session } = teamSession(on, store)
  await $.session.start({ cwd: 'D:/proj', surface: 'desktop', isInteractive: true } as never)
  const run = (args: string) => $.command.run({ command: 'sala', args } as never)

  // Sem arquivo do projeto: cria a partir da equipe em uso (a padrão, 5 mesas) e acrescenta.
  const add = await run('mesa + Dev Mobile | Sonnet | android, ios | Mobile')
  expect(add.text).toContain('Equipe salva')
  const saved = JSON.parse(store.file ?? '{}') as { papeis: { nome: string; palavras: string[]; apelidos?: string[] }[] }
  expect(saved.papeis.length).toBe(6)
  expect(saved.papeis[5]).toEqual({ nome: 'Dev Mobile', modelo: 'Sonnet', palavras: ['android', 'ios'], apelidos: ['Mobile'] })
  // Palavras numa linha só, fácil de editar à mão.
  expect(store.file).toContain('"palavras": ["android", "ios"]')
  expect(session.appended().some(row => JSON.stringify(row.message.content).includes('Entrou: Dev Mobile (Sonnet)'))).toBe(true)

  expect((await run('mesa + QA | Haiku')).text).toContain('já existe a mesa "QA"')
  const remove = await run('mesa - dev mobile')
  expect(remove.text).toContain('Equipe salva')
  expect(JSON.parse(store.file ?? '{}').papeis.length).toBe(5)
  expect(session.appended().some(row => JSON.stringify(row.message.content).includes('Saiu: Dev Mobile'))).toBe(true)
  expect((await run('mesas')).text).toContain('/sala mesa + Nome | Modelo')
})

test('título no Windows: o findstr recebe o caminho só com barras invertidas', async ($, on) => {
  const writes = new Map<string, string>()
  const argvs: string[][] = []
  const clock = session(on, { writes, argvs, os: 'Windows_NT' })
  await $.session.start({ cwd: 'D:/proj', surface: 'desktop', isInteractive: true } as never)
  await clock.advance(1_600)
  const findstr = argvs.find(argv => argv[0] === 'findstr')
  expect(findstr).toBeDefined()
  expect(findstr?.[findstr.length - 1]).toBe('C:\\Users\\T\\.claude\\projects\\D--proj\\sess-1.jsonl')
  expect(JSON.parse([...writes.values()].pop() ?? '{}').title).toBe('Meu chat')
})

test('equipe do projeto: procura na pasta atual e nas de cima, sem entrar na pasta pessoal', async () => {
  expect(teamDirs('D:\\Sala\\plugin', 'D:\\Sala', 'C:/Users/T')).toEqual(['D:\\Sala\\plugin', 'D:\\Sala', 'D:'])
  expect(teamDirs('C:/Users/T/proj/src', '', 'C:\\Users\\T\\')).toEqual(['C:/Users/T/proj/src', 'C:/Users/T/proj'])
  expect(teamDirs('', 'D:/proj', '')).toEqual(['D:/proj', 'D:'])
})

test('guia da sala: o Tech Lead recebe a equipe e como delegar no começo da conversa', async ($, on) => {
  const store: { file?: string; writes: string[] } = {
    file: JSON.stringify({ papeis: [{ nome: 'QA', modelo: 'Haiku', palavras: ['test'] }, { nome: 'Dev Mobile', modelo: 'Sonnet', palavras: ['android', 'ios'] }] }),
    writes: [],
  }
  // Numa subpasta do projeto: a equipe vem do arquivo da pasta de cima.
  teamSession(on, store, 'D:/proj/app')
  on('prompt.context', async (_$, e) => ({ blocks: e.blocks }))
  const result = await $.prompt.context({ blocks: [{ name: 'currentDate', text: 'hoje' }] })
  expect(result.blocks.map(b => b.name)).toEqual(['currentDate', GUIDE_BLOCK])
  const text = result.blocks[1]?.text ?? ''
  expect(text).toContain('Você é o Tech Lead (Opus)')
  expect(text).toContain('- Dev Mobile (Sonnet): android, ios')
  expect(text).toContain('"Papel: tarefa curta"')
  expect(text).toContain('Pedido pequeno')
  expect(text).toContain('ignore este guia')
  // A entrega fica nos eventos da sala (e no retrato do painel), para conferir num chat novo.
  const pane = await $.ui.mount(DESKTOP)
  expect(await pane.find({ type: 'Text', text: /guia da sala entregue ao Tech Lead \(2 mesas\)/ })).toBeTruthy()
  await pane.unmount()

  // "orientar": false desliga o guia; o arquivo regravado pela sala guarda a escolha.
  store.file = JSON.stringify({ orientar: false, papeis: [{ nome: 'QA', modelo: 'Haiku' }] })
  const off = await $.prompt.context({ blocks: [{ name: 'currentDate', text: 'hoje' }] })
  expect(off.blocks.map(b => b.name)).toEqual(['currentDate'])
  expect(teamToFile(parseTeam(store.file, 'x')).orientar).toBe(false)
  expect(teamToFile(defaultTeam()).orientar).toBeUndefined()
})
