import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, Daily, LogLine, OtherChat, Team, TrailItem } from '../types'
import { addDay, buildSnapshot, dayText, pickTitle, summarizeOther, today } from './live'
import {
  activityFor,
  detailFor,
  emptyLead,
  fmtDuration,
  fmtTime,
  fmtTokens,
  renderSvg,
  roster,
  STATUS,
  summary,
  titles,
  trailText,
} from './room'
import type { TeamDiff } from './team'
import {
  addRoleTo,
  clip,
  defaultTeam,
  exampleFile,
  formatTeamFile,
  LEAD,
  loadByRole,
  parseTeam,
  pickRole,
  removeRoleFrom,
  roleLabel,
  seatAgent,
  shortModel,
  stripBom,
  TEAM_FILE,
  teamDiff,
  teamDirs,
  teamToFile,
} from './team'
import { GUIDE_BLOCK, guideText } from './guide'

const PANE = 'sala-agentes'
const TITLE = 'Sala dos Agentes'
// Agente "concluído" sai da sala depois disso.
const DONE_MS = 15_000
// Outros chats sem sinal há mais que isso somem da lista.
const OTHERS_MAX_AGE = 6 * 3_600_000
// Retrato regravado mesmo sem mudança, para o painel saber que o chat segue aberto.
const HEARTBEAT_MS = 60_000
const TRAIL_MAX = 30
const ORANGE = '#E16B01'
const GREEN = '#54B45F'
const FAINT = '#6F695F'

const agents = atom({ plugin: 'sala-agentes', key: 'agents' } as const, { [LEAD]: emptyLead() } as Record<string, AgentRow>)
const log = atom({ plugin: 'sala-agentes', key: 'log' } as const, [] as LogLine[])
const team = atom({ plugin: 'sala-agentes', key: 'team' } as const, defaultTeam())
const version = atom({ plugin: 'sala-agentes', key: 'version' } as const, '')
const daily = atom({ plugin: 'sala-agentes', key: 'daily' } as const, { date: '', roles: [] } as Daily)
const others = atom({ plugin: 'sala-agentes', key: 'others' } as const, [] as OtherChat[])
const web = atom({ plugin: 'sala-agentes', key: 'web' } as const, [] as string[])
const tick = atom({ plugin: 'sala-agentes', key: 'tick' } as const, 0)
const teamSeen = atom({ plugin: 'sala-agentes', key: 'teamSeen' } as const, false)

type $ = EngineInterface

// Este chat (refeito no session.start de cada recarga do módulo).
const here = { id: '', project: '', cwd: '', home: '', startedAt: 0, ended: false, wroteAt: 0, transcript: '', title: '', titleAt: 0 }
// Algo mudou desde o último retrato gravado.
let dirty = true
// Avisos de "aguardando você" a mostrar no próximo ciclo (toast + som).
const alerts: string[] = []
// Chamada → quem a fez, para devolver o personagem ao trabalho depois da aprovação.
const calls = new Map<string, { agent: string; tool: string; detail: string }>()
// Chamadas com diálogo de permissão aberto; true depois que a linha da ferramenta apareceu parada.
const awaiting = new Map<string, boolean>()
// Chamadas cuja linha passou de parada para rodando: o diálogo foi respondido.
const approved = new Set<string>()

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

// Histórico (JSONL) da sessão; o Stop traz o caminho exato, este é o palpite até lá.
function transcriptGuess(): string {
  return `${here.home}/.claude/projects/${here.cwd.replace(/[^A-Za-z0-9]/g, '-')}/${here.id}.jsonl`
}

// Título do chat (o mesmo da barra lateral do app), lido do histórico no máximo a cada minuto.
async function readTitle($: $) {
  const now = await $.clock.now()
  if (!here.id || now - here.titleAt < 60_000) return
  here.titleAt = now
  // O caminho do Stop pode ficar velho quando o chat muda de pasta (o histórico vai junto):
  // tenta cada candidato. Sem $.fs.exists aqui: a pasta dos históricos não é dos plugins, só a
  // busca do sistema (findstr/grep) a enxerga; caminho que não existe só não acha nada.
  const paths = [...new Set([transcriptGuess(), here.transcript].filter(Boolean))]
  let found = ''
  let windows = false
  try {
    windows = (await $.env.get('OS')) === 'Windows_NT'
  } catch {}
  for (const path of paths) {
    // Sem aspas no padrão (o findstr do Windows se perde com elas): "." casa com as aspas do JSON.
    // E só barras invertidas no caminho: o findstr lê "/" como início de opção e corta o caminho.
    const argv = windows
      ? ['findstr', '/R', '/C:type.:.custom-title', '/C:type.:.ai-title', path.replace(/\//g, '\\')]
      : ['grep', '-E', 'type":"(custom|ai)-title"', path]
    try {
      found = pickTitle((await $.process.run(argv, { timeoutMs: 10_000 })).stdout)
    } catch {}
    if (found) {
      here.transcript = path
      break
    }
  }
  if (found && found !== here.title) {
    here.title = found
    dirty = true
  }
}

function liveDir(): string {
  return `${here.home}/.claude/sala-agentes/live`
}

async function homeDir($: $): Promise<string> {
  try {
    return (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
  } catch {
    return ''
  }
}

// Arquivo da equipe do projeto: `found`, o que existe na pasta atual ou numa de cima (entrar numa
// subpasta não troca a equipe); `target`, onde criar um novo (a pasta em que o chat abriu).
async function projectFile($: $): Promise<{ found?: string; target?: string }> {
  let cwd = ''
  try {
    cwd = await $.session.cwd()
  } catch {}
  const home = here.home || (await homeDir($))
  const dirs = teamDirs(cwd, here.cwd, home)
  for (const dir of dirs) {
    const path = `${dir}/.claude/${TEAM_FILE}`
    try {
      if (await $.fs.exists(path)) return { found: path, target: path }
    } catch {}
  }
  const root = here.cwd || cwd
  return root ? { target: `${root}/.claude/${TEAM_FILE}` } : {}
}

// Versão da cópia carregada, mostrada no rodapé e no retrato.
async function readVersion($: $) {
  try {
    const raw: unknown = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
    const found = typeof raw === 'object' && raw !== null && 'version' in raw ? raw.version : undefined
    const next = typeof found === 'string' ? found : ''
    if (next !== (await read($, version))) await update($, version, () => next)
  } catch {}
}

// Equipe: .claude/sala-agentes.json do projeto, senão ~/.claude/sala-agentes.json, senão a padrão.
async function findTeam($: $): Promise<Team> {
  const places: string[] = []
  const { found } = await projectFile($)
  if (found) places.push(found)
  const home = here.home || (await homeDir($))
  if (home) places.push(`${home}/.claude/${TEAM_FILE}`)
  for (const path of places) {
    let text: string
    try {
      if (path !== found && !(await $.fs.exists(path))) continue
      text = await $.fs.read(path)
    } catch {
      continue
    }
    try {
      return parseTeam(text, path)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      return { ...defaultTeam(), warning: `${path}: ${why}. Usando a equipe padrão.` }
    }
  }
  return defaultTeam()
}

async function refreshTeam($: $) {
  try {
    const next = await findTeam($)
    const prev = await read($, team)
    const seen = await read($, teamSeen)
    if (!seen) await update($, teamSeen, () => true)
    if (JSON.stringify(prev) === JSON.stringify(next)) return
    await update($, team, () => next)
    dirty = true
    // A primeira leitura da sessão só carrega a equipe; mudanças depois disso avisam o Tech Lead.
    if (!seen) return
    const diff = teamDiff(prev, next)
    if (diff.added.length + diff.removed.length + diff.changed.length > 0) await announceTeam($, next, diff)
  } catch {}
}

// Mesa adicionada ou tirada (pelo /sala mesa, pelo painel web ou à mão no arquivo): o Tech Lead
// recebe a nova formação na conversa, para delegar com ela já no próximo passo.
async function announceTeam($: $, t: Team, diff: TeamDiff) {
  const parts: string[] = []
  if (diff.added.length > 0) parts.push(`Entrou: ${diff.added.map(roleLabel).join(', ')}.`)
  if (diff.removed.length > 0) parts.push(`Saiu: ${diff.removed.map(r => r.name).join(', ')}.`)
  if (diff.changed.length > 0) parts.push(`Trocou de modelo: ${diff.changed.map(roleLabel).join(', ')}.`)
  const roster = [`${t.lead.name} (${t.lead.model}, você)`, ...t.roles.map(roleLabel)].join('; ')
  const text = [
    `[Sala dos Agentes] A equipe deste projeto mudou${t.source === 'padrão' ? '' : ` (${t.source})`}. ${parts.join(' ')}`,
    `Formação atual: ${roster}.`,
    'Use essa formação ao delegar: descrição do Agent no formato "Papel: tarefa", prompt começando com "Você é o <Papel>…" e o modelo da mesa. Assim cada agente senta na mesa certa da sala.',
  ].join('\n')
  try {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
  } catch {}
  await note($, `equipe: ${parts.join(' ')}`)
  $.ui.toast(`Sala: equipe atualizada. ${parts.join(' ')}`, { timeoutMs: 8_000 })
}

// "/sala mesa + Nome | Modelo | palavras | apelidos" e "/sala mesa - Nome": edita a equipe do projeto
// (cria o arquivo a partir da equipe em uso se ainda não existir) e avisa o Tech Lead.
async function editTeam($: $, sign: string, rest: string): Promise<string> {
  const { found, target: path } = await projectFile($)
  if (!path) return 'Não achei a pasta do projeto.'
  let file: Record<string, unknown>
  try {
    file = found ? (JSON.parse(stripBom(await $.fs.read(found))) as Record<string, unknown>) : teamToFile(await read($, team))
  } catch {
    return `Não mudei a equipe: ${path} não é um JSON válido. Corrija o arquivo primeiro.`
  }
  try {
    if (sign === '+') {
      const [nome = '', modelo = '', palavras = '', apelidos = ''] = rest.split('|').map(part => part.trim())
      const split = (text: string) => text.split(',').map(w => w.trim()).filter(Boolean)
      file = addRoleTo(file, { nome, modelo, palavras: split(palavras), apelidos: split(apelidos) })
    } else {
      file = removeRoleFrom(file, rest)
    }
  } catch (err) {
    return `Não mudei a equipe: ${err instanceof Error ? err.message : String(err)}.`
  }
  await $.fs.write(path, formatTeamFile(file) + '\n')
  await refreshTeam($)
  const t = await read($, team)
  return `Equipe salva em ${path}. Mesas: ${t.roles.map(roleLabel).join(', ')}.`
}

async function patch($: $, id: string, fn: (a: AgentRow, now: number) => AgentRow) {
  const now = await $.clock.now()
  await update($, agents, (m: Record<string, AgentRow>) => {
    const cur = m[id]
    return cur ? { ...m, [id]: fn(cur, now) } : m
  })
  dirty = true
}

async function note($: $, text: string) {
  const at = await $.clock.now()
  await update($, log, (l: LogLine[]) => [...l, { at, text }].slice(-40))
  dirty = true
}

async function addToDay($: $, role: string, add: { tasks: number; ms: number; tokens: number }) {
  const now = await $.clock.now()
  await update($, daily, (d: Daily) => addDay(d, now, role, add))
  dirty = true
}

async function nameOf($: $, id: string): Promise<string> {
  return titles(await read($, team), await read($, agents))[id] ?? 'Agente'
}

// Tokens novos do turno: entrada, gravação de cache e saída (a leitura de cache custa ~10% e fica de fora).
function spent(usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number } | undefined): number {
  return usage ? usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens : 0
}

function trailFor(tool: string, detail: string): TrailItem | undefined {
  if (/^(Read|NotebookRead)$/.test(tool)) return { op: 'leu', what: detail }
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return { op: 'editou', what: detail }
  if (/^(Bash|PowerShell)$/.test(tool)) return { op: 'rodou', what: clip(detail.replace(/^\$ /, ''), 40) }
  if (/^(Grep|Glob)$/.test(tool)) return { op: 'buscou', what: clip(detail.replace(/^busca: /, ''), 30) }
  if (/^(WebFetch|WebSearch)$/.test(tool) || /^mcp__(Claude_Browser|claude-in-chrome)__/.test(tool))
    return { op: 'abriu', what: clip(detail.replace(/^pesquisa: /, ''), 40) }
  if (/^(Agent|Task)$/.test(tool)) return { op: 'delegou', what: clip(detail.replace(/^→ /, ''), 40) }
  return undefined
}

function pushTrail(trail: TrailItem[] | undefined, item: TrailItem | undefined): TrailItem[] {
  const list = trail ?? []
  const last = list[list.length - 1]
  if (!item || (last && last.op === item.op && last.what === item.what)) return list
  return [...list, item].slice(-TRAIL_MAX)
}

// Agente que não passou pelo agent.spawn (ex.: de workflow) ganha mesa na primeira chamada.
async function ensure($: $, agentId: string | undefined): Promise<string> {
  if (!agentId) return LEAD
  const m = await read($, agents)
  if (m[agentId]) return agentId
  const t = await read($, team)
  const role = pickRole(t, loadByRole(m), { model: '', type: '', description: '', prompt: '' })
  const now = await $.clock.now()
  const row: AgentRow = {
    id: agentId,
    role: role.id,
    roleName: role.name,
    model: role.model,
    activity: 'pensando',
    detail: '',
    task: 'agente auxiliar',
    call: '',
    since: now,
    born: now,
    desk: -1,
    parent: '',
    tokens: 0,
    taskStart: now,
    trail: [],
  }
  await update($, agents, (cur: Record<string, AgentRow>) => (cur[agentId] ? cur : seatAgent(cur, row)))
  dirty = true
  return agentId
}

async function waiting($: $, id: string, text: string) {
  const name = await nameOf($, id)
  await note($, `${name} ${text}`)
  alerts.push(`✋ ${name} ${text}`)
}

async function sweep($: $) {
  const now = await $.clock.now()
  const stale = Object.values(await read($, agents)).filter(
    a => a.id !== LEAD && a.activity === 'concluido' && now - a.since > DONE_MS,
  )
  if (stale.length === 0) return
  await update($, agents, (cur: Record<string, AgentRow>) => {
    const next = { ...cur }
    for (const a of stale) if (next[a.id]?.activity === 'concluido') delete next[a.id]
    return next
  })
  dirty = true
}

async function reset($: $) {
  await update($, agents, () => ({ [LEAD]: emptyLead() }))
  await update($, log, () => [])
  dirty = true
}

// Som de notificação do Windows (o app desktop não toca os clipes do plugin no Windows).
async function beep($: $) {
  try {
    if ((await $.env.get('OS')) !== 'Windows_NT') return
    await $.process.run(
      [
        'powershell.exe',
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle',
        'Hidden',
        '-Command',
        "(New-Object Media.SoundPlayer 'C:\\Windows\\Media\\Windows Notify System Generic.wav').PlaySync()",
      ],
      { timeoutMs: 10_000 },
    )
  } catch {}
}

// Diálogo respondido: quem estava "aguardando você" volta ao que a ferramenta faz.
async function settleApprovals($: $) {
  for (const call of [...approved]) {
    approved.delete(call)
    const info = calls.get(call)
    if (!info) continue
    await patch($, info.agent, (a, now) =>
      a.activity === 'aprovacao' && a.call === call ? { ...a, activity: activityFor(info.tool), detail: info.detail, since: now } : a,
    )
  }
}

async function writeSnapshot($: $, ended: boolean) {
  if (!here.id || !here.home) return
  const now = await $.clock.now()
  const snap = buildSnapshot({
    id: here.id,
    title: here.title,
    project: here.project,
    cwd: here.cwd,
    startedAt: here.startedAt,
    now,
    ended,
    version: await read($, version),
    team: await read($, team),
    agents: await read($, agents),
    log: await read($, log),
    daily: await read($, daily),
  })
  await $.fs.write(`${liveDir()}/${here.id}.json`, JSON.stringify(snap))
  here.wroteAt = now
}

// A cada 1,5 s: aprovações respondidas, avisos pendentes e o retrato para o painel e os outros chats.
async function flush($: $) {
  try {
    await settleApprovals($)
  } catch {}
  if (alerts.length > 0) {
    for (const text of alerts.splice(0)) $.ui.toast(text, { timeoutMs: 8_000 })
    void beep($)
  }
  if (here.ended) return
  const now = await $.clock.now()
  if (!dirty && now - here.wroteAt < HEARTBEAT_MS) return
  dirty = false
  try {
    await writeSnapshot($, false)
  } catch {
    dirty = true
  }
}

// A cada 10 s: o resumo dos outros chats e o link do painel na rede.
async function scan($: $) {
  if (!here.home) return
  await readTitle($)
  // Mudanças na equipe feitas fora deste chat (painel web, outro chat, à mão) valem em até 10 s.
  await refreshTeam($)
  const now = await $.clock.now()
  const found: OtherChat[] = []
  try {
    for (const f of await $.fs.list(liveDir())) {
      if (f.kind !== 'file' || !f.name.endsWith('.json') || f.name === `${here.id}.json`) continue
      if (now - f.mtimeMs > OTHERS_MAX_AGE) continue
      try {
        const other = summarizeOther(JSON.parse(await $.fs.read(`${liveDir()}/${f.name}`)))
        if (other) found.push(other)
      } catch {}
    }
  } catch {}
  found.sort((a, b) => b.waiting - a.waiting || b.busy - a.busy || b.updatedAt - a.updatedAt)
  const next = found.slice(0, 6)
  if (JSON.stringify(next) !== JSON.stringify(await read($, others))) await update($, others, () => next)

  let urls: string[] = []
  try {
    const raw: unknown = JSON.parse(stripBom(await $.fs.read(`${here.home}/.claude/sala-agentes/web.json`)))
    const list = typeof raw === 'object' && raw !== null && 'urls' in raw && Array.isArray(raw.urls) ? raw.urls : []
    urls = list.filter((u): u is string => typeof u === 'string')
    // Links da rede antes do localhost.
    urls.sort((a, b) => Number(a.includes('localhost')) - Number(b.includes('localhost')))
  } catch {}
  if (JSON.stringify(urls) !== JSON.stringify(await read($, web))) await update($, web, () => urls)
}

async function copyDay($: $, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
  const result = await $.ui.copy({ text: dayText(await read($, daily), here.project), surface })
  $.ui.toast(result.isCopied ? 'Resumo do dia copiado.' : 'Não consegui copiar o resumo.')
}

async function copyLink($: $, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface']) {
  const url = (await read($, web))[0]
  if (!url) return
  const result = await $.ui.copy({ text: url, surface })
  $.ui.toast(result.isCopied ? 'Link do painel copiado.' : 'Não consegui copiar o link.')
}

function sinceText(now: number, start: number, activity: string): string {
  if (start <= 0 || activity === 'livre' || activity === 'ocioso' || activity === 'concluido') return ''
  return `há ${fmtDuration(now - start)}`
}

// Os hooks só observam: o .catch(next) deixa o evento seguir se um deles falhar
// (um next já chamado é repetido, nada roda duas vezes).
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    here.home = await homeDir($)
    here.cwd = e.cwd
    here.project = baseName(e.cwd)
    here.startedAt = await $.clock.now()
    here.ended = false
    here.titleAt = Number.NEGATIVE_INFINITY
    try {
      here.id = await $.session.id()
    } catch {}
    dirty = true
    await readVersion($)
    await refreshTeam($)
    await $.command.register({
      name: 'sala',
      description: 'Abre a Sala dos Agentes; "/sala mesas" lista e edita as mesas, "/sala guia", "/sala resumo", "/sala painel"',
      argumentHint: '[mesas|mesa + Nome | Modelo | palavras|mesa - Nome|equipe|guia|resumo|painel]',
    })
    void $.ui.open({ id: PANE, title: TITLE })
    // Relógios da sala: um ciclo que falhar (sessão encerrando, recarga) só espera o próximo.
    const quiet = (work: () => Promise<unknown>) => () => void work().catch(() => {})
    $.clock.every(5_000, quiet(() => sweep($)))
    $.clock.every(1_500, quiet(() => flush($)))
    $.clock.every(10_000, quiet(() => scan($)))
    $.clock.every(
      15_000,
      quiet(async () => {
        const now = await $.clock.now()
        await update($, tick, () => now)
      }),
    )
    quiet(() => scan($))()

    return next(e)
  })

  // Começo de cada conversa (e de novo depois de /clear ou compactação): o Tech Lead recebe o guia
  // da sala com a equipe do projeto, para delegar às mesas sem o usuário pedir. A equipe é lida na
  // hora: este evento pode chegar antes do session.start.
  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    const t = await findTeam($)
    if (!t.guide) return result
    const blocks = result.blocks.filter(b => b.name !== GUIDE_BLOCK)
    try {
      await note($, `guia da sala entregue ao ${t.lead.name} (${t.roles.length} mesas)`)
    } catch {}
    return { ...result, blocks: [...blocks, { name: GUIDE_BLOCK, text: guideText(t) }] }
  }).catch(($, e, next) => next(e))

  // Fim de um turno do chat: o Stop traz o caminho exato do histórico; o título pode ter mudado.
  on('classic.Stop', async ($, e, next) => {
    if (e.transcript_path) here.transcript = e.transcript_path
    here.titleAt = Number.NEGATIVE_INFINITY
    return next(e)
  }).catch(($, e, next) => next(e))

  // Chat encerrado: o retrato fica marcado; num /clear a sala recomeça com a conversa nova.
  on('session.end', async ($, e, next) => {
    try {
      await writeSnapshot($, true)
    } catch {}
    const result = await next(e)
    if (e.reason === 'clear') {
      try {
        here.id = await $.session.id()
        here.transcript = ''
        here.title = ''
        here.titleAt = Number.NEGATIVE_INFINITY
        here.startedAt = await $.clock.now()
        await reset($)
        await update($, daily, () => ({ date: '', roles: [] }))
      } catch {}
    } else {
      here.ended = true
    }
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'sala' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'equipe') {
      const { found, target: path } = await projectFile($)
      if (found) return { text: `A equipe deste projeto já existe: ${found}` }
      if (!path) return { text: 'Não achei a pasta do projeto.' }
      await $.fs.write(path, exampleFile() + '\n')
      await refreshTeam($)
      return { text: `Criei ${path} com a equipe padrão. Edite os papéis; vale no próximo pedido.` }
    }
    if (arg === 'guia') {
      const t = await findTeam($)
      if (!t.guide) return { text: 'O guia da sala está desligado neste projeto ("orientar": false no arquivo da equipe).' }
      return { text: `Guia que o Tech Lead recebe no começo de cada conversa:\n\n${guideText(t)}` }
    }
    if (arg === 'resumo') {
      const d = await read($, daily)
      if (d.roles.length === 0) return { text: 'Ainda não há tarefas concluídas hoje neste chat.' }
      return { text: dayText(d, here.project) }
    }
    const mesa = /^mesa\s*([+-])\s*(.+)$/i.exec(arg)
    if (mesa) return { text: await editTeam($, mesa[1] ?? '+', mesa[2] ?? '') }
    if (arg === 'mesas') {
      const t = await read($, team)
      const where = t.source === 'padrão' ? 'equipe padrão' : t.source
      return {
        text: [
          `Mesas (${where}): ${t.roles.map(roleLabel).join(', ')}.`,
          'Adicionar: /sala mesa + Nome | Modelo | palavra, palavra | apelido',
          'Tirar: /sala mesa - Nome',
        ].join('\n'),
      }
    }
    if (arg === 'painel') {
      const urls = await read($, web)
      if (urls.length === 0) return { text: 'O painel na rede ainda não está ligado (não achei o web.json do servidor).' }
      return { text: `Painel na rede (todas as salas, ao vivo):\n${urls.map(u => `- ${u}`).join('\n')}` }
    }
    await refreshTeam($)
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    const t = await read($, team)
    const where = t.source === 'padrão' ? 'equipe padrão' : `equipe de ${t.source}`
    if (!opened.isPlaced) return { text: 'A sala não coube: alargue a janela.' }
    return { text: `Sala dos Agentes aberta (${where}).${t.warning ? ` Aviso: ${t.warning}` : ''}` }
  })

  // Pedido novo do usuário: relê a equipe e o líder começa a pensar.
  on('turn.start', async ($, e, next) => {
    try {
      await refreshTeam($)
      const text = e.text.trim()
      await patch($, LEAD, (a, now) => ({
        ...a,
        activity: 'pensando',
        detail: '',
        task: text ? clip(text, 80) : a.task,
        call: '',
        since: now,
        taskStart: now,
        trail: [],
      }))
      if (text) await note($, `pedido: ${clip(text, 70)}`)
    } catch {}

    return next(e)
  })

  // Fim de um turno: soma os tokens, e o subagente que terminou vira "concluído".
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      const used = spent(e.usage)
      if (!e.agentId) {
        await patch($, LEAD, (a, now) => ({
          ...a,
          activity: 'ocioso',
          detail: e.isAborted ? 'interrompido' : 'aguardando seu pedido',
          call: '',
          since: now,
          tokens: (a.tokens ?? 0) + used,
        }))
        await addToDay($, (await read($, team)).lead.name, { tasks: 1, ms: e.durationMs, tokens: used })
      } else {
        const id = e.agentId
        const row = (await read($, agents))[id]
        if (row) {
          const name = await nameOf($, id)
          const now = await $.clock.now()
          await patch($, id, (a, at) => ({
            ...a,
            activity: 'concluido',
            detail: e.isAborted ? 'interrompido' : 'entregou',
            call: '',
            since: at,
            tokens: (a.tokens ?? 0) + used,
          }))
          const took = fmtDuration(now - (row.taskStart ?? row.born))
          const cost = used > 0 ? `, ${fmtTokens(used)} tokens` : ''
          await note($, `${name} ${e.isAborted ? 'interrompido' : 'concluiu'} (${took}${cost}): ${clip(row.task, 50)}`)
          await addToDay($, row.roleName, { tasks: 1, ms: now - (row.taskStart ?? row.born), tokens: used })
        }
      }
    } catch {}

    return result
  })

  // Subagente nasce: escolhe o papel (ou cria um temporário) e a mesa (a do papel ou uma extra).
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    try {
      const agentId = result.agentId
      if (agentId) {
        const t = await read($, team)
        const role = pickRole(t, loadByRole(await read($, agents)), {
          model: result.model ?? e.model ?? '',
          type: e.subagentType,
          description: e.description,
          prompt: e.prompt,
        })
        const now = await $.clock.now()
        const row: AgentRow = {
          id: agentId,
          role: role.id,
          roleName: role.name,
          model: shortModel(result.model) || role.model,
          activity: 'pensando',
          detail: 'recebeu a tarefa',
          task: clip(e.description, 80),
          call: '',
          since: now,
          born: now,
          desk: -1,
          parent: e.parentAgentId ?? '',
          tokens: 0,
          taskStart: now,
          trail: [],
        }
        await update($, agents, (cur: Record<string, AgentRow>) => seatAgent(cur, row))
        dirty = true
        const names = titles(t, await read($, agents))
        const from = names[e.parentAgentId ?? LEAD] ?? t.lead.name
        const model = row.model ? ` (${row.model})` : ''
        const temp = t.roles.some(r => r.id === role.id) ? '' : ' [papel temporário]'
        await note($, `${from} → ${names[agentId] ?? role.name}${model}${temp}: ${clip(e.description, 50)}`)
      }
    } catch {}

    return result
  }).catch(($, e, next) => next(e))

  // Cada ferramenta muda o que o personagem faz e entra no histórico; ao terminar, volta a "pensando".
  on('tool.call', async ($, e, next) => {
    const call = e.tool_use_id ?? ''
    let id: string | undefined
    try {
      id = await ensure($, e.agentId)
      const activity = activityFor(e.tool)
      const detail = detailFor(e.tool, e as unknown as Record<string, unknown>)
      const step = trailFor(e.tool, detail)
      const agent = id
      if (call) calls.set(call, { agent, tool: e.tool, detail })
      await patch($, agent, (a, now) => ({ ...a, activity, detail, call, since: now, trail: pushTrail(a.trail, step) }))
      if (activity === 'aprovacao') await waiting($, agent, 'tem uma pergunta para você')
    } catch {}

    try {
      return await next(e)
    } finally {
      if (call) {
        calls.delete(call)
        awaiting.delete(call)
        approved.delete(call)
      }
      if (id) {
        const at = id
        try {
          await patch($, at, (a, now) =>
            a.call === call && a.activity !== 'concluido' ? { ...a, activity: 'pensando', call: '', since: now } : a,
          )
        } catch {}
      }
    }
  }).catch(($, e, next) => next(e))

  // O app vai mostrar o diálogo de permissão: o personagem levanta a mão e o usuário é avisado.
  on('classic.PermissionRequest', async ($, e, next) => {
    try {
      const id = await ensure($, e.agent_id)
      const input = (e.tool_input ?? {}) as Record<string, unknown>
      const detail = detailFor(e.tool_name, input)
      let call = ''
      await patch($, id, (a, now) => {
        call = a.call
        return { ...a, activity: 'aprovacao', detail, since: now }
      })
      if (call) awaiting.set(call, false)
      await waiting($, id, `aguarda sua aprovação: ${e.tool_name}`)
    } catch {}

    return next(e)
  }).catch(($, e, next) => next(e))

  // A linha da ferramenta que estava parada no diálogo passou a rodar: a aprovação foi dada.
  // Só observa; se a linha nunca aparecer parada, nada muda.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const id = e.props.tool_use_id
    const seen = awaiting.get(id)
    if (seen !== undefined) {
      if (!e.props.isRunning) awaiting.set(id, true)
      else if (seen) {
        awaiting.delete(id)
        approved.add(id)
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = await read($, team)
    const m = await read($, agents)
    const lines = (await read($, log)).slice(-6).reverse()
    const day = await read($, daily)
    const chats = await read($, others)
    const links = await read($, web)
    await read($, tick)
    const now = await $.clock.now()
    const people = roster(t, m)
    const v = await read($, version)
    const where =
      (v ? `Sala v${v} · ` : '') +
      (t.source === 'padrão'
        ? 'Equipe padrão. "/sala equipe" cria o arquivo da equipe deste projeto.'
        : `Equipe de ${t.source}`)
    const todayRoles = day.date === today(now) ? [...day.roles].sort((a, b) => b.tokens - a.tokens) : []

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {t.warning !== '' && <Text color={ORANGE}>⚠ {t.warning}</Text>}
          {people.map(p => {
            const status = STATUS[p.activity]
            const time = sinceText(now, p.taskStart, p.activity)
            return (
              <Text wrap="truncate-end">
                <Text color={status.color}>● </Text>
                <Text bold>{p.title}</Text>
                <Text dimColor> {p.model} </Text>
                <Text color={status.color}>{status.label}</Text>
                <Text dimColor>
                  {time ? `  ${time}` : ''}
                  {p.tokens > 0 ? `  ${fmtTokens(p.tokens)} tokens` : ''}
                  {p.detail ? `  ${p.detail}` : ''}
                </Text>
              </Text>
            )
          })}
          {chats.length > 0 && <Text> </Text>}
          {chats.map(c => (
            <Text dimColor wrap="truncate-end">
              outro chat: {c.title || c.project} · {c.busy} trabalhando{c.waiting ? ` · ${c.waiting} aguardando você` : ''}
            </Text>
          ))}
          {lines.length > 0 && <Text> </Text>}
          {lines.map(l => (
            <Text dimColor wrap="truncate-end">
              {fmtTime(l.at)} {l.text}
            </Text>
          ))}
        </Box>
      )
    }

    // Sem isInteractive: como imagem o SVG ocupa a largura do painel (o quadro interativo fica em 300×150).
    // Cada agente tem também uma linha em texto nativo, legível em qualquer largura e tema.
    const { Box, Text, Svg, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {t.warning !== '' && (
          <Text color={ORANGE} bold>
            ⚠ {t.warning}
          </Text>
        )}
        <Svg source={renderSvg(t, m)} alt={`Sala dos Agentes. ${summary(t, m)}`} />
        <Text> </Text>
        {people.map(p => {
          const status = STATUS[p.activity]
          const idle = p.activity === 'livre'
          const time = sinceText(now, p.taskStart, p.activity)
          const facts = [time, p.tokens > 0 ? `${fmtTokens(p.tokens)} tokens` : ''].filter(Boolean).join(' · ')
          const info = [p.detail, p.task].filter(Boolean).join('  ·  ')
          const steps = trailText(p.trail)
          return (
            <Box flexDirection="column">
              <Text wrap="truncate-end">
                <Text color={status.color}>● </Text>
                <Text bold={!idle} dimColor={idle}>
                  {p.title}
                </Text>
                {p.temp && <Text dimColor> (temporário)</Text>}
                <Text dimColor>
                  {'  '}
                  {p.model}
                  {'  '}
                </Text>
                <Text bold={p.activity === 'aprovacao'} dimColor={idle}>
                  {status.label}
                </Text>
                {facts !== '' && <Text dimColor> · {facts}</Text>}
              </Text>
              {info !== '' && (
                <Text dimColor wrap="truncate-end">
                  {'     '}
                  {info}
                </Text>
              )}
              {steps !== '' && (
                <Text dimColor wrap="truncate-end">
                  {'     '}
                  {steps}
                </Text>
              )}
            </Box>
          )
        })}
        {chats.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>Outros chats</Text>
            {chats.map(c => (
              <Text wrap="truncate-end">
                <Text color={c.waiting > 0 ? ORANGE : c.busy > 0 ? GREEN : FAINT}>● </Text>
                <Text bold>{c.title || c.project}</Text>
                <Text dimColor>
                  {c.title ? ` (${c.project})` : ''}
                  {'  '}
                  {c.waiting > 0 ? `${c.waiting} aguardando você · ` : ''}
                  {c.busy} trabalhando{c.lead ? ` · ${c.lead}` : ''}
                  {c.tokens > 0 ? ` · ${fmtTokens(c.tokens)} tokens` : ''} · há {fmtDuration(now - c.updatedAt)}
                </Text>
              </Text>
            ))}
          </Box>
        )}
        {todayRoles.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text bold>Hoje neste chat</Text>
            {todayRoles.map(r => (
              <Text dimColor wrap="truncate-end">
                {r.role}: {r.tasks} {r.tasks === 1 ? 'tarefa' : 'tarefas'} · {fmtDuration(r.ms)} · {fmtTokens(r.tokens)} tokens
              </Text>
            ))}
            <Button key="copy-day" label="Copiar resumo do dia" onPress={() => copyDay($, e.surface)} />
          </Box>
        )}
        <Text> </Text>
        <Text bold>Últimos eventos</Text>
        {lines.length === 0 && <Text dimColor>Nenhuma movimentação ainda.</Text>}
        {lines.map(l => (
          <Text dimColor wrap="truncate-end">
            {fmtTime(l.at)}  {l.text}
          </Text>
        ))}
        <Text> </Text>
        {links.length > 0 && (
          <Text dimColor wrap="truncate-end">
            Painel na rede: {links[0]}
          </Text>
        )}
        <Text dimColor wrap="truncate-end">
          {where}
        </Text>
        <Box flexDirection="row" gap={1}>
          {links.length > 0 && <Button key="copy-web" label="Copiar link do painel" onPress={() => copyLink($, e.surface)} />}
          <Button key="reset" label="Zerar sala" onPress={() => reset($)} />
        </Box>
      </Box>
    )
  })
}
