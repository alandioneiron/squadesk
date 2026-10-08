// Gera retratos de exemplo (formato plugin/web/SNAPSHOT.md) para testar o painel web sem chats reais.
// Os projetos são fictícios (loja-online, app-financeiro, portal-rh): nenhum dado de usuário entra aqui.
//   node scripts/gerar-exemplos.mts [pasta]     (padrão: plugin/web/sample)
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOOKS = join(ROOT, 'plugin', 'hooks')

// O Node exige a extensão nos imports e o Claude Code não: copia os hooks com "./x.ts".
const tmp = mkdtempSync(join(tmpdir(), 'sala-exemplos-'))
for (const file of ['room.ts', 'team.ts', 'live.ts'])
  writeFileSync(join(tmp, file), readFileSync(join(HOOKS, file), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'"))
const room = await import(pathToFileURL(join(tmp, 'room.ts')).href)
const team = await import(pathToFileURL(join(tmp, 'team.ts')).href)
const live = await import(pathToFileURL(join(tmp, 'live.ts')).href)

const now = Date.now()
const LEAD = team.LEAD

type Trail = { op: string; what: string }[]
type Chat = {
  id: string
  project: string
  title: string
  /** O que o Tech Lead está fazendo (aparece embaixo do nome dele). */
  leadDetail: string
  /** Última linha do log do chat. */
  log: string
  rows: ReturnType<typeof row>[]
  ended?: boolean
  /** Há quantos ms o chat foi gravado pela última vez. */
  age?: number
}

const row = (
  id: string, role: string, roleName: string, model: string, activity: string,
  detail: string, task: string, born: number, tokens: number, trail: Trail,
) => ({
  ...room.emptyLead(),
  id, role, roleName, model, activity, detail, task, born, since: now, tokens, taskStart: now - born * 60_000, trail,
})

function snapshot(c: Chat) {
  let agents: Record<string, unknown> = {
    [LEAD]: { ...room.emptyLead(), activity: 'delegando', detail: c.leadDetail, since: now, tokens: 150_000, taskStart: now - 600_000 },
  }
  for (const r of c.rows) agents = team.seatAgent(agents, r)
  return live.buildSnapshot({
    id: c.id, title: c.title, project: c.project, cwd: `C:\\projetos\\${c.project}`,
    startedAt: now - 3_600_000, now: now - (c.age ?? 0), ended: c.ended ?? false, version: 'exemplo',
    team: team.defaultTeam(), agents, log: [{ at: now - 90_000, text: c.log }],
    daily: { date: live.today(now), roles: [{ role: 'Tech Lead', tasks: 4, ms: 2_400_000, tokens: 180_000 }, { role: 'Dev Backend', tasks: 3, ms: 900_000, tokens: 95_000 }] },
  })
}

const dir = process.argv[2] ?? join(ROOT, 'plugin', 'web', 'sample')
mkdirSync(dir, { recursive: true })
const list = [
  snapshot({
    id: 'exemplo-1', project: 'loja-online', title: 'Checkout com Pix', leadDetail: '→ pagamento Pix',
    log: 'Tech Lead → Dev Backend (Sonnet): Endpoint do QR Code Pix',
    rows: [
      row('b1', 'dev-backend', 'Dev Backend', 'Sonnet', 'editando', 'pix.service.ts', 'Gerar o QR Code Pix no checkout', 1, 42_000,
        [{ op: 'leu', what: 'orders.controller.ts' }, { op: 'editou', what: 'pix.service.ts' }]),
      row('b2', 'dev-backend', 'Dev Backend', 'Sonnet', 'lendo', 'webhook.controller.ts', 'Tratar a confirmação de pagamento', 2, 9_800,
        [{ op: 'buscou', what: 'confirmarPagamento' }, { op: 'leu', what: 'webhook.controller.ts' }]),
      row('q1', 'qa', 'QA', 'Haiku', 'aprovacao', '$ npm run test:e2e', 'Rodar o teste do fluxo de pagamento', 3, 1_700,
        [{ op: 'leu', what: 'checkout.spec.ts' }, { op: 'rodou', what: 'npm run test:e2e' }]),
    ],
  }),
  snapshot({
    id: 'exemplo-2', project: 'app-financeiro', title: 'Tela de extrato', leadDetail: '→ filtro por período', age: 15 * 60_000,
    log: 'Tech Lead → Dev Frontend (Sonnet): Filtro de período do extrato',
    rows: [
      row('f1', 'dev-frontend', 'Dev Frontend', 'Sonnet', 'pensando', '', 'Filtrar o extrato por período', 1, 0,
        [{ op: 'leu', what: 'ExtratoScreen.tsx' }, { op: 'editou', what: 'FiltroPeriodo.tsx' }]),
    ],
  }),
  snapshot({
    id: 'exemplo-3', project: 'portal-rh', title: 'Cadastro de férias', leadDetail: '→ resumo final', ended: true, age: 2 * 3_600_000,
    log: 'Tech Lead → Documentador (Haiku): Guia de uso do portal',
    rows: [],
  }),
]
for (const s of list) writeFileSync(join(dir, `${s.id}.json`), JSON.stringify(s, null, 1))
console.log(`ok: ${list.length} retratos em ${dir}`)
