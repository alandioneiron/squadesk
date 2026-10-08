import type { Activity, AgentRow, Team, TrailItem } from '../types'
import { clip, isActive, isTempRole, LEAD } from './team'

// Paleta Squadesk: dourado, grafite quente, laranja de atenção.
const C = {
  bg: '#161513',
  tile: '#1E1C19',
  wall: '#100F0D',
  gold: '#C9A24B',
  goldLight: '#FECB81',
  text: '#EFEBE2',
  dim: '#A39C8F',
  faint: '#6F695F',
  desk: '#3A3128',
  deskEdge: '#4F4234',
  monitor: '#0C0C0B',
  chair: '#2A2824',
  bubble: '#23211D',
  orange: '#E16B01',
  green: '#54B45F',
  blue: '#6FA8DC',
}

export const MODEL_COLOR: Record<string, string> = {
  Opus: C.gold,
  Sonnet: C.orange,
  Haiku: '#7FB3A3',
  Fable: '#B48EAD',
}

export const STATUS: Record<Activity, { label: string; color: string }> = {
  livre: { label: 'livre', color: C.faint },
  ocioso: { label: 'ocioso', color: C.faint },
  pensando: { label: 'pensando', color: '#D9CFBF' },
  lendo: { label: 'lendo', color: C.blue },
  editando: { label: 'editando', color: '#FECB81' },
  comando: { label: 'executando', color: C.green },
  delegando: { label: 'delegando', color: C.gold },
  aprovacao: { label: 'aguardando você', color: C.orange },
  concluido: { label: 'concluído', color: C.green },
}

// Cabelo e pele: o líder usa o primeiro; cada papel e cada mesa extra, um dos outros.
const LOOKS = [
  { hair: '#3B2F2A', skin: '#E9CFA9' },
  { hair: '#C9A24B', skin: '#E2BE96' },
  { hair: '#5B3A29', skin: '#8D5E3C' },
  { hair: '#1F1B18', skin: '#C99B73' },
  { hair: '#8A4B2A', skin: '#F0D5B8' },
  { hair: '#4A4A4A', skin: '#A8764F' },
  { hair: '#2E2A4A', skin: '#D8B08C' },
  { hair: '#7A2E1F', skin: '#F2D7C0' },
]

function lookAt(i: number): { hair: string; skin: string } {
  return LOOKS[1 + (i % (LOOKS.length - 1))] ?? { hair: '#3B2F2A', skin: '#E9CFA9' }
}

// Grade da sala: 3 colunas; o líder no meio da 1ª fileira, os papéis em volta e abaixo.
const COLS = [130, 380, 630]
const ROW0 = 178
const ROW_GAP = 198
const EXTRA_GAP = 36
export const MAX_EXTRAS = 9
// Escala dos personagens e mesas em torno do ponto da mesa; largura da cena.
const S = 1.35
const W = 760

export function emptyLead(): AgentRow {
  return {
    id: LEAD,
    role: LEAD,
    roleName: '',
    model: '',
    activity: 'ocioso',
    detail: 'aguardando seu pedido',
    task: '',
    call: '',
    since: 0,
    born: 0,
    desk: -1,
    parent: '',
  }
}

export function activityFor(tool: string): Activity {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return 'editando'
  if (/^(Read|Grep|Glob|LS|WebFetch|WebSearch|ToolSearch|NotebookRead|ListMcpResourcesTool|ReadMcpResourceTool)$/.test(tool)) return 'lendo'
  if (/^mcp__(Claude_Browser|claude-in-chrome)__/.test(tool)) return 'lendo'
  if (/^(Bash|PowerShell|Monitor|BashOutput|KillShell|TaskStop)$/.test(tool)) return 'comando'
  if (/^(Agent|Task|SendMessage|Workflow)$/.test(tool)) return 'delegando'
  if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') return 'aprovacao'
  return 'pensando'
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function detailFor(tool: string, input: Record<string, unknown>): string {
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined)
  if (tool === 'AskUserQuestion') return 'pergunta para você'
  const path = str('file_path') ?? str('notebook_path')
  if (path) return baseName(path)
  const description = str('description')
  if (/^(Agent|Task)$/.test(tool) && description) return '→ ' + description
  const command = str('command')
  if (command) return '$ ' + (command.split('\n')[0] ?? command)
  const pattern = str('pattern')
  if (pattern) return 'busca: ' + pattern
  const query = str('query')
  if (query) return 'pesquisa: ' + query
  const url = str('url')
  if (url) {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }
  if (tool.startsWith('mcp__')) return tool.split('__').slice(2).join('__') || tool
  return tool
}

/** O nome de fuso (IANA) se o Intl o aceita; vazio, ausente ou inválido vira 'UTC'. */
export function validZone(zone: unknown): string {
  try {
    if (typeof zone === 'string' && zone.trim() !== '') {
      new Intl.DateTimeFormat('en-CA', { timeZone: zone })
      return zone
    }
  } catch {}
  return 'UTC'
}

/** Fuso do sistema, lido a cada uso (se o computador mudar de fuso, a sala acompanha). */
export function localZone(): string {
  try {
    return validZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch {
    return 'UTC'
  }
}

/** HH:MM no fuso do sistema (ou no `zone` dado). */
export function fmtTime(ms: number, zone: string = localZone()): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms))
  } catch {
    const d = new Date(ms)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
}

/** "850", "12,3 mil", "1,2 mi". */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace('.', ',')} mil`
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi`
}

/** "40 s", "3 min", "1 h 05". */
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/** "editou: a.cs, b.cs · leu: c.md (+2)": o histórico agrupado por ação, mais recente primeiro. */
export function trailText(trail: readonly TrailItem[], perOp = 3): string {
  const groups = new Map<string, string[]>()
  for (const item of [...trail].reverse()) {
    const list = groups.get(item.op) ?? []
    if (!list.includes(item.what)) list.push(item.what)
    groups.set(item.op, list)
  }
  return [...groups]
    .map(([op, list]) => `${op}: ${list.slice(0, perOp).join(', ')}${list.length > perOp ? ` (+${list.length - perOp})` : ''}`)
    .join(' · ')
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h
}

function isBusy(activity: Activity): boolean {
  return activity !== 'livre' && activity !== 'ocioso' && activity !== 'concluido'
}

// A mesa do papel primeiro, depois por ordem de chegada.
function byOrder(a: AgentRow, b: AgentRow): number {
  return (a.desk === -1 ? 0 : 1) - (b.desk === -1 ? 0 : 1) || a.born - b.born
}

/**
 * Nome de cada agente na sala: o do papel; quem chegou depois num papel ocupado ganha número
 * ("Dev Backend 2").
 */
export function titles(team: Team, agents: Record<string, AgentRow>): Record<string, string> {
  const out: Record<string, string> = { [LEAD]: team.lead.name }
  const groups = new Map<string, AgentRow[]>()
  for (const a of Object.values(agents)) {
    if (a.id === LEAD) continue
    groups.set(a.role, [...(groups.get(a.role) ?? []), a])
  }
  for (const [roleId, list] of groups) {
    const name = team.roles.find(r => r.id === roleId)?.name ?? list[0]?.roleName ?? 'Agente'
    list.sort(byOrder).forEach((a, i) => (out[a.id] = i === 0 ? name : `${name} ${i + 1}`))
  }
  return out
}

export type RosterLine = {
  key: string
  title: string
  model: string
  activity: Activity
  detail: string
  task: string
  tokens: number
  taskStart: number
  trail: TrailItem[]
  temp: boolean
}

/** Uma linha por agente, na ordem da equipe; papel sem ninguém aparece como livre. */
export function roster(team: Team, agents: Record<string, AgentRow>): RosterLine[] {
  const names = titles(team, agents)
  const line = (a: AgentRow, model: string): RosterLine => ({
    key: a.id,
    title: names[a.id] ?? a.roleName,
    model: a.model || model,
    activity: a.activity,
    detail: a.detail,
    task: a.task,
    tokens: a.tokens ?? 0,
    taskStart: a.taskStart ?? 0,
    trail: a.trail ?? [],
    temp: isTempRole(a.role),
  })
  const lines: RosterLine[] = [line(agents[LEAD] ?? emptyLead(), team.lead.model)]
  const others = Object.values(agents).filter(a => a.id !== LEAD)
  for (const role of team.roles) {
    const mine = others.filter(a => a.role === role.id).sort(byOrder)
    if (mine.length === 0)
      lines.push({
        key: role.id,
        title: role.name,
        model: role.model,
        activity: 'livre',
        detail: '',
        task: '',
        tokens: 0,
        taskStart: 0,
        trail: [],
        temp: false,
      })
    for (const a of mine) lines.push(line(a, role.model))
  }
  const known = new Set(team.roles.map(r => r.id))
  for (const a of others.filter(a => !known.has(a.role)).sort(byOrder)) lines.push(line(a, ''))
  return lines
}

export type Desk = {
  key: string
  x: number
  y: number
  title: string
  model: string
  activity: Activity
  look: { hair: string; skin: string }
  agent?: AgentRow
  isLead: boolean
  tokens: number
}

export type Plan = { desks: Desk[]; height: number; extrasY: number; hidden: number }

/** Onde fica cada mesa: líder, uma por papel e as extras (agente a mais num papel ocupado). */
export function plan(team: Team, agents: Record<string, AgentRow>): Plan {
  const names = titles(team, agents)
  const lead = agents[LEAD] ?? emptyLead()
  const desks: Desk[] = [
    {
      key: LEAD,
      x: 380,
      y: ROW0,
      title: team.lead.name,
      model: team.lead.model,
      activity: lead.activity,
      look: LOOKS[0] ?? lookAt(0),
      agent: lead,
      isLead: true,
      tokens: lead.tokens ?? 0,
    },
  ]
  const others = Object.values(agents).filter(a => a.id !== LEAD)
  let lastRow = 0
  team.roles.forEach((role, i) => {
    const col = i < 2 ? (i === 0 ? 0 : 2) : (i - 2) % 3
    const row = i < 2 ? 0 : 1 + Math.floor((i - 2) / 3)
    lastRow = Math.max(lastRow, row)
    const agent = others.find(a => a.role === role.id && a.desk === -1)
    desks.push({
      key: role.id,
      x: COLS[col] ?? 130,
      y: ROW0 + row * ROW_GAP,
      title: agent ? (names[agent.id] ?? role.name) : role.name,
      model: agent?.model || role.model,
      activity: agent?.activity ?? 'livre',
      look: lookAt(i),
      agent,
      isLead: false,
      tokens: agent?.tokens ?? 0,
    })
  })

  // Mesas extras: agente a mais num papel ocupado, ou de um papel que saiu da equipe.
  const known = new Set(team.roles.map(r => r.id))
  const extras = others.filter(a => a.desk >= 0 || !known.has(a.role)).sort((x, y) => x.born - y.born)
  const taken = new Set(extras.filter(a => a.desk >= 0).map(a => a.desk))
  let free = 0
  const extrasY = extras.length > 0 ? ROW0 + (lastRow + 1) * ROW_GAP + EXTRA_GAP : 0
  let hidden = 0
  let bottom = ROW0 + lastRow * ROW_GAP
  for (const a of extras) {
    let k = a.desk
    if (k < 0) {
      while (taken.has(free)) free++
      taken.add(free)
      k = free
    }
    if (k >= MAX_EXTRAS) {
      hidden++
      continue
    }
    const y = extrasY + Math.floor(k / 3) * ROW_GAP
    bottom = Math.max(bottom, y)
    desks.push({
      key: a.id,
      x: COLS[k % 3] ?? 130,
      y,
      title: names[a.id] ?? a.roleName,
      model: a.model,
      activity: a.activity,
      look: lookAt(hash(a.id)),
      agent: a,
      isLead: false,
      tokens: a.tokens ?? 0,
    })
  }
  return { desks, height: bottom + 96, extrasY, hidden }
}

export function summary(team: Team, agents: Record<string, AgentRow>): string {
  return roster(team, agents)
    .map(l => `${l.title}: ${STATUS[l.activity].label}${l.detail ? ` (${l.detail})` : ''}`)
    .join('; ')
}

const STYLE = `
@keyframes type { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
.typeA { animation: type .28s infinite } .typeB { animation: type .28s infinite .14s }
.cmdA { animation: type .7s infinite } .cmdB { animation: type .7s infinite .35s }
@keyframes nod { 0%,100% { transform: rotate(-5deg) } 50% { transform: rotate(5deg) } }
.nod { animation: nod 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100% }
@keyframes float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4px) } }
.float { animation: float 2s ease-in-out infinite }
@keyframes blink { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
.blink { animation: blink 1s steps(1) infinite }
@keyframes pulse { 0% { opacity: .9; transform: scale(1) } 100% { opacity: 0; transform: scale(1.9) } }
.pulse { animation: pulse 1.4s ease-out infinite; transform-box: fill-box; transform-origin: center }
@keyframes wave { 0%,100% { transform: rotate(-14deg) } 50% { transform: rotate(14deg) } }
.wave { animation: wave .8s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100% }
@keyframes hop { 0%,100% { transform: translateY(0) } 30% { transform: translateY(-7px) } 60% { transform: translateY(0) } }
.hop { animation: hop 1.1s ease-in-out 3 }
@keyframes flow { to { stroke-dashoffset: -28 } }
.flow { animation: flow .9s linear infinite }
@keyframes scan { 0% { transform: translateY(0) } 100% { transform: translateY(15px) } }
.scan { animation: scan 1.6s ease-in-out infinite alternate }
@keyframes grow { 0% { transform: scaleX(.1) } 100% { transform: scaleX(1) } }
.grow { animation: grow 1.4s steps(7) infinite; transform-box: fill-box; transform-origin: left center }
@keyframes dots { 0%,20% { opacity: .2 } 50% { opacity: 1 } 100% { opacity: .2 } }
.d1 { animation: dots 1.2s infinite } .d2 { animation: dots 1.2s infinite .2s } .d3 { animation: dots 1.2s infinite .4s }
@keyframes zz { 0% { opacity: 0; transform: translate(0,0) } 30% { opacity: 1 } 100% { opacity: 0; transform: translate(9px,-14px) } }
.zz { animation: zz 2.8s ease-out infinite }
@keyframes glow { 0%,100% { opacity: .05 } 50% { opacity: .12 } }
.glow { animation: glow 2.4s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { * { animation: none !important } }
`

function screen(activity: Activity, sx: number, sy: number): string {
  const lit = `<rect x="${sx}" y="${sy}" width="36" height="23" rx="1.5" fill="#1B2430"/>`
  switch (activity) {
    case 'editando':
      return (
        lit +
        `<rect x="${sx + 3}" y="${sy + 3}" width="18" height="2" fill="${C.gold}" opacity=".85"/>` +
        `<rect x="${sx + 6}" y="${sy + 8}" width="24" height="2" fill="${C.blue}" opacity=".75"/>` +
        `<rect x="${sx + 6}" y="${sy + 13}" width="14" height="2" fill="${C.green}" opacity=".75"/>` +
        `<rect class="grow" x="${sx + 3}" y="${sy + 18}" width="26" height="2" fill="#FECB81"/>`
      )
    case 'lendo':
      return (
        lit +
        `<rect x="${sx + 6}" y="${sy + 2}" width="24" height="20" rx="1" fill="#D9D2C3"/>` +
        `<rect x="${sx + 9}" y="${sy + 5}" width="18" height="1.5" fill="#8A8478"/>` +
        `<rect x="${sx + 9}" y="${sy + 9}" width="15" height="1.5" fill="#8A8478"/>` +
        `<rect x="${sx + 9}" y="${sy + 13}" width="17" height="1.5" fill="#8A8478"/>` +
        `<rect x="${sx + 9}" y="${sy + 17}" width="12" height="1.5" fill="#8A8478"/>` +
        `<rect class="scan" x="${sx + 6}" y="${sy + 2}" width="24" height="4" fill="${C.blue}" opacity=".45"/>`
      )
    case 'comando':
      return (
        `<rect x="${sx}" y="${sy}" width="36" height="23" rx="1.5" fill="#050505"/>` +
        `<rect x="${sx + 3}" y="${sy + 4}" width="20" height="1.5" fill="${C.green}" opacity=".5"/>` +
        `<rect x="${sx + 3}" y="${sy + 8}" width="26" height="1.5" fill="${C.green}" opacity=".5"/>` +
        `<text x="${sx + 3}" y="${sy + 19}" font-family="Consolas, monospace" font-size="8" fill="${C.green}">&gt;_</text>` +
        `<rect class="blink" x="${sx + 15}" y="${sy + 13}" width="4" height="7" fill="${C.green}"/>`
      )
    case 'pensando':
      return (
        lit +
        `<circle class="d1" cx="${sx + 11}" cy="${sy + 12}" r="2" fill="#D9CFBF"/>` +
        `<circle class="d2" cx="${sx + 18}" cy="${sy + 12}" r="2" fill="#D9CFBF"/>` +
        `<circle class="d3" cx="${sx + 25}" cy="${sy + 12}" r="2" fill="#D9CFBF"/>`
      )
    case 'delegando':
      return (
        lit +
        `<text x="${sx + 18}" y="${sy + 16}" text-anchor="middle" font-size="12" font-weight="700" fill="${C.gold}">⇢</text>`
      )
    case 'aprovacao':
      return (
        `<rect x="${sx}" y="${sy}" width="36" height="23" rx="1.5" fill="#3A1E05"/>` +
        `<text class="blink" x="${sx + 18}" y="${sy + 17}" text-anchor="middle" font-size="14" font-weight="700" fill="${C.orange}">?</text>`
      )
    case 'concluido':
      return (
        lit +
        `<path d="M${sx + 11} ${sy + 12} l5 5 l9 -10" fill="none" stroke="${C.green}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
      )
    default:
      return (
        `<rect x="${sx}" y="${sy}" width="36" height="23" rx="1.5" fill="#0A0A09"/>` +
        `<circle cx="${sx + 18}" cy="${sy + 11.5}" r="2" fill="${C.gold}" opacity=".25"/>`
      )
  }
}

function bubble(activity: Activity, bx: number, by: number): string {
  const color = STATUS[activity].color
  const box = (inner: string) =>
    `<g class="float"><rect x="${bx}" y="${by}" width="34" height="20" rx="8" fill="${C.bubble}" stroke="${color}" stroke-width="1.2"/>` +
    `<path d="M${bx + 8} ${by + 20} l-3 6 l8 -6z" fill="${C.bubble}" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<rect x="${bx + 5}" y="${by + 18}" width="10" height="3" fill="${C.bubble}"/>${inner}</g>`
  const glyph = (text: string, size = 12) =>
    `<text x="${bx + 17}" y="${by + 14.5}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${color}">${text}</text>`
  switch (activity) {
    case 'pensando':
      return box(
        `<circle class="d1" cx="${bx + 10}" cy="${by + 10}" r="2.2" fill="${color}"/>` +
          `<circle class="d2" cx="${bx + 17}" cy="${by + 10}" r="2.2" fill="${color}"/>` +
          `<circle class="d3" cx="${bx + 24}" cy="${by + 10}" r="2.2" fill="${color}"/>`,
      )
    case 'lendo':
      return box(glyph('≡', 14))
    case 'editando':
      return box(glyph('&lt;/&gt;', 10))
    case 'comando':
      return box(glyph('&gt;_', 11))
    case 'delegando':
      return box(glyph('→', 14))
    case 'aprovacao':
      return box(glyph('?', 14))
    case 'concluido':
      return box(glyph('✓', 13))
    case 'ocioso':
      return `<text class="zz" x="${bx + 6}" y="${by + 16}" font-size="13" font-weight="700" fill="${C.faint}">z</text>`
    default:
      return ''
  }
}

// Contorno da cor do piso: as linhas de delegação passam por trás sem cortar o texto.
const HALO = `stroke="${C.bg}" stroke-width="5" stroke-linejoin="round" paint-order="stroke"`

function station(desk: Desk): string {
  const { x, y, activity, look } = desk
  const status = STATUS[activity]
  const body = MODEL_COLOR[desk.model] ?? C.dim
  const cx = x - 17
  const hy = y - 40
  const typing = activity === 'editando' ? ['typeA', 'typeB'] : activity === 'comando' ? ['cmdA', 'cmdB'] : ['', '']
  const headClass = activity === 'lendo' || activity === 'pensando' ? 'nod' : ''
  const charClass = activity === 'concluido' ? 'hop' : ''
  const resting = activity === 'livre' || activity === 'ocioso'

  const eyes = resting
    ? `<path d="M${cx + 1} ${hy} h4 M${cx + 7} ${hy} h4" stroke="#1A1712" stroke-width="1.4" stroke-linecap="round"/>`
    : `<circle cx="${cx + 3}" cy="${hy}" r="1.5" fill="#1A1712"/><circle cx="${cx + 8.5}" cy="${hy}" r="1.5" fill="#1A1712"/>`

  const arms =
    activity === 'aprovacao'
      ? `<rect class="wave" x="${cx - 17}" y="${y - 58}" width="5.5" height="24" rx="2.75" fill="${body}"/>` +
        `<rect x="${cx + 4}" y="${y - 12}" width="18" height="5" rx="2.5" fill="${body}" opacity=".85"/>`
      : `<rect class="${typing[0]}" x="${cx + 4}" y="${y - 13}" width="18" height="5" rx="2.5" fill="${body}" opacity=".85"/>` +
        `<rect class="${typing[1]}" x="${cx + 2}" y="${y - 8}" width="20" height="5" rx="2.5" fill="${body}" opacity=".85"/>`

  const ring =
    activity === 'aprovacao'
      ? `<circle class="pulse" cx="${cx}" cy="${hy}" r="15" fill="none" stroke="${C.orange}" stroke-width="2"/>`
      : ''

  const mug = resting
    ? `<rect x="${x - 46}" y="${y - 9}" width="8" height="9" rx="2" fill="${C.text}" opacity=".75"/>` +
      `<path d="M${x - 38} ${y - 7} q4 0 4 3 q0 3 -4 3" fill="none" stroke="${C.text}" stroke-width="1.2" opacity=".75"/>`
    : ''

  const glow = isBusy(activity)
    ? `<ellipse class="glow" cx="${x}" cy="${y + 6}" rx="74" ry="20" fill="${status.color}"/>`
    : ''

  // Desenho em coordenadas da mesa, ampliado S vezes em torno de (x, y).
  const figure =
    glow +
    `<rect x="${cx - 18}" y="${y - 44}" width="36" height="40" rx="9" fill="${C.chair}"/>` +
    `<g class="${charClass}">` +
    `<rect x="${cx - 14}" y="${y - 29}" width="28" height="32" rx="11" fill="${body}"/>` +
    `<g class="${headClass}">` +
    `<circle cx="${cx}" cy="${hy}" r="11" fill="${look.skin}"/>` +
    `<path d="M${cx - 11} ${hy - 1} a11 11 0 0 1 22 0 q-12 -5 -22 0z" fill="${look.hair}"/>` +
    eyes +
    `</g>` +
    arms +
    ring +
    `</g>` +
    `<rect x="${x - 54}" y="${y}" width="108" height="13" rx="3" fill="${C.desk}" stroke="${C.deskEdge}"/>` +
    `<rect x="${x - 48}" y="${y + 13}" width="4" height="10" fill="#2A241D"/>` +
    `<rect x="${x + 44}" y="${y + 13}" width="4" height="10" fill="#2A241D"/>` +
    `<rect x="${x - 6}" y="${y - 3}" width="22" height="4" rx="1" fill="#2F2B26"/>` +
    `<rect x="${x + 25}" y="${y - 8}" width="4" height="8" fill="#2B2925"/>` +
    `<rect x="${x + 6}" y="${y - 37}" width="42" height="30" rx="3" fill="${C.monitor}" stroke="#34302A"/>` +
    screen(activity, x + 9, y - 34) +
    mug +
    bubble(activity, cx - 2, y - 82)

  const label = (dy: number, size: number, weight: number, color: string, text: string) =>
    `<text x="${x}" y="${y + dy}" text-anchor="middle" font-size="${size}" font-weight="${weight}" fill="${color}" ${HALO}>${text}</text>`
  const model = desk.model ? ` <tspan fill="${body}">· ${esc(desk.model)}</tspan>` : ''
  // Tokens gastos, pintados na frente da mesa (não muda a altura das fileiras).
  const spent =
    desk.tokens > 0
      ? `<text x="${x}" y="${y + 14}" text-anchor="middle" font-size="11" font-weight="600" fill="${C.goldLight}" opacity=".9">${esc(fmtTokens(desk.tokens))} tokens</text>`
      : ''

  return (
    `<g opacity="${activity === 'livre' ? 0.55 : 1}">` +
    `<g transform="translate(${x} ${y}) scale(${S}) translate(${-x} ${-y})">${figure}</g>` +
    spent +
    label(50, 17, 700, C.text, esc(clip(desk.title, 20))) +
    label(71, 14, 500, status.color, `● ${esc(status.label)}${model}`) +
    `</g>`
  )
}

// Linha tracejada de quem delegou (o líder ou outro agente) até cada agente trabalhando.
function link(from: Desk, to: Desk): string {
  let d: string
  if (from.y === to.y) {
    const side = to.x < from.x ? -1 : 1
    const x1 = from.x + side * 76
    const x2 = to.x - side * 76
    d = `M${x1} ${from.y + 8} Q${(x1 + x2) / 2} ${from.y + 30} ${x2} ${to.y + 8}`
  } else {
    const x1 = from.x + Math.max(-50, Math.min(50, (to.x - from.x) * 0.25))
    const y1 = from.y + 24
    const x2 = to.x - 17 * S
    const y2 = to.y - 84
    d = `M${x1} ${y1} Q${(x1 + x2) / 2} ${y1 + 40} ${x2} ${y2}`
  }
  return `<path class="flow" d="${d}" fill="none" stroke="${C.gold}" stroke-width="2" stroke-dasharray="5 9" opacity=".6"/>`
}

function links(desks: Desk[]): string {
  const lead = desks[0]
  if (!lead) return ''
  const byAgent = new Map<string, Desk>()
  for (const d of desks) if (d.agent) byAgent.set(d.agent.id, d)
  return desks
    .filter(d => !d.isLead && d.agent && isActive(d.agent))
    .map(d => link(byAgent.get(d.agent?.parent ?? '') ?? lead, d))
    .join('')
}

function decor(height: number): string {
  const plant = (px: number, py: number) =>
    `<rect x="${px - 9}" y="${py}" width="18" height="16" rx="3" fill="#4F4234"/>` +
    `<circle cx="${px - 6}" cy="${py - 4}" r="8" fill="#3E6B47"/><circle cx="${px + 6}" cy="${py - 6}" r="8" fill="#4C7F55"/>` +
    `<circle cx="${px}" cy="${py - 13}" r="8" fill="#5A9163"/>`
  const window = (wx: number) =>
    `<rect x="${wx}" y="9" width="74" height="36" rx="3" fill="#0D1420" stroke="#2A2824" stroke-width="2"/>` +
    `<path d="M${wx + 37} 9 v36" stroke="#2A2824" stroke-width="2"/>` +
    `<rect x="${wx + 8}" y="31" width="6" height="14" fill="#151D2B"/><rect x="${wx + 18}" y="25" width="9" height="20" fill="#151D2B"/>` +
    `<rect x="${wx + 44}" y="28" width="8" height="17" fill="#151D2B"/><rect x="${wx + 56}" y="22" width="10" height="23" fill="#151D2B"/>` +
    `<rect x="${wx + 20}" y="28" width="2" height="2" fill="${C.gold}" opacity=".8"/><rect x="${wx + 59}" y="26" width="2" height="2" fill="${C.gold}" opacity=".8"/>` +
    `<rect x="${wx + 46}" y="33" width="2" height="2" fill="${C.gold}" opacity=".6"/>`
  return (
    window(300) +
    window(456) +
    `<ellipse cx="380" cy="${ROW0 + 12}" rx="130" ry="40" fill="${C.gold}" opacity=".05"/>` +
    plant(26, height - 20) +
    plant(734, height - 20)
  )
}

function extrasDivider(layout: Plan): string {
  if (!layout.extrasY) return ''
  const y = layout.extrasY - 130
  const hidden = layout.hidden
    ? `<text x="736" y="${y - 7}" text-anchor="end" font-size="12" fill="${C.orange}">+${layout.hidden} sem mesa (veja a lista)</text>`
    : ''
  return (
    `<path d="M24 ${y} H736" stroke="${C.deskEdge}" stroke-width="1" stroke-dasharray="3 6"/>` +
    `<text x="24" y="${y - 7}" font-size="11.5" letter-spacing="1.5" fill="${C.dim}">MESAS EXTRAS</text>` +
    hidden
  )
}

export function renderSvg(team: Team, agents: Record<string, AgentRow>): string {
  const layout = plan(team, agents)
  const H = layout.height
  const all = Object.values(agents)
  const busy = all.filter(a => isBusy(a.activity)).length
  const waiting = all.filter(a => a.activity === 'aprovacao').length
  const total = all.reduce((sum, a) => sum + (a.tokens ?? 0), 0)
  const subtitle =
    'SALA DOS AGENTES' +
    (total > 0 ? `<tspan letter-spacing="0" fill="${C.goldLight}"> · ${esc(fmtTokens(total))} tokens</tspan>` : '')
  const header =
    `<rect width="${W}" height="56" rx="14" fill="${C.wall}"/><rect y="40" width="${W}" height="16" fill="${C.wall}"/>` +
    `<rect y="56" width="${W}" height="2" fill="${C.gold}" opacity=".55"/>` +
    `<text x="24" y="29" fill="url(#ng)" font-size="20" font-weight="700" letter-spacing="4">SQUADESK</text>` +
    `<text x="24" y="47" fill="${C.dim}" font-size="12" letter-spacing="1.5">${subtitle}</text>` +
    `<text x="736" y="28" text-anchor="end" font-size="15" font-weight="600" fill="${busy ? C.text : C.faint}">${busy} trabalhando</text>` +
    `<text x="736" y="47" text-anchor="end" font-size="13" fill="${waiting ? C.orange : C.faint}">${waiting ? `${waiting} aguardando você` : 'nada pendente com você'}</text>`
  return (
    // Largura grande de propósito: a superfície encolhe até caber no painel, mantendo a proporção.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}" font-family="Segoe UI, system-ui, sans-serif">` +
    `<defs><linearGradient id="ng" x1="0" x2="1"><stop offset="0" stop-color="#FECB81"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="#946930"/></linearGradient>` +
    `<pattern id="tile" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${C.tile}" stroke-width="1"/></pattern></defs>` +
    `<style>${STYLE}</style>` +
    `<rect width="${W}" height="${H}" rx="14" fill="${C.bg}"/><rect width="${W}" height="${H}" rx="14" fill="url(#tile)"/>` +
    header +
    decor(H) +
    extrasDivider(layout) +
    links(layout.desks) +
    layout.desks.map(station).join('') +
    `</svg>`
  )
}
