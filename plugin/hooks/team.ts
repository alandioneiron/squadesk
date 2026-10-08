import type { AgentRow, Role, Team } from '../types'

export const LEAD = 'lead'
export const MAX_ROLES = 11
export const TEAM_FILE = 'sala-agentes.json'

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

/** Minúsculas e sem acento: "Serviço" e "servico" comparam igual. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function shortModel(model: unknown): string {
  if (typeof model !== 'string' || !model) return ''
  if (/opus/i.test(model)) return 'Opus'
  if (/sonnet/i.test(model)) return 'Sonnet'
  if (/haiku/i.test(model)) return 'Haiku'
  if (/fable/i.test(model)) return 'Fable'
  return ''
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Nome citado inteiro, com espaço, hífen ou _ entre as palavras: "Dev-Backend", "dev backend".
function mention(name: string): RegExp {
  const words = fold(name).split(/[\s_-]+/).filter(Boolean).map(escape)
  return new RegExp(`(?:^|[^a-z0-9])${words.join('[\\s_-]*')}(?:$|[^a-z0-9])`)
}

// Palavra-chave casa com o começo de uma palavra: "test" pega "testes", não "contestar".
function startsWord(keyword: string): RegExp {
  return new RegExp(`(?:^|[^a-z0-9])${escape(fold(keyword))}`)
}

type RoleSpec = { nome: string; modelo?: string; palavras?: string[]; apelidos?: string[] }

export const DEFAULT_SPEC: { lider: { nome: string; modelo: string }; papeis: RoleSpec[] } = {
  lider: { nome: 'Tech Lead', modelo: 'Opus' },
  papeis: [
    {
      nome: 'QA',
      modelo: 'Haiku',
      palavras: ['qa', 'test', 'valid', 'smoke', 'verific', 'revis', 'review', 'audit', 'confer'],
    },
    {
      nome: 'Documentador',
      modelo: 'Haiku',
      palavras: ['doc', 'log', 'changelog', 'readme', 'handoff', 'checklist', 'registr', 'anot', 'wiki', 'manual'],
    },
    {
      nome: 'Dev Backend',
      modelo: 'Sonnet',
      palavras: ['back', 'api', 'nest', 'auth', 'banco', 'db', 'sql', 'signal', 'endpoint', 'servico', 'service', 'sdk', 'rota'],
    },
    {
      nome: 'Dev Frontend',
      modelo: 'Sonnet',
      palavras: ['front', 'react', 'tela', 'ui', 'ux', 'css', 'html', 'wpf', 'xaml', 'layout', 'player', 'componente', 'visual'],
    },
    {
      nome: 'Dev Infra',
      modelo: 'Sonnet',
      palavras: ['infra', 'docker', 'compose', 'kubernetes', 'pipeline', 'rede', 'network', 'firewall', 'vpn', 'deploy', 'servidor', 'server', 'instal', 'nginx'],
    },
  ],
}

/** JSON da equipe com 2 espaços, mas palavras e apelidos numa linha só (mais fácil de editar à mão). */
export function formatTeamFile(content: unknown): string {
  return JSON.stringify(content, null, 2).replace(/("(?:palavras|apelidos)": )\[([^\]]*)\]/g, (whole, key: string, items: string) => {
    try {
      const list = JSON.parse(`[${items}]`) as unknown[]
      return `${key}[${list.map(item => JSON.stringify(item)).join(', ')}]`
    } catch {
      return whole
    }
  })
}

/** O texto do sala-agentes.json de exemplo, com a equipe padrão e as instruções. */
export function exampleFile(): string {
  return formatTeamFile(
    {
      _como_usar: [
        'Equipe da Sala dos Agentes. Salve como .claude/sala-agentes.json no projeto (vale só nele)',
        'ou em ~/.claude/sala-agentes.json (vale para todos). Mudanças valem no próximo pedido ou no /sala.',
        'papeis: de 1 a 11, na ordem das mesas (as 2 primeiras ficam ao lado do líder).',
        'modelo: Opus, Sonnet, Haiku ou Fable; agentes desse modelo preferem esse papel.',
        'palavras: começos de palavra que puxam a tarefa para o papel (sem acento, minúsculas).',
        'apelidos: outros nomes do papel; citar o nome ou um apelido na tarefa manda direto para ele.',
        'orientar: false desliga o guia da sala que o Tech Lead recebe no começo de cada conversa.',
      ],
      ...DEFAULT_SPEC,
    },)
}

function slug(name: string): string {
  return fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'papel'
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(v => v.trim()) : []
}

/** Lê o JSON da equipe; lança Error com o motivo, em português, quando não serve. */
export function parseTeam(text: string, source: string): Team {
  let raw: unknown
  try {
    // Sem o BOM que o Bloco de Notas e o PowerShell 5 põem no começo do arquivo.
    raw = JSON.parse(stripBom(text))
  } catch {
    throw new Error('não é um JSON válido')
  }
  if (!isObject(raw)) throw new Error('o arquivo precisa ser um objeto com "papeis"')
  const papeis = raw.papeis
  if (!Array.isArray(papeis) || papeis.length === 0) throw new Error('"papeis" precisa ser uma lista com pelo menos 1 papel')
  if (papeis.length > MAX_ROLES) throw new Error(`no máximo ${MAX_ROLES} papéis (há ${papeis.length})`)

  const ids = new Set([LEAD])
  const roles: Role[] = papeis.map((p, i) => {
    if (!isObject(p) || typeof p.nome !== 'string' || !p.nome.trim()) throw new Error(`papel ${i + 1}: falta "nome"`)
    const name = clip(p.nome, 22)
    const model = shortModel(p.modelo)
    if (typeof p.modelo === 'string' && p.modelo.trim() && !model)
      throw new Error(`papel "${name}": modelo "${p.modelo}" desconhecido (use Opus, Sonnet, Haiku ou Fable)`)
    let id = slug(name)
    for (let n = 2; ids.has(id); n++) id = `${slug(name)}-${n}`
    ids.add(id)
    return { id, name, model, keywords: strings(p.palavras), aliases: strings(p.apelidos) }
  })

  const lider = isObject(raw.lider) ? raw.lider : {}
  const lead = {
    name: typeof lider.nome === 'string' && lider.nome.trim() ? clip(lider.nome, 22) : 'Tech Lead',
    model: shortModel(lider.modelo) || 'Opus',
  }
  return { lead, roles, source, warning: '', guide: raw.orientar !== false }
}

/**
 * Onde procurar o .claude/sala-agentes.json do projeto: a pasta atual e as de cima (como o git),
 * depois a pasta em que o chat abriu e as de cima dela. A pasta pessoal fica de fora: o arquivo
 * dela é a equipe da conta, não de um projeto.
 */
export function teamDirs(cwd: string, start: string, home: string): string[] {
  const key = (dir: string) => dir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const homeKey = home ? key(home) : ''
  const dirs: string[] = []
  const seen = new Set<string>()
  for (const from of [cwd, start]) {
    let dir = from.replace(/[\\/]+$/, '')
    for (let depth = 0; dir && depth < 8; depth++) {
      const k = key(dir)
      if (k === homeKey) break
      if (!seen.has(k)) {
        seen.add(k)
        dirs.push(dir)
      }
      const cut = Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'))
      if (cut <= 0) break
      dir = dir.slice(0, cut)
    }
  }
  return dirs
}

export function defaultTeam(): Team {
  return { ...parseTeam(JSON.stringify(DEFAULT_SPEC), 'padrão'), source: 'padrão' }
}

export function isActive(agent: AgentRow): boolean {
  return agent.activity !== 'concluido' && agent.activity !== 'livre'
}

/** Quantos subagentes ativos cada papel tem agora. */
export function loadByRole(agents: Record<string, AgentRow>): Record<string, number> {
  const load: Record<string, number> = {}
  for (const a of Object.values(agents)) if (a.id !== LEAD && isActive(a)) load[a.role] = (load[a.role] ?? 0) + 1
  return load
}

/** Prefixo dos papéis temporários: não estão no arquivo da equipe e somem quando o agente sai. */
export const TEMP = 'tmp-'

export function isTempRole(roleId: string): boolean {
  return roleId.startsWith(TEMP)
}

function sameName(name: string): string {
  return fold(name).replace(/[\s_-]+/g, ' ').trim()
}

// O que vem antes de ":" no começo da descrição ("QA Android: testar").
function rolePrefix(description: string): string | undefined {
  return /^\s*([^:\n]{2,24}):/.exec(description)?.[1]?.trim()
}

// Começos que são verbo, etapa ou código, não papel: "Atualizar:", "F5:", "Bug 12:".
const NOT_ROLE = new Set([
  'fazer', 'escrever', 'rever', 'resolver', 'entender', 'mover', 'ler', 'ver', 'teste', 'tarefa', 'item',
  'fase', 'etapa', 'passo', 'nota', 'bug', 'fix', 'update', 'add', 'remove', 'review', 'check', 'test', 'run',
  'write', 'create', 'build', 'refactor', 'explore', 'investigate', 'find', 'search', 'implement', 'validate',
  'verify', 'research', 'analyze', 'analyse', 'debug', 'task', 'issue', 'ticket', 'step', 'todo', 'wip', 'pr', 'adr',
])
const CONNECTORS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'of', 'and'])

/** Parece nome de papel: até 3 palavras com inicial maiúscula (conectivos à parte), sem ser verbo ou código. */
export function looksLikeRole(prefix: string): boolean {
  const words = prefix.split(/\s+/).filter(Boolean)
  const first = words[0]
  if (!first || words.length > 3 || !/^\p{Lu}[\p{L}\p{N}]*$/u.test(first) || !/\p{L}{2}/u.test(first)) return false
  const head = fold(first)
  if (NOT_ROLE.has(head) || /(?:ar|ir)$/.test(head)) return false
  return words.every(w => CONNECTORS.has(w) || /^[\p{Lu}\p{N}]/u.test(w))
}

function tempRole(prefix: string, model: string): Role {
  const name = clip(prefix, 22)
  return { id: TEMP + slug(name), name, model: shortModel(model), keywords: [], aliases: [] }
}

/**
 * Escolhe o papel de um subagente novo:
 * 0. "Papel: tarefa": papel da equipe com esse nome, ou um papel temporário com esse nome;
 * 1. nome (ou apelido) do papel citado na descrição, depois no prompt: vale o que aparece primeiro;
 * 2. entre os papéis do mesmo modelo (ou todos), o que mais casa palavras-chave da descrição;
 * 3. o papel menos ocupado entre esses.
 */
export function pickRole(
  team: Team,
  load: Record<string, number>,
  spawn: { model: string; type: string; description: string; prompt: string },
): Role {
  const named = (text: string) => {
    const folded = fold(text)
    let best: Role | undefined
    let at = Infinity
    let size = 0
    for (const role of team.roles) {
      for (const name of [role.name, ...role.aliases]) {
        const found = folded.search(mention(name))
        // No mesmo ponto, vale o nome mais longo: "QA E2E" não cai na mesa do "QA".
        if (found >= 0 && (found < at || (found === at && name.length > size))) {
          at = found
          size = name.length
          best = role
        }
      }
    }
    return best
  }
  // "Papel: tarefa" com um papel que a equipe não tem vira mesa temporária ("QA Android: testar o app").
  const prefix = rolePrefix(spawn.description)
  if (prefix) {
    const key = sameName(prefix)
    const known = team.roles.find(r => [r.name, ...r.aliases].some(n => sameName(n) === key))
    if (known) return known
    if (looksLikeRole(prefix)) return tempRole(prefix, spawn.model)
  }

  const byName = named(spawn.description) ?? named(spawn.prompt)
  if (byName) return byName

  const tier = shortModel(spawn.model)
  const sameModel = tier ? team.roles.filter(r => r.model === tier) : []
  const candidates = sameModel.length > 0 ? sameModel : team.roles

  const head = fold(`${spawn.description} ${spawn.type}`)
  let best: Role | undefined
  let score = 0
  for (const role of candidates) {
    const hits = role.keywords.filter(k => startsWord(k).test(head)).length
    if (hits > score) {
      score = hits
      best = role
    }
  }
  if (best) return best

  return candidates.reduce((a, b) => ((load[b.id] ?? 0) < (load[a.id] ?? 0) ? b : a))
}

/**
 * Mesa de um agente novo do papel `role`: a do papel se estiver livre, senão a primeira mesa extra livre.
 * Agentes já concluídos não seguram mesa; quem estiver concluído na mesa escolhida sai da sala.
 */
export function seatAgent(agents: Record<string, AgentRow>, row: AgentRow): Record<string, AgentRow> {
  const others = Object.values(agents).filter(a => a.id !== LEAD && a.id !== row.id)
  const holding = others.filter(isActive)
  let desk = -1
  if (holding.some(a => a.role === row.role && a.desk === -1)) {
    const used = new Set(holding.filter(a => a.desk >= 0).map(a => a.desk))
    desk = 0
    while (used.has(desk)) desk++
  }
  const next: Record<string, AgentRow> = {}
  for (const [id, a] of Object.entries(agents)) {
    const sameDesk = desk === -1 ? a.desk === -1 && a.role === row.role : a.desk === desk
    if (id !== LEAD && id !== row.id && sameDesk && !isActive(a)) continue
    next[id] = a
  }
  next[row.id] = { ...row, desk }
  return next
}

// --- Mesas fixas: editar a equipe do projeto (pelo /sala mesa ou pelo painel web) ---

type FileRole = { nome: string; modelo?: string; palavras?: string[]; apelidos?: string[] }

function list(value: unknown): string[] {
  return strings(value)
}

/** A equipe em uso como conteúdo de sala-agentes.json (para criar o arquivo do projeto a partir dela). */
export function teamToFile(team: Team): Record<string, unknown> {
  return {
    _como_usar: [
      'Equipe da Sala dos Agentes deste projeto. Mesas na ordem dos papéis (as 2 primeiras ficam ao lado do líder).',
      'Edite à mão, pelo /sala mesa + Nome | Modelo | palavras ou pelo painel web; o Tech Lead é avisado da nova formação.',
    ],
    lider: { nome: team.lead.name, modelo: team.lead.model },
    ...(team.guide ? {} : { orientar: false }),
    papeis: team.roles.map(r => ({
      nome: r.name,
      ...(r.model ? { modelo: r.model } : {}),
      palavras: r.keywords,
      ...(r.aliases.length > 0 ? { apelidos: r.aliases } : {}),
    })),
  }
}

function rolesOf(file: Record<string, unknown>): unknown[] {
  return Array.isArray(file.papeis) ? file.papeis : []
}

function roleName(entry: unknown): string {
  return isObject(entry) && typeof entry.nome === 'string' ? entry.nome : ''
}

/** Acrescenta uma mesa ao conteúdo do arquivo da equipe; lança Error com o motivo em português. */
export function addRoleTo(file: Record<string, unknown>, role: FileRole): Record<string, unknown> {
  const nome = (role.nome ?? '').trim()
  if (!nome) throw new Error('falta o nome da mesa')
  const papeis = rolesOf(file)
  if (papeis.some(p => sameName(roleName(p)) === sameName(nome))) throw new Error(`já existe a mesa "${nome}"`)
  if (papeis.length >= MAX_ROLES) throw new Error(`a sala já tem ${MAX_ROLES} mesas, o máximo`)
  const modelo = (role.modelo ?? '').trim()
  const apelidos = list(role.apelidos)
  const entry = { nome, ...(modelo ? { modelo } : {}), palavras: list(role.palavras), ...(apelidos.length > 0 ? { apelidos } : {}) }
  const next = { ...file, papeis: [...papeis, entry] }
  parseTeam(JSON.stringify(next), 'nova equipe')
  return next
}

/** Tira uma mesa (pelo nome, sem diferenciar maiúsculas e acentos); lança Error com o motivo. */
export function removeRoleFrom(file: Record<string, unknown>, nome: string): Record<string, unknown> {
  const papeis = rolesOf(file)
  const rest = papeis.filter(p => sameName(roleName(p)) !== sameName(nome))
  if (rest.length === papeis.length) throw new Error(`não existe a mesa "${nome.trim()}"`)
  if (rest.length === 0) throw new Error('a equipe precisa de pelo menos 1 mesa')
  return { ...file, papeis: rest }
}

export type TeamDiff = { added: Role[]; removed: Role[]; changed: Role[] }

/** O que mudou entre duas formações: mesas que entraram, saíram ou trocaram de modelo. */
export function teamDiff(prev: Team, next: Team): TeamDiff {
  const before = new Map(prev.roles.map(r => [sameName(r.name), r]))
  const after = new Map(next.roles.map(r => [sameName(r.name), r]))
  return {
    added: next.roles.filter(r => !before.has(sameName(r.name))),
    removed: prev.roles.filter(r => !after.has(sameName(r.name))),
    changed: next.roles.filter(r => {
      const old = before.get(sameName(r.name))
      return old !== undefined && old.model !== r.model
    }),
  }
}

/** "Dev Mobile (Sonnet)", ou só o nome quando o papel não fixa modelo. */
export function roleLabel(role: { name: string; model: string }): string {
  return role.model ? `${role.name} (${role.model})` : role.name
}
