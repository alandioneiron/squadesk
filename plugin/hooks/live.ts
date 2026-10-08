import type { AgentRow, Daily, LogLine, OtherChat, Team, TrailItem } from '../types'
import { fmtDuration, fmtTokens, localZone, renderSvg, roster, STATUS } from './room'
import { LEAD } from './team'

// O retrato de um chat que o painel web e os outros chats leem (contrato em web/SNAPSHOT.md).
export type Snapshot = {
  v: 1
  id: string
  /** Título do chat (o da barra lateral do app); '' se ainda não houver. */
  title: string
  project: string
  cwd: string
  startedAt: number
  updatedAt: number
  ended: boolean
  version: string
  team: {
    lead: string
    leadModel: string
    source: string
    roles: { name: string; model: string; keywords: string[]; aliases: string[] }[]
  }
  svg: string
  busy: number
  waiting: number
  tokens: number
  agents: {
    key: string
    title: string
    model: string
    activity: string
    label: string
    color: string
    detail: string
    task: string
    taskStart: number
    tokens: number
    temp: boolean
    trail: TrailItem[]
  }[]
  log: LogLine[]
  daily: Daily
}

/** Data local (no fuso do sistema, ou no `zone` dado) no formato YYYY-MM-DD. */
export function today(ms: number, zone: string = localZone()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString().slice(0, 10)
  }
}

/** Soma uma tarefa (ou um turno do líder) ao resumo do dia; zera quando a data muda. */
export function addDay(daily: Daily, now: number, role: string, add: { tasks: number; ms: number; tokens: number }): Daily {
  const date = today(now)
  const roles = daily.date === date ? daily.roles : []
  const found = roles.some(r => r.role === role)
  return {
    date,
    roles: found
      ? roles.map(r =>
          r.role === role ? { ...r, tasks: r.tasks + add.tasks, ms: r.ms + add.ms, tokens: r.tokens + add.tokens } : r,
        )
      : [...roles, { role, ...add }],
  }
}

/** O resumo do dia em Markdown, pronto para colar no log de alterações. */
export function dayText(daily: Daily, project: string): string {
  const [y, m, d] = daily.date.split('-')
  const rows = [...daily.roles].sort((a, b) => b.tokens - a.tokens)
  const total = rows.reduce((t, r) => ({ tasks: t.tasks + r.tasks, ms: t.ms + r.ms, tokens: t.tokens + r.tokens }), {
    tasks: 0,
    ms: 0,
    tokens: 0,
  })
  return [
    `### Sala dos Agentes — ${d}/${m}/${y} — ${project}`,
    '',
    '| Papel | Tarefas | Tempo | Tokens |',
    '|---|---:|---:|---:|',
    ...rows.map(r => `| ${r.role} | ${r.tasks} | ${fmtDuration(r.ms)} | ${fmtTokens(r.tokens)} |`),
    `| **Total** | **${total.tasks}** | **${fmtDuration(total.ms)}** | **${fmtTokens(total.tokens)}** |`,
    '',
    '_Tokens sem contar leitura de cache. Tarefas do líder = pedidos atendidos._',
  ].join('\n')
}

function busyActivity(activity: string): boolean {
  return activity !== 'livre' && activity !== 'ocioso' && activity !== 'concluido'
}

export function buildSnapshot(input: {
  id: string
  title: string
  project: string
  cwd: string
  startedAt: number
  now: number
  ended: boolean
  version: string
  team: Team
  agents: Record<string, AgentRow>
  log: LogLine[]
  daily: Daily
}): Snapshot {
  const lines = roster(input.team, input.agents)
  const agents = lines.map(l => ({
    key: l.key,
    title: l.title,
    model: l.model,
    activity: l.activity,
    label: STATUS[l.activity].label,
    color: STATUS[l.activity].color,
    detail: l.detail,
    // O texto dos pedidos do usuário não sai do PC.
    task: l.key === LEAD ? '' : l.task,
    taskStart: l.taskStart,
    tokens: l.tokens,
    temp: l.temp,
    trail: l.trail.slice(-30),
  }))
  return {
    v: 1,
    id: input.id,
    title: input.title,
    project: input.project,
    cwd: input.cwd,
    startedAt: input.startedAt,
    updatedAt: input.now,
    ended: input.ended,
    version: input.version,
    team: {
      lead: input.team.lead.name,
      leadModel: input.team.lead.model,
      source: input.team.source,
      roles: input.team.roles.map(r => ({ name: r.name, model: r.model, keywords: r.keywords, aliases: r.aliases })),
    },
    svg: renderSvg(input.team, input.agents),
    busy: agents.filter(a => busyActivity(a.activity)).length,
    waiting: agents.filter(a => a.activity === 'aprovacao').length,
    tokens: agents.reduce((sum, a) => sum + a.tokens, 0),
    agents,
    log: input.log.filter(l => !l.text.startsWith('pedido:')).slice(-20),
    daily: input.daily.date === today(input.now) ? input.daily : { date: today(input.now), roles: [] },
  }
}

/**
 * Título do chat a partir das linhas do histórico (JSONL) que o findstr/grep achou:
 * o renomeado pelo usuário (custom-title) vence o gerado (ai-title); vale o último de cada.
 */
export function pickTitle(lines: string): string {
  let custom = ''
  let ai = ''
  for (const line of lines.split(/\r?\n/)) {
    if (!line.includes('-title')) continue
    try {
      const row = JSON.parse(line) as { type?: unknown; customTitle?: unknown; aiTitle?: unknown }
      if (row.type === 'custom-title' && typeof row.customTitle === 'string') custom = row.customTitle.trim()
      if (row.type === 'ai-title' && typeof row.aiTitle === 'string') ai = row.aiTitle.trim()
    } catch {}
  }
  return (custom || ai).slice(0, 80)
}

/** Resumo de outro chat a partir do retrato dele; undefined se não for um retrato válido ou se já encerrou. */
export function summarizeOther(raw: unknown): OtherChat | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const s = raw as Partial<Snapshot>
  if (s.v !== 1 || typeof s.id !== 'string' || typeof s.project !== 'string' || s.ended === true) return undefined
  const lead = Array.isArray(s.agents) ? s.agents.find(a => a?.key === LEAD) : undefined
  return {
    id: s.id,
    title: typeof s.title === 'string' ? s.title : '',
    project: s.project,
    busy: typeof s.busy === 'number' ? s.busy : 0,
    waiting: typeof s.waiting === 'number' ? s.waiting : 0,
    lead: lead ? `${lead.title} ${lead.label}` : '',
    tokens: typeof s.tokens === 'number' ? s.tokens : 0,
    updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
  }
}
