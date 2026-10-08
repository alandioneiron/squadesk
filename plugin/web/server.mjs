// Squadesk · Painel web da Sala dos Agentes
// Servidor Node puro (sem dependências npm).
// Lê os "retratos" JSON gravados pelo plugin em ~/.claude/sala-agentes/live e mostra tudo ao vivo numa página.
// Única rota que escreve: POST /api/equipe (editor de mesas), que só mexe em <pasta do projeto>\.claude\sala-agentes.json.
// Contrato dos dados: SNAPSHOT.md (mesma pasta).

import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

// ───────────────────────── Configuração ─────────────────────────

const BASE_DIR = path.join(os.homedir(), '.claude', 'sala-agentes')
const CONFIG_FILE = path.join(BASE_DIR, 'web.json')
const LIVE_OVERRIDE = process.env.SALA_LIVE_DIR || ''
const LIVE_DIR = LIVE_OVERRIDE || path.join(BASE_DIR, 'live')
const PORT_OVERRIDE = Number.parseInt(process.env.SALA_PORT || '', 10)
const HAS_PORT_OVERRIDE = Number.isInteger(PORT_OVERRIDE) && PORT_OVERRIDE > 0 && PORT_OVERRIDE < 65536

// Em modo de teste (pasta ou porta sobrescritas) não mexemos em arquivos "de verdade":
// nada de apagar retratos antigos da pasta de teste e nada de regravar as URLs do web.json.
const TEST_MODE = Boolean(LIVE_OVERRIDE) || HAS_PORT_OVERRIDE
const MAX_AGE_MS = 24 * 3600 * 1000 // retratos com mtime mais velho que isso são apagados
const MAX_FILE_BYTES = 2 * 1024 * 1024 // ignora arquivos absurdamente grandes
const TOKEN_RE = /^[A-Za-z0-9._~-]{24,200}$/

function newToken() {
  return crypto.randomBytes(24).toString('base64url') // 32 caracteres
}

function readConfigFile() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, ''))
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {}
  } catch {
    return {}
  }
}

function loadConfig() {
  const c = readConfigFile()
  const port = Number.isInteger(c.port) && c.port > 0 && c.port < 65536 ? c.port : 8787
  const host = typeof c.host === 'string' && c.host ? c.host : '0.0.0.0'
  const token = typeof c.token === 'string' && TOKEN_RE.test(c.token) ? c.token : newToken()
  return { port, host, token, allowRemoteEdit: c.allowRemoteEdit === true }
}

function lanUrls(port, token) {
  const urls = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      const v4 = i.family === 'IPv4' || i.family === 4
      if (!v4 || i.internal) continue
      if (i.address.startsWith('169.254.')) continue // endereço APIPA: não serve de link
      urls.push(`http://${i.address}:${port}/?t=${token}`)
    }
  }
  urls.push(`http://localhost:${port}/?t=${token}`)
  return urls
}

function writeConfig(cfg, urls) {
  // preserva campos que o usuário colocou à mão (ex.: allowRemoteEdit)
  const extra = readConfigFile()
  const body = JSON.stringify({ ...extra, port: cfg.port, host: cfg.host, token: cfg.token, urls }, null, 2) + '\n'
  try {
    fs.mkdirSync(BASE_DIR, { recursive: true })
    const tmp = CONFIG_FILE + '.tmp'
    fs.writeFileSync(tmp, body, 'utf8')
    try {
      fs.renameSync(tmp, CONFIG_FILE)
    } catch {
      fs.writeFileSync(CONFIG_FILE, body, 'utf8')
      try { fs.unlinkSync(tmp) } catch {}
    }
  } catch (e) {
    console.error('Não foi possível gravar web.json:', e.message)
  }
}

const cfg = loadConfig()
const PORT = HAS_PORT_OVERRIDE ? PORT_OVERRIDE : cfg.port
const HOST = cfg.host
const TOKEN = cfg.token
const TOKEN_HASH = crypto.createHash('sha256').update(TOKEN).digest()

// Primeira execução: cria o web.json (inclusive em teste, para o token existir). Sem sobrescrever o que já existe.
if (!fs.existsSync(CONFIG_FILE)) {
  writeConfig(cfg, [])
}

// allowRemoteEdit é relido do web.json (no máximo a cada 5 s): vale sem reiniciar o painel.
let remoteEditCache = { at: 0, v: false }
function allowRemoteEdit() {
  const t = Date.now()
  if (t - remoteEditCache.at > 5000) remoteEditCache = { at: t, v: readConfigFile().allowRemoteEdit === true }
  return remoteEditCache.v
}

function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function canEditReq(req) {
  return isLoopback(req.socket.remoteAddress) || allowRemoteEdit()
}

// ───────────────────────── Leitura dos retratos ─────────────────────────

const cache = new Map() // arquivo -> { mtimeMs, size, snap }

function readSalas() {
  let names
  try {
    names = fs.readdirSync(LIVE_DIR)
  } catch {
    return []
  }
  const now = Date.now()
  const seen = new Set()
  const out = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json')) continue
    const file = path.join(LIVE_DIR, name)
    let st
    try {
      st = fs.statSync(file)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    if (!TEST_MODE && now - st.mtimeMs > MAX_AGE_MS) {
      try { fs.unlinkSync(file) } catch {}
      cache.delete(file)
      continue
    }
    if (st.size > MAX_FILE_BYTES) continue
    seen.add(file)
    let c = cache.get(file)
    if (!c || c.mtimeMs !== st.mtimeMs || c.size !== st.size) {
      try {
        const obj = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          c = { mtimeMs: st.mtimeMs, size: st.size, snap: { ...obj, id: name.slice(0, -5) } }
          cache.set(file, c)
        } else if (!c) {
          continue
        }
      } catch {
        // gravação em andamento ou arquivo corrompido: mantém o último retrato bom, se houver
        if (!c) continue
      }
    }
    out.push(c.snap)
  }
  for (const f of cache.keys()) if (!seen.has(f)) cache.delete(f)
  return out
}

// ───────────────────────── Editor de mesas (POST /api/equipe) ─────────────────────────

const ROLE_MAX = 11 // papéis fixos por projeto
const NAME_MAX = 22
const MODELS = ['Opus', 'Sonnet', 'Haiku', 'Fable']
const EDIT_BODY_MAX = 8 * 1024

class HttpErr extends Error {
  constructor(status, msg) {
    super(msg)
    this.status = status
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const normName = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
const normPath = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))

function canonModel(v) {
  const t = String(v ?? '').trim().toLowerCase()
  return MODELS.find((m) => m.toLowerCase() === t) || ''
}

function cleanName(v) {
  if (typeof v !== 'string') throw new HttpErr(400, 'Informe o nome do papel.')
  const t = v.replace(/\s+/g, ' ').trim()
  if (!t) throw new HttpErr(400, 'Informe o nome do papel.')
  if (t.length > NAME_MAX) throw new HttpErr(400, `O nome do papel aceita até ${NAME_MAX} caracteres.`)
  if (/[\u0000-\u001f\u007f]/.test(t)) throw new HttpErr(400, 'O nome do papel tem caracteres inválidos.')
  return t
}

function cleanList(v, label, maxItems, maxLen, lower) {
  if (v == null) return []
  if (!Array.isArray(v)) throw new HttpErr(400, `${label} deve ser uma lista de textos.`)
  const out = []
  for (const x of v) {
    if (typeof x !== 'string') throw new HttpErr(400, `${label} deve ser uma lista de textos.`)
    let t = x.replace(/\s+/g, ' ').trim()
    if (!t) continue
    if (/[\u0000-\u001f\u007f]/.test(t)) throw new HttpErr(400, `${label} tem caracteres inválidos.`)
    if (t.length > maxLen) throw new HttpErr(400, `Cada item de ${label} aceita até ${maxLen} caracteres.`)
    if (lower) t = t.toLowerCase()
    if (!out.some((y) => normName(y) === normName(t))) out.push(t)
  }
  if (out.length > maxItems) throw new HttpErr(400, `${label} aceita até ${maxItems} itens.`)
  return out
}

function cleanModel(v) {
  if (v == null || v === '') return ''
  const m = canonModel(v)
  if (!m) throw new HttpErr(400, `Modelo inválido. Use ${MODELS.join(', ')} ou deixe em branco.`)
  return m
}

// Monta o arquivo da equipe a partir do retrato (quando o projeto ainda não tem um próprio).
function docFromSnapshot(snap) {
  const t = isObj(snap.team) ? snap.team : {}
  const roles = (Array.isArray(t.roles) ? t.roles : []).filter(isObj).slice(0, ROLE_MAX)
  const papeis = []
  for (const r of roles) {
    let nome
    try { nome = cleanName(String(r.name ?? '')) } catch { continue }
    const item = { nome, modelo: canonModel(r.model), palavras: [] }
    try { item.palavras = cleanList(r.keywords, 'palavras', 20, 30, true) } catch {}
    try {
      const ap = cleanList(r.aliases, 'apelidos', 10, NAME_MAX, false)
      if (ap.length) item.apelidos = ap
    } catch {}
    papeis.push(item)
  }
  let lider = String(t.lead ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  if (!lider) lider = 'Tech Lead'
  return {
    _como_usar: [
      'Equipe deste projeto (criada pelo painel web da Sala dos Agentes). Vale só nesta pasta.',
      'papeis: na ordem das mesas. Citar o nome, um apelido ou uma palavra na tarefa manda direto para a mesa.',
    ],
    lider: { nome: lider, modelo: canonModel(t.leadModel) },
    papeis,
  }
}

// A pasta .claude do projeto tem que ser uma pasta de verdade, dentro do projeto (nada de atalho/junção para fora).
function guardClaudeDir(cwd, dir) {
  const lst = fs.lstatSync(dir)
  if (lst.isSymbolicLink() || !lst.isDirectory()) {
    throw new HttpErr(403, 'A pasta .claude do projeto não é uma pasta comum (é atalho ou arquivo). Edição bloqueada.')
  }
  if (normPath(fs.realpathSync(dir)) !== normPath(path.join(fs.realpathSync(cwd), '.claude'))) {
    throw new HttpErr(403, 'A pasta .claude do projeto aponta para fora do projeto. Edição bloqueada.')
  }
}

// JSON da equipe com 2 espaços, mas palavras e apelidos numa linha só (igual ao que o plugin grava).
function formatTeamDoc(doc) {
  return JSON.stringify(doc, null, 2).replace(/("(?:palavras|apelidos)": )\[([^\]]*)\]/g, (whole, key, items) => {
    try {
      return key + '[' + JSON.parse('[' + items + ']').map((item) => JSON.stringify(item)).join(', ') + ']'
    } catch {
      return whole
    }
  })
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' })
    fs.renameSync(tmp, file)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch {}
    throw new HttpErr(500, 'Não foi possível gravar o arquivo da equipe: ' + (e && e.code ? e.code : 'erro de disco') + '.')
  }
}

function applyEquipe(b) {
  if (!isObj(b)) throw new HttpErr(400, 'Pedido inválido.')
  const id = typeof b.id === 'string' ? b.id : ''
  if (!id || id.length > 200) throw new HttpErr(400, 'Informe o id do chat.')
  if (b.acao !== 'adicionar' && b.acao !== 'remover') throw new HttpErr(400, 'Ação inválida: use "adicionar" ou "remover".')
  if (!isObj(b.papel)) throw new HttpErr(400, 'Informe o papel.')

  const snap = readSalas().find((s) => s.id === id)
  if (!snap) throw new HttpErr(404, 'Chat não encontrado. Ele pode ter sido encerrado.')
  const cwd = typeof snap.cwd === 'string' ? snap.cwd : ''
  if (!cwd || cwd.includes('\0') || !path.isAbsolute(cwd)) {
    throw new HttpErr(400, 'A pasta do projeto desse chat não é um caminho absoluto.')
  }
  let st
  try { st = fs.statSync(cwd) } catch { st = null }
  if (!st || !st.isDirectory()) throw new HttpErr(404, 'A pasta do projeto não existe mais: ' + cwd)

  // valida o pedido antes de mexer em qualquer arquivo
  const adicionar = b.acao === 'adicionar'
  const nome = cleanName(b.papel.nome)
  let novo = null
  if (adicionar) {
    novo = { nome, modelo: cleanModel(b.papel.modelo), palavras: cleanList(b.papel.palavras, 'As palavras', 20, 30, true) }
    const ap = cleanList(b.papel.apelidos, 'Os apelidos', 10, NAME_MAX, false)
    if (ap.length) novo.apelidos = ap
  }

  const dir = path.join(cwd, '.claude')
  const file = path.join(dir, 'sala-agentes.json')
  const rel = path.relative(dir, file)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new HttpErr(403, 'Destino fora da pasta .claude do projeto.')
  const dirExists = fs.existsSync(dir)
  if (dirExists) guardClaudeDir(cwd, dir)

  let doc
  if (fs.existsSync(file)) {
    if (fs.lstatSync(file).isSymbolicLink()) throw new HttpErr(403, 'O arquivo da equipe é um atalho. Edição bloqueada.')
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
    } catch {
      throw new HttpErr(409, 'O arquivo da equipe deste projeto tem JSON inválido. Corrija-o à mão antes de editar por aqui.')
    }
    if (!isObj(doc) || !Array.isArray(doc.papeis)) {
      throw new HttpErr(409, 'O arquivo da equipe deste projeto não tem a lista "papeis". Corrija-o à mão.')
    }
  } else {
    doc = docFromSnapshot(snap)
  }

  const papeis = doc.papeis
  const names = papeis.map((p) => (isObj(p) && typeof p.nome === 'string' ? p.nome : ''))
  const liderNome = isObj(doc.lider) && typeof doc.lider.nome === 'string' ? doc.lider.nome : ''

  if (adicionar) {
    if (liderNome && normName(liderNome) === normName(nome)) throw new HttpErr(409, `"${nome}" já é o nome do líder da equipe.`)
    if (names.some((n) => normName(n) === normName(nome))) throw new HttpErr(409, `Já existe um papel chamado "${nome}" nesta equipe.`)
    if (papeis.length >= ROLE_MAX) {
      throw new HttpErr(400, `A equipe já tem ${ROLE_MAX} papéis, o máximo. Tire um antes de adicionar outro.`)
    }
    papeis.push(novo)
  } else {
    const i = names.findIndex((n) => normName(n) === normName(nome))
    if (i < 0) throw new HttpErr(404, `O papel "${nome}" não está na equipe deste projeto.`)
    if (papeis.length <= 1) throw new HttpErr(400, 'Não dá para remover o último papel: a equipe precisa de pelo menos 1.')
    papeis.splice(i, 1)
  }

  if (!dirExists) {
    try { fs.mkdirSync(dir, { recursive: true }) } catch { throw new HttpErr(500, 'Não foi possível criar a pasta .claude do projeto.') }
  }
  guardClaudeDir(cwd, dir)
  writeAtomic(file, formatTeamDoc(doc) + '\n')
  console.log(`Equipe editada (${b.acao} "${nome}"): ${file}`)
  return { ok: true, papeis: papeis.map((p) => (isObj(p) && typeof p.nome === 'string' ? p.nome : '')).filter(Boolean) }
}

function handleEquipe(req, res) {
  const fail = (status, erro) => {
    req.resume()
    send(req, res, status, 'application/json; charset=utf-8', JSON.stringify({ ok: false, erro }), { Connection: 'close' })
  }
  if (!canEditReq(req)) {
    fail(403, 'Edição liberada só no próprio computador. Abra o painel por localhost para editar as mesas.')
    return
  }
  if (req.headers['x-sala-edit'] !== '1') {
    fail(403, 'Pedido sem o cabeçalho X-Sala-Edit.')
    return
  }
  const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (ct !== 'application/json') {
    fail(400, 'O pedido precisa ser application/json.')
    return
  }
  const origin = req.headers.origin
  if (origin !== undefined) {
    let host = ''
    try { host = new URL(String(origin)).host.toLowerCase() } catch {}
    if (!host || host !== String(req.headers.host || '').toLowerCase()) {
      fail(403, 'Origem não permitida.')
      return
    }
  }
  const declared = Number.parseInt(String(req.headers['content-length'] || '0'), 10)
  if (declared > EDIT_BODY_MAX) {
    fail(400, 'Pedido grande demais (máximo 8 KB).')
    return
  }

  const chunks = []
  let size = 0
  let over = false
  req.on('data', (c) => {
    if (over) return
    size += c.length
    if (size > EDIT_BODY_MAX) {
      over = true
      chunks.length = 0
      fail(400, 'Pedido grande demais (máximo 8 KB).')
      return
    }
    chunks.push(c)
  })
  req.on('error', () => {})
  req.on('end', () => {
    if (over) return
    let status = 200
    let out
    try {
      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        throw new HttpErr(400, 'JSON inválido no pedido.')
      }
      out = applyEquipe(body)
    } catch (e) {
      if (e instanceof HttpErr) {
        status = e.status
        out = { ok: false, erro: e.message }
      } else {
        console.error('Erro ao editar a equipe:', e)
        status = 500
        out = { ok: false, erro: 'Erro interno ao editar a equipe.' }
      }
    }
    send(req, res, status, 'application/json; charset=utf-8', JSON.stringify(out))
  })
}

// ───────────────────────── HTTP ─────────────────────────

const SEC_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
}

function send(req, res, status, type, body, extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8')
  const headers = { ...SEC_HEADERS, 'Content-Type': type, ...extra }
  const head = req.method === 'HEAD'
  if (buf.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    zlib.gzip(buf, (err, z) => {
      if (err) {
        headers['Content-Length'] = buf.length
        res.writeHead(status, headers)
        res.end(head ? undefined : buf)
        return
      }
      headers['Content-Encoding'] = 'gzip'
      headers['Vary'] = 'Accept-Encoding'
      headers['Content-Length'] = z.length
      res.writeHead(status, headers)
      res.end(head ? undefined : z)
    })
    return
  }
  headers['Content-Length'] = buf.length
  res.writeHead(status, headers)
  res.end(head ? undefined : buf)
}

function tokenOk(v) {
  if (typeof v !== 'string' || !v || v.length > 256) return false
  const h = crypto.createHash('sha256').update(v).digest() // mesmo tamanho dos dois lados
  return crypto.timingSafeEqual(h, TOKEN_HASH)
}

function cookieToken(req) {
  const raw = String(req.headers.cookie || '')
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === 'sala_t') return part.slice(i + 1).trim()
  }
  return ''
}

const SIMPLE_STYLE = `<style>html,body{margin:0;height:100%;background:#131311;color:#EFEBE2;font:16px "Segoe UI",system-ui,sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center}
b{letter-spacing:.16em;background:linear-gradient(90deg,#FECB81,#C9A24B,#946930);-webkit-background-clip:text;background-clip:text;color:transparent;font-size:22px}
p{margin:0;color:#A39C8F}h1{margin:0;font-size:20px;color:#E16B01}a{color:#C9A24B}</style>`

const DENIED_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso negado</title>
${SIMPLE_STYLE}</head>
<body><main><b>SQUADESK</b><h1>Acesso negado</h1><p>Acesso negado: abra o link completo com a chave.</p></main></body></html>`

const NOTFOUND_HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sala não encontrada</title>
${SIMPLE_STYLE}</head>
<body><main><b>SQUADESK</b><h1>Sala não encontrada</h1><p>Esse chat pode ter sido encerrado ou removido.</p><p><a href="/">← todas as salas</a></p></main></body></html>`

function handle(req, res) {
  const method = req.method
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    send(req, res, 405, 'text/plain; charset=utf-8', 'Método não permitido', { Allow: 'GET, HEAD, POST' })
    return
  }
  const isPost = method === 'POST'

  // Separa caminho e query na mão (new URL trataria "//host" como outro servidor)
  const rawUrl = String(req.url || '/')
  const qi = rawUrl.indexOf('?')
  let pathname = qi < 0 ? rawUrl : rawUrl.slice(0, qi)
  const search = qi < 0 ? '' : rawUrl.slice(qi + 1)
  pathname = '/' + pathname.replace(/^\/+/, '')

  if (pathname === '/health' && !isPost) {
    send(req, res, 200, 'text/plain; charset=utf-8', 'ok')
    return
  }

  // Autenticação: ?t= (grava cookie e redireciona) ou cookie sala_t
  let qs
  try { qs = new URLSearchParams(search) } catch { qs = new URLSearchParams() }
  const qt = qs.get('t')
  if (!isPost && qt !== null && tokenOk(qt)) {
    qs.delete('t')
    const rest = qs.toString()
    res.writeHead(302, {
      ...SEC_HEADERS,
      Location: pathname + (rest ? '?' + rest : ''),
      'Set-Cookie': `sala_t=${TOKEN}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}`,
      'Content-Length': 0,
    })
    res.end()
    return
  }
  const authed = tokenOk(cookieToken(req)) || (isPost && qt !== null && tokenOk(qt))
  if (!authed) {
    if (isPost) req.resume()
    send(req, res, 401, 'text/html; charset=utf-8', DENIED_HTML, isPost ? { Connection: 'close' } : {})
    return
  }

  if (isPost) {
    if (pathname === '/api/equipe') {
      handleEquipe(req, res)
      return
    }
    req.resume()
    send(req, res, 405, 'text/plain; charset=utf-8', 'Método não permitido', { Allow: 'GET, HEAD', Connection: 'close' })
    return
  }

  if (pathname === '/') {
    send(req, res, 200, 'text/html; charset=utf-8', PAGE)
    return
  }
  const sm = pathname.match(/^\/sala\/([^/]+)\/?$/)
  if (sm) {
    let id = ''
    try { id = decodeURIComponent(sm[1]) } catch {}
    if (id && readSalas().some((s) => s.id === id)) send(req, res, 200, 'text/html; charset=utf-8', PAGE)
    else send(req, res, 404, 'text/html; charset=utf-8', NOTFOUND_HTML)
    return
  }
  if (pathname === '/api/salas') {
    send(
      req, res, 200, 'application/json; charset=utf-8',
      JSON.stringify({ serverNow: Date.now(), canEdit: canEditReq(req), salas: readSalas() }),
    )
    return
  }
  send(req, res, 404, 'text/plain; charset=utf-8', 'Não encontrado')
}

const server = http.createServer((req, res) => {
  try {
    handle(req, res)
  } catch (e) {
    console.error('Erro ao atender', req.url, e)
    try {
      if (!res.headersSent) res.writeHead(500, { ...SEC_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Erro interno')
    } catch {}
  }
})

process.on('uncaughtException', (e) => console.error('Erro não tratado:', e))
process.on('unhandledRejection', (e) => console.error('Promessa rejeitada:', e))

server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.log(`Painel já está em execução (porta ${PORT} ocupada). Saindo.`)
    process.exit(0)
  }
  console.error('Falha ao iniciar o painel:', e)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  const urls = lanUrls(PORT, TOKEN)
  console.log(`Sala dos Agentes · painel em http://localhost:${PORT}/  (pasta: ${LIVE_DIR})`)
  if (TEST_MODE) return
  writeConfig(cfg, urls)
  // A rede às vezes sobe depois do login: reavalia os IPs de tempos em tempos e regrava só se mudar.
  let last = JSON.stringify(urls)
  setInterval(() => {
    const now = lanUrls(PORT, TOKEN)
    const s = JSON.stringify(now)
    if (s !== last) {
      last = s
      writeConfig(cfg, now)
    }
  }, 60_000)
})

// ───────────────────────── Página (HTML + CSS + JS embutidos) ─────────────────────────
// Atenção: o JS do cliente não pode conter crases nem "${" (está dentro de um String.raw).

const PAGE = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Squadesk · Sala dos Agentes</title>
<style>
:root{--bg:#131311;--card:#1B1A17;--line:#2C2A25;--tx:#EFEBE2;--tx2:#A39C8F;--gold:#C9A24B;--org:#E16B01;--grn:#54B45F}
*{box-sizing:border-box}
html{background:var(--bg);color-scheme:dark;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.45 "Segoe UI",system-ui,-apple-system,Roboto,sans-serif;font-variant-numeric:tabular-nums;overflow-x:hidden}
[hidden]{display:none!important}
a{color:var(--gold);text-decoration:none}
a:hover{text-decoration:underline}
ul{list-style:none}
.wrap{max-width:1500px;margin:0 auto;padding:12px 16px 40px}
.top{display:flex;align-items:center;flex-wrap:wrap;gap:8px 16px;padding:6px 0 14px;border-bottom:1px solid var(--line);margin-bottom:16px}
.title{font-size:20px;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;min-width:0;margin-right:auto}
.brand{font-weight:800;letter-spacing:.16em;background:linear-gradient(90deg,#FECB81,#C9A24B 55%,#946930);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
.sep{color:var(--tx2)}
.sub{font-weight:600}
.conn{font-size:12px;color:var(--tx2);display:flex;align-items:center;gap:6px;white-space:nowrap}
.conn i{width:8px;height:8px;border-radius:50%;background:var(--grn);display:inline-block}
.conn.off{color:var(--org)}
.conn.off i{background:var(--org)}
.back{margin:0 0 12px;font-size:13px}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--card)}
.seg button{background:none;border:0;color:var(--tx2);font-weight:600;font-size:13px;padding:6px 14px;cursor:pointer;border-right:1px solid var(--line)}
.seg button:last-child{border-right:0}
.seg button:hover{color:var(--tx)}
.seg button[aria-pressed=true]{background:var(--gold);color:#1B1A17}
.seg.sm button{padding:4px 11px;font-size:12px}
.btn{font-size:13px;font-weight:600;color:var(--tx);background:#242219;border:1px solid var(--line);border-radius:8px;padding:5px 12px;cursor:pointer;white-space:nowrap}
.btn:hover:not(:disabled){border-color:var(--gold)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn.pri{background:var(--gold);border-color:var(--gold);color:#1B1A17}
.btn.dng{border-color:var(--org);color:var(--org)}
.btn.ico{padding:3px 9px;line-height:1.2}
button:focus-visible,.row:focus-visible,.tile:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.alert{display:flex;align-items:center;gap:10px;width:100%;margin:0 0 12px;padding:9px 14px;border-radius:10px;border:1px solid var(--org);background:rgba(225,107,1,.14);color:var(--tx);font-size:14px;cursor:pointer;text-align:left}
.alert b{color:var(--org)}
.alert::before{content:"";flex:none;width:9px;height:9px;border-radius:50%;background:var(--org);animation:pulse 1.4s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;min-width:0}
.stat b{display:block;font-size:26px;line-height:1.15;font-weight:700}
.stat span{color:var(--tx2);font-size:12px}
.stat.attn{border-color:var(--org)}
.stat.attn b{color:var(--org)}

/* cartões e detalhe da sala */
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;min-width:0}
.card.attn{border-color:var(--org);box-shadow:0 0 0 1px var(--org)}
.det{container-type:inline-size}
.ch{display:flex;align-items:center;gap:10px;padding:12px 14px 2px}
.proj{font-size:17px;font-weight:700;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;margin-right:auto}
.badge{flex:none;font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;border:1px solid var(--line)}
.badge.work{color:var(--grn);border-color:var(--grn);background:rgba(84,180,95,.1)}
.badge.wait{color:#fff;background:var(--org);border-color:var(--org)}
.badge.idle,.badge.end{color:var(--tx2)}
.meta{padding:0 14px 10px;color:var(--tx2);font-size:12px}
.age.old{color:var(--org)}
.art{display:block;width:100%;height:auto;background:#0E0E0C}
.ags{margin:0;padding:6px 14px 4px}
.ag{display:flex;gap:10px;padding:9px 0;border-top:1px solid var(--line)}
.ag:first-child{border-top:0}
.dot{flex:none;width:10px;height:10px;border-radius:50%;margin-top:6px;background:var(--tx2)}
.agb{min-width:0;flex:1}
.agt{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px}
.agt b{font-weight:600;overflow-wrap:anywhere}
.mdl{font-size:11px;color:var(--tx2);border:1px solid var(--line);border-radius:6px;padding:0 6px}
.lbl{font-size:13px}
.agr{margin-left:auto;color:var(--tx2);font-size:12px;white-space:nowrap}
.since:not([hidden])::after{content:" · "}
.det-l{font-family:Consolas,"Cascadia Mono",monospace;font-size:12px;overflow-wrap:anywhere;margin-top:2px}
.tsk{color:var(--tx2);font-size:12px;overflow-wrap:anywhere;margin-top:1px}
details.trail{margin-top:3px;font-size:12px;color:var(--tx2)}
details.trail>summary,details.stale>summary{cursor:pointer;user-select:none}
details.trail ul{margin:4px 0 2px;padding:0 0 0 8px;border-left:2px solid var(--line)}
details.trail li{overflow-wrap:anywhere;padding:1px 0}
.op{color:var(--gold);margin-right:6px}
.log{margin:0;padding:8px 14px;border-top:1px solid var(--line);font-size:12px;color:var(--tx2)}
.log li{overflow-wrap:anywhere;padding:1px 0}
.log time{color:var(--gold);margin-right:8px}
.ft{padding:8px 14px 12px;font-size:12px}
.dbody{display:block}
@container (min-width:880px){
  .dbody{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:start}
  .dart{border-right:1px solid var(--line)}
  .dside .ags{padding-top:2px}
  .dside .log:first-child{border-top:0}
}
h2{font-size:15px;margin:26px 0 10px;font-weight:700}
details.stale{margin-top:10px}
details.stale>summary{font-size:14px;font-weight:700;margin-bottom:8px;color:var(--tx2)}
details.stale[open]>summary{color:var(--tx)}
.empty{background:var(--card);border:1px dashed var(--line);border-radius:12px;padding:22px;text-align:center;color:var(--tx2)}
.tbl{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--card)}
table{width:100%;border-collapse:collapse}
th,td{padding:8px 12px;text-align:right;border-bottom:1px solid var(--line)}
th:first-child,td:first-child{text-align:left;overflow-wrap:anywhere}
th{color:var(--tx2);font-weight:600;font-size:12px}
tbody tr:last-child td{border-bottom:0}
tfoot td{font-weight:700;border-top:1px solid var(--line);border-bottom:0;color:var(--gold)}
.note{color:var(--tx2);font-size:12px;margin-top:22px;text-align:center}

/* bolinha de estado */
.sd{flex:none;width:10px;height:10px;border-radius:50%;background:var(--tx2);display:inline-block}
.sd.work{background:var(--grn);box-shadow:0 0 8px rgba(84,180,95,.6)}
.sd.wait{background:var(--org);box-shadow:0 0 8px rgba(225,107,1,.8);animation:pulse 1.4s ease-in-out infinite}
.sd.end{opacity:.4}

/* modo Lista */
.v-lista{display:grid;grid-template-columns:minmax(280px,340px) minmax(0,1fr);gap:14px;align-items:start}
.lst{position:sticky;top:12px;max-height:calc(100vh - 24px);overflow:auto;display:flex;flex-direction:column;gap:6px;padding:2px}
.lsta{display:flex;flex-direction:column;gap:6px}
.row{display:grid;grid-template-columns:12px minmax(0,1fr) auto;gap:1px 10px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);cursor:pointer}
.row:hover{border-color:#4a4536}
.row.sel{border-color:var(--gold);box-shadow:inset 3px 0 0 var(--gold)}
.row.attn{border-color:var(--org)}
.row .sd{grid-row:1/4;margin-top:5px}
.rt{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rago,.rk,.rp{font-size:12px;color:var(--tx2);white-space:nowrap}
.rp{overflow:hidden;text-overflow:ellipsis}
.rc{grid-column:2/4;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rc.work{color:var(--grn)}
.rc.wait{color:var(--org);font-weight:600}
.rc.idle,.rc.end{color:var(--tx2)}
.row.dim{opacity:.75}
body[data-modo=one] .lst{display:none}
body[data-modo=one] .v-lista{grid-template-columns:minmax(0,1fr)}
body[data-modo=one] .wrap{max-width:1700px}

/* modo Mosaico */
.v-mosaico{display:flex;flex-direction:column;gap:8px}
.mtool{display:flex;align-items:center;flex-wrap:wrap;gap:8px 14px}
.mtool .sp{margin-left:auto}
.mst{font-size:12px;color:var(--tx2)}
.pager{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--tx2)}
.mbody{flex:1;min-height:0;display:flex;gap:12px}
.mgrid{flex:1;min-width:0;min-height:0;display:grid;gap:8px}
.mgrid[data-div="1"]{grid-template:minmax(0,1fr)/minmax(0,1fr)}
.mgrid[data-div="4"]{grid-template:repeat(2,minmax(0,1fr))/repeat(2,minmax(0,1fr))}
.mgrid[data-div="6"],.mgrid[data-div="9"]{grid-template:repeat(3,minmax(0,1fr))/repeat(3,minmax(0,1fr))}
.mgrid[data-div="16"]{grid-template:repeat(4,minmax(0,1fr))/repeat(4,minmax(0,1fr))}
.mgrid[data-div="6"]>:first-child{grid-area:1/1/3/3}
.tile{position:relative;min-width:0;min-height:0;background:#0E0E0C;border:2px solid var(--line);border-radius:10px;overflow:hidden;cursor:pointer}
.tile:hover{border-color:#4a4536}
.tile .timg{position:absolute;left:0;top:0;width:100%;height:calc(100% - 34px);object-fit:contain;display:block}
.tile.attn{border-color:var(--org);box-shadow:0 0 0 1px var(--org),0 0 18px rgba(225,107,1,.4)}
.tile.sel{border-color:var(--gold)}
.tbar{position:absolute;left:0;right:0;bottom:0;height:34px;display:flex;align-items:center;gap:8px;padding:0 10px;background:#161512;border-top:1px solid var(--line);font-size:13px;white-space:nowrap}
.tt{font-weight:600;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto}
.ts{margin-left:auto;font-size:12px;flex:0 4 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.ts.work{color:var(--grn)}
.ts.wait{color:var(--org);font-weight:700}
.ts.idle,.ts.end{color:var(--tx2)}
.tile.empty{cursor:default;background:repeating-linear-gradient(45deg,#17160F 0,#17160F 10px,#131311 10px,#131311 20px);opacity:.6;display:flex;align-items:center;justify-content:center;color:var(--tx2);font-size:12px;letter-spacing:.18em;text-transform:uppercase}
.tile.empty:hover{border-color:var(--line)}
.mgrid[data-div="16"] .tbar{height:28px;font-size:11px;padding:0 7px}
.mgrid[data-div="16"] .tile .timg{height:calc(100% - 28px)}
.mgrid[data-div="16"] .ts{font-size:10px}
.mdet{flex:none;width:min(500px,40vw);overflow:auto;min-height:0}
.mdet .card{height:auto}

/* modo TV */
.v-tv{display:flex;flex-direction:column;gap:10px;min-height:0;font-size:clamp(15px,1.25vw,24px)}
.tvtop{display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px}
.tvtitle{font-size:1.9em;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v-tv .badge{font-size:.85em;padding:2px 14px}
.seal{background:var(--org);color:#fff;font-weight:800;letter-spacing:.08em;font-size:.95em;padding:3px 16px;border-radius:999px;animation:pulse 1.4s ease-in-out infinite;text-transform:uppercase}
.tvpos{color:var(--tx2);font-size:.9em}
.tvtop .sp{margin-left:auto}
.tvctl{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tvmain{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px}
.tvart{display:flex;align-items:center;justify-content:center;background:#0E0E0C;border:1px solid var(--line);border-radius:14px;overflow:hidden;min-height:0;position:relative}
.tvart img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.tvart.attn{border-color:var(--org);box-shadow:0 0 0 2px var(--org)}
.tvag{min-height:0;overflow:hidden;display:flex;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:6px 16px}
.tvsub{color:var(--tx2);font-size:.9em;padding:8px 0 4px}
.tvag .ags{padding:0;overflow:hidden}
.tvag .ag{padding:12px 0}
.tvag .agt b{font-size:1.2em}
.tvag .lbl{font-size:1em}
.tvag .mdl{font-size:.75em}
.tvag .agr{font-size:.85em}
.tvag .det-l{font-size:.85em;margin-top:3px}
.tvag .tsk{font-size:.85em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tvag .dot{width:14px;height:14px;margin-top:8px}
.tvnone{margin:auto;color:var(--tx2);font-size:1.1em;text-align:center;padding:20px}
.tvfoot{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.prog{flex:1;min-width:160px;height:8px;border-radius:99px;background:var(--line);overflow:hidden}
.prog i{display:block;height:100%;width:0;background:var(--gold);transition:width .12s linear}
.prog.hold i{background:var(--org);width:100%!important}
.dots{display:flex;gap:7px;flex-wrap:wrap}
.dots i{width:12px;height:12px;border-radius:50%;background:var(--line)}
.dots i.cur{background:var(--gold);box-shadow:0 0 0 2px rgba(201,162,75,.35)}
.dots i.w{background:var(--org)}
.tvnext{color:var(--tx2);font-size:.9em;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tvnext b{color:var(--tx);font-weight:600}

/* editor de mesas */
.modal{position:fixed;inset:0;z-index:50;background:rgba(8,8,7,.72);display:flex;align-items:flex-start;justify-content:center;padding:6vh 14px 14px;overflow:auto}
.mbox{width:min(560px,100%);background:var(--card);border:1px solid var(--gold);border-radius:14px;padding:14px 16px 16px;box-shadow:0 18px 60px rgba(0,0,0,.6)}
.mh{display:flex;align-items:center;gap:10px}
.mh b{font-size:17px;margin-right:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.msub{color:var(--tx2);font-size:12px;margin:6px 0 10px;overflow-wrap:anywhere}
.roles{margin:0 0 12px;padding:0;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.rl{display:flex;align-items:center;gap:10px;padding:7px 10px;border-top:1px solid var(--line)}
.rl:first-child{border-top:0}
.rl.lead{background:#201E19}
.rl-main{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px}
.rl-main b{font-weight:600}
.rl-kw{flex-basis:100%;font-size:12px;color:var(--tx2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rl-conf{flex:1;display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;font-size:13px}
.rl-conf span{margin-right:auto;overflow-wrap:anywhere}
.mform h3{font-size:14px;margin:0 0 8px}
.fld{display:block;margin-bottom:8px;font-size:12px;color:var(--tx2)}
.fld input,.fld select{display:block;width:100%;margin-top:3px;background:#12110F;color:var(--tx);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:14px}
.fld input:disabled,.fld select:disabled{opacity:.5}
.frow{display:grid;grid-template-columns:1fr 150px;gap:10px}
.mact{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin-top:4px}
.fmsg{flex:1;min-width:180px;font-size:13px}
.fmsg.err{color:var(--org)}
.fmsg.ok{color:var(--grn)}

/* altura útil: Mosaico e TV ocupam a janela inteira (só em telas largas) */
body.fit .stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
body.fit .stat{display:flex;align-items:baseline;gap:8px;padding:4px 12px;border-radius:10px}
body.fit .stat b{font-size:18px;display:inline}
body.fit .note{display:none}
@media (min-width:800px){
  body.fit{height:100vh;height:100dvh;overflow:hidden}
  body.fit .wrap{max-width:none;height:100vh;height:100dvh;display:flex;flex-direction:column;padding:8px 16px 12px}
  body.fit .top{padding:2px 0 8px;margin-bottom:8px}
  body.fit #main{flex:1;min-height:0;display:flex;flex-direction:column}
  body.fit .v-mosaico,body.fit .v-tv{flex:1;min-height:0}
}
@media (max-width:799px){
  .v-lista{grid-template-columns:minmax(0,1fr)}
  .lst{position:static;max-height:42vh}
  .mbody{flex-direction:column}
  .mgrid{flex:none;aspect-ratio:1.3}
  .mdet{width:auto}
  .tvmain{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto}
  .tvart{aspect-ratio:1.4}
  .tvnext{max-width:100%}
  .frow{grid-template-columns:1fr}
}
@media (max-width:520px){.wrap{padding:10px 12px 32px}.title{font-size:17px}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:12px}.stat{padding:8px 12px}.stat b{font-size:22px}th,td{padding:7px 8px}.seg button{padding:6px 11px}}
</style>
</head>
<body data-modo="lista">
<div class="wrap" id="wrap">
  <header class="top">
    <div class="title"><span class="brand">SQUADESK</span><span class="sep">·</span><span class="sub">Sala dos Agentes</span></div>
    <div class="seg" id="seg" role="group" aria-label="Modo de visualização">
      <button type="button" data-modo="lista" aria-pressed="false">Lista</button>
      <button type="button" data-modo="mosaico" aria-pressed="false">Mosaico</button>
      <button type="button" data-modo="tv" aria-pressed="false">TV</button>
    </div>
    <div class="conn" id="conn"><i></i><span id="connt">carregando…</span></div>
  </header>
  <p class="back" id="back" hidden><a href="/">← todas as salas</a></p>
  <button type="button" class="alert" id="alert" hidden><b id="alert-n"></b><span id="alert-t"></span></button>
  <section class="stats" id="stats">
    <div class="stat"><b id="s-chats">–</b><span>chats ativos</span></div>
    <div class="stat"><b id="s-busy">–</b><span>agentes trabalhando</span></div>
    <div class="stat" id="s-wait-box"><b id="s-wait">–</b><span>aguardando aprovação</span></div>
    <div class="stat"><b id="s-tok">–</b><span>tokens hoje</span></div>
  </section>
  <div class="empty" id="empty" hidden></div>
  <main id="main">
    <section class="v-lista" id="v-lista" hidden>
      <aside class="lst" id="lst" aria-label="Chats">
        <div class="lsta" id="lst-act"></div>
        <details class="stale" id="stale" hidden>
          <summary id="stale-sum">Parados</summary>
          <div class="lsta" id="lst-stale"></div>
        </details>
      </aside>
      <div id="dest"></div>
    </section>
    <section class="v-mosaico" id="v-mosaico" hidden>
      <div class="mtool">
        <div class="seg sm" id="divs" role="group" aria-label="Divisão da tela">
          <button type="button" data-div="auto" aria-pressed="false">Auto</button>
          <button type="button" data-div="1" aria-pressed="false">1</button>
          <button type="button" data-div="4" aria-pressed="false">4</button>
          <button type="button" data-div="6" aria-pressed="false">6</button>
          <button type="button" data-div="9" aria-pressed="false">9</button>
          <button type="button" data-div="16" aria-pressed="false">16</button>
        </div>
        <span class="mst" id="mst"></span>
        <div class="pager sp" id="pager" hidden>
          <button type="button" class="btn ico" id="pg-prev" aria-label="Página anterior">‹</button>
          <span id="pg-txt"></span>
          <button type="button" class="btn ico" id="pg-next" aria-label="Próxima página">›</button>
        </div>
      </div>
      <div class="mbody">
        <div class="mgrid" id="mgrid" data-div="4"></div>
        <div class="mdet" id="mdet" hidden></div>
      </div>
    </section>
    <section class="v-tv" id="v-tv" hidden>
      <div class="tvtop">
        <span class="tvtitle" id="tv-title"></span>
        <span class="badge" id="tv-badge"></span>
        <span class="seal" id="tv-seal" hidden>aguardando você</span>
        <span class="tvpos" id="tv-pos"></span>
        <div class="tvctl sp">
          <div class="seg sm" id="tv-tempo" role="group" aria-label="Tempo por chat">
            <button type="button" data-t="5" aria-pressed="false">5 s</button>
            <button type="button" data-t="10" aria-pressed="false">10 s</button>
            <button type="button" data-t="20" aria-pressed="false">20 s</button>
            <button type="button" data-t="30" aria-pressed="false">30 s</button>
          </div>
          <button type="button" class="btn" id="tv-prev" aria-label="Chat anterior">‹</button>
          <button type="button" class="btn" id="tv-pause">Pausar</button>
          <button type="button" class="btn" id="tv-next" aria-label="Próximo chat">›</button>
        </div>
      </div>
      <div class="tvmain">
        <div class="tvart" id="tv-art"><img id="tv-img" alt="Desenho da sala"></div>
        <div class="tvag">
          <div class="tvsub" id="tv-sub"></div>
          <ul class="ags" id="tv-ags"></ul>
          <p class="tvnone" id="tv-none" hidden>Ninguém trabalhando agora.</p>
        </div>
      </div>
      <div class="tvfoot">
        <div class="prog" id="tv-prog"><i></i></div>
        <div class="dots" id="tv-dots"></div>
        <span class="tvnext" id="tv-nextlbl"></span>
      </div>
    </section>
  </main>
  <section id="daily">
    <h2 id="daily-h">Resumo do dia</h2>
    <div class="empty" id="daily-empty" hidden>Sem atividade registrada hoje.</div>
    <div class="tbl" id="daily-tbl" hidden>
      <table>
        <thead><tr><th>Papel</th><th>Tarefas</th><th>Tempo</th><th>Tokens</th></tr></thead>
        <tbody id="daily-body"></tbody>
        <tfoot><tr><td>Total</td><td id="t-tasks"></td><td id="t-ms"></td><td id="t-tok"></td></tr></tfoot>
      </table>
    </div>
  </section>
  <p class="note">Atualiza sozinho a cada 2 segundos</p>
</div>

<div class="modal" id="modal" hidden>
  <div class="mbox" role="dialog" aria-modal="true" aria-labelledby="m-title">
    <div class="mh"><b id="m-title">Mesas</b><button type="button" class="btn ico" id="m-close" aria-label="Fechar">✕</button></div>
    <p class="msub" id="m-sub"></p>
    <ul class="roles" id="m-roles"></ul>
    <form class="mform" id="m-form" novalidate>
      <h3>Adicionar mesa</h3>
      <div class="frow">
        <label class="fld">Nome (até 22 letras)<input id="f-nome" maxlength="22" autocomplete="off"></label>
        <label class="fld">Modelo<select id="f-modelo">
          <option value="">(sem modelo)</option><option value="Opus">Opus</option><option value="Sonnet" selected>Sonnet</option><option value="Haiku">Haiku</option><option value="Fable">Fable</option>
        </select></label>
      </div>
      <label class="fld">Palavras que chamam essa mesa (separadas por vírgula)<input id="f-pal" autocomplete="off" placeholder="ex.: api, banco, backend"></label>
      <label class="fld">Apelidos (opcional, separados por vírgula)<input id="f-ape" autocomplete="off"></label>
      <div class="mact"><button type="submit" class="btn pri" id="f-ok">Adicionar</button><span class="fmsg" id="f-msg" role="status"></span></div>
    </form>
  </div>
</div>

<script>
(function () {
  'use strict';

  // ── utilidades ──
  var $ = function (s) { return document.querySelector(s); };
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function setText(e, t) { t = str(t); if (e.textContent !== t) e.textContent = t; }
  function setCls(e, c) { if (e.className !== c) e.className = c; }
  function hexColor(c, fb) { return /^#[0-9a-fA-F]{6}$/.test(c) ? c : fb; }
  function strArr(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string'; }) : []; }
  function norm(s) { return str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' '); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  var nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
  var TZ = 'America/Sao_Paulo';
  var dfParts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  var dfHour = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

  var offset = 0; // serverNow - Date.now() medido no último fetch
  function now() { return Date.now() + offset; }

  function todayStr() {
    var p = {};
    dfParts.formatToParts(new Date(now())).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function fmtAgo(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + ' s';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60); m = m % 60;
    return h + ' h ' + (m < 10 ? '0' : '') + m + ' min';
  }
  function fmtDur(ms) {
    var m = Math.round(num(ms) / 60000);
    if (m < 1) return num(ms) > 0 ? '<1 min' : '0 min';
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60); m = m % 60;
    return h + ' h ' + (m < 10 ? '0' : '') + m + ' min';
  }
  function fmtShort(n) {
    n = Math.round(num(n));
    if (n < 1000) return String(n);
    if (n < 1e6) return nf1.format(n / 1000) + ' mil';
    return nf2.format(n / 1e6) + ' mi';
  }
  function fmtTokens(n) {
    n = Math.round(num(n));
    if (n < 1000) return n + (n === 1 ? ' token' : ' tokens');
    if (n < 1e6) return (n < 100000 ? nf1 : nf0).format(n / 1000) + ' mil tokens';
    return nf2.format(n / 1e6) + ' mi tokens';
  }
  function fmtHour(ms) { return dfHour.format(new Date(num(ms))); }

  // ── modo: uma sala só (/sala/<id>) ou as três visões ──
  var oneId = null;
  var mm = location.pathname.match(/^\/sala\/([^\/]+)/);
  if (mm) { try { oneId = decodeURIComponent(mm[1]); } catch (e) { oneId = mm[1]; } }
  if (oneId !== null) { $('#back').hidden = false; $('#seg').hidden = true; }

  // ── preferências (URL > localStorage) ──
  var MODOS = ['lista', 'mosaico', 'tv'];
  var DIVS = ['auto', '1', '4', '6', '9', '16'];
  var TEMPOS = ['5', '10', '20', '30'];
  function pick(list, v, fb) { v = str(v); return list.indexOf(v) >= 0 ? v : fb; }
  var qp;
  try { qp = new URLSearchParams(location.search); } catch (e) { qp = new URLSearchParams(''); }
  var state = {
    modo: pick(MODOS, qp.get('modo'), null) || pick(MODOS, lsGet('sala_modo'), 'lista'),
    div: pick(DIVS, qp.get('div'), null) || pick(DIVS, lsGet('sala_div'), 'auto'),
    tempo: Number(pick(TEMPOS, qp.get('tempo'), null) || pick(TEMPOS, lsGet('sala_tempo'), '10')),
    sel: null, autoSel: null,        // Lista: escolha do usuário / escolha automática
    detailId: null, bigId: null, page: 0, mIds: [], mDiv: 4, // Mosaico
    tvId: null, tvElapsed: 0, tvPaused: false                // TV
  };
  function savePrefs() {
    lsSet('sala_modo', state.modo); lsSet('sala_div', state.div); lsSet('sala_tempo', String(state.tempo));
    if (oneId !== null) return;
    try {
      var p = new URLSearchParams(location.search);
      p.set('modo', state.modo); p.set('div', state.div); p.set('tempo', String(state.tempo));
      history.replaceState(null, '', location.pathname + '?' + p.toString());
    } catch (e) {}
  }

  // ── dados da rodada atual ──
  var ctx = null;      // { all, active, stale, scope, map }
  var canEdit = false;

  function nameOf(s) { return str(s.title) || str(s.project) || str(s.id); }
  function stateOf(s) {
    var waiting = num(s.waiting), busy = num(s.busy), cls, label;
    if (s.ended === true) { cls = 'end'; label = 'encerrado'; }
    else if (s.__silent === true) { cls = 'idle'; label = 'sem sinal'; }
    else if (waiting > 0) { cls = 'wait'; label = 'aguardando você'; }
    else if (busy > 0) { cls = 'work'; label = 'trabalhando'; }
    else { cls = 'idle'; label = 'ocioso'; }
    return { cls: cls, label: label, waiting: waiting, busy: busy };
  }
  function countsText(s) {
    var st = stateOf(s);
    if (st.cls === 'end' || s.__silent === true) return st.label;
    var parts = [];
    if (st.busy > 0) parts.push(st.busy + ' trabalhando');
    if (st.waiting > 0) parts.push(st.waiting + ' aguardando você');
    return parts.length ? parts.join(' · ') : 'ocioso';
  }
  function rank(s) { return num(s.waiting) > 0 ? 0 : (num(s.busy) > 0 ? 1 : 2); }
  function idCmp(a, b) { a = str(a.id); b = str(b.id); return a < b ? -1 : (a > b ? 1 : 0); }
  function byPriority(a, b) { return rank(a) - rank(b) || num(b.startedAt) - num(a.startedAt) || idCmp(a, b); }
  function byMosaic(a, b) {
    return (num(b.waiting) > 0 ? 1 : 0) - (num(a.waiting) > 0 ? 1 : 0) || num(b.startedAt) - num(a.startedAt) || idCmp(a, b);
  }
  // Escolha automática com histerese: quem aguarda você; senão mantém o anterior se ainda trabalha; senão o mais ativo.
  function pickAuto(list, prevId) {
    if (!list.length) return null;
    var prev = null, i, w = null;
    for (i = 0; i < list.length; i++) {
      if (str(list[i].id) === prevId) prev = list[i];
      if (!w && num(list[i].waiting) > 0) w = list[i];
    }
    if (w) return prev && num(prev.waiting) > 0 ? prevId : str(w.id);
    if (prev && num(prev.busy) > 0) return prevId;
    var best = list[0];
    for (i = 1; i < list.length; i++) {
      var a = list[i];
      if (num(a.busy) > num(best.busy) || (num(a.busy) === num(best.busy) && num(a.updatedAt) > num(best.updatedAt))) best = a;
    }
    return str(best.id);
  }
  function findIn(list, id) {
    for (var i = 0; i < list.length; i++) if (str(list[i].id) === id) return list[i];
    return null;
  }

  // ── desenho (SVG só como imagem de dados) ──
  function setArt(o, svg) {
    if (o.svg === svg) return;
    o.svg = svg;
    if (svg) o.img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    else o.img.removeAttribute('src');
    o.img.hidden = !svg;
  }

  function place(container, roots) {
    for (var i = 0; i < roots.length; i++) {
      if (container.children[i] !== roots[i]) container.insertBefore(roots[i], container.children[i] || null);
    }
  }

  // ── agentes ──
  function buildAgent() {
    var g = { col: null, trailSig: null };
    g.li = el('li', 'ag');
    g.dot = el('span', 'dot');
    var body = el('div', 'agb');
    var top = el('div', 'agt');
    g.t = el('b'); g.m = el('span', 'mdl'); g.l = el('span', 'lbl');
    var right = el('span', 'agr');
    g.since = el('span', 'since'); g.tk = el('span', 'tk');
    right.appendChild(g.since); right.appendChild(g.tk);
    top.appendChild(g.t); top.appendChild(g.m); top.appendChild(g.l); top.appendChild(right);
    g.det = el('div', 'det-l');
    g.tsk = el('div', 'tsk');
    g.trail = el('details', 'trail');
    g.trailSum = el('summary');
    g.trailList = el('ul');
    g.trail.appendChild(g.trailSum); g.trail.appendChild(g.trailList);
    body.appendChild(top); body.appendChild(g.det); body.appendChild(g.tsk); body.appendChild(g.trail);
    g.li.appendChild(g.dot); g.li.appendChild(body);
    return g;
  }

  function updAgent(g, a, noTrail) {
    var col = hexColor(str(a.color), '#A39C8F');
    if (g.col !== col) {
      g.col = col;
      g.dot.style.background = col;
      g.dot.style.boxShadow = '0 0 8px ' + col + '99';
      g.l.style.color = col;
    }
    setText(g.t, a.title);
    setText(g.m, a.model); g.m.hidden = !str(a.model);
    setText(g.l, str(a.label) || str(a.activity));
    var st = num(a.taskStart);
    g.since.dataset.t = String(st);
    g.since.hidden = !(st > 0);
    setText(g.tk, fmtTokens(a.tokens));
    var det = str(a.detail), tsk = str(a.task);
    setText(g.det, det); g.det.hidden = !det;
    setText(g.tsk, tsk); g.tsk.hidden = !tsk;
    var trail = noTrail ? [] : (Array.isArray(a.trail) ? a.trail.filter(isObj) : []);
    var sig = JSON.stringify(trail);
    if (g.trailSig !== sig) {
      g.trailSig = sig;
      g.trail.hidden = trail.length === 0;
      setText(g.trailSum, 'histórico (' + trail.length + ')');
      while (g.trailList.firstChild) g.trailList.removeChild(g.trailList.firstChild);
      for (var i = trail.length - 1; i >= 0; i--) { // mais recente primeiro
        var li = el('li');
        li.appendChild(el('span', 'op', str(trail[i].op)));
        li.appendChild(document.createTextNode(str(trail[i].what)));
        g.trailList.appendChild(li);
      }
    }
  }

  // sincroniza a lista de agentes por chave estável (sem recriar o que não mudou)
  function syncAgents(map, ul, agents, noTrail) {
    var seen = new Set(), lis = [];
    agents.forEach(function (a, i) {
      var k = str(a.key) || ('#' + i);
      while (seen.has(k)) k += '+';
      seen.add(k);
      var g = map.get(k);
      if (!g) { g = buildAgent(); map.set(k, g); }
      updAgent(g, a, noTrail);
      lis.push(g.li);
    });
    map.forEach(function (g, k) { if (!seen.has(k)) { g.li.remove(); map.delete(k); } });
    place(ul, lis);
    ul.hidden = lis.length === 0;
    return lis.length;
  }
  function agentsOf(s) { return Array.isArray(s.agents) ? s.agents.filter(isObj) : []; }
  var IDLE_ACT = { livre: 1, ocioso: 1, concluido: 1, '': 1 };
  function isWorking(a) { return !IDLE_ACT[str(a.activity)]; }

  // ── detalhe de uma sala (Lista, painel do Mosaico e sala única) ──
  function buildDetail(opt) {
    var d = { id: null, art: { img: null, svg: null }, ags: new Map(), logSig: null, logMax: opt.logMax || 10 };
    d.root = el('article', 'card det');
    var head = el('div', 'ch');
    d.proj = el('a', 'proj');
    d.badge = el('span', 'badge');
    d.mesas = el('button', 'btn', 'Mesas');
    d.mesas.type = 'button'; d.mesas.hidden = true;
    d.mesas.title = 'Adicionar ou tirar papéis da equipe deste projeto';
    d.mesas.addEventListener('click', function () { if (d.id) openMesas(d.id); });
    d.close = el('button', 'btn ico', '✕');
    d.close.type = 'button'; d.close.hidden = !opt.closable; d.close.setAttribute('aria-label', 'Fechar detalhe');
    d.close.addEventListener('click', function () { if (opt.onClose) opt.onClose(); });
    head.appendChild(d.proj); head.appendChild(d.badge); head.appendChild(d.mesas); head.appendChild(d.close);
    var meta = el('div', 'meta');
    d.where = el('span', 'where');
    d.whereSep = document.createTextNode(' · ');
    meta.appendChild(d.where); meta.appendChild(d.whereSep);
    d.age = el('span', 'age');
    d.tokens = el('span', 'tk');
    meta.appendChild(d.age); meta.appendChild(document.createTextNode(' · ')); meta.appendChild(d.tokens);
    d.art.img = el('img', 'art');
    d.art.img.alt = 'Desenho da sala';
    d.art.img.hidden = true;
    var body = el('div', 'dbody');
    var left = el('div', 'dart');
    left.appendChild(d.art.img);
    var side = el('div', 'dside');
    d.agList = el('ul', 'ags');
    d.logList = el('ul', 'log');
    side.appendChild(d.agList); side.appendChild(d.logList);
    body.appendChild(left); body.appendChild(side);
    var ft = el('div', 'ft');
    d.link = el('a', null, 'abrir só esta sala');
    ft.appendChild(d.link);
    d.root.appendChild(head); d.root.appendChild(meta); d.root.appendChild(body); d.root.appendChild(ft);
    return d;
  }

  function updDetail(d, s) {
    var id = str(s.id);
    d.id = id;
    var st = stateOf(s);
    var title = str(s.title);
    setText(d.proj, nameOf(s));
    d.proj.title = str(s.cwd);
    d.proj.href = '/sala/' + encodeURIComponent(id);
    d.link.href = d.proj.href;
    d.link.hidden = oneId !== null;
    setText(d.where, title ? str(s.project) : '');
    d.where.hidden = !title;
    d.whereSep.textContent = title ? ' · ' : '';
    setCls(d.badge, 'badge ' + st.cls);
    setText(d.badge, st.label);
    d.root.classList.toggle('attn', st.waiting > 0);
    d.age.dataset.at = String(num(s.updatedAt));
    setText(d.tokens, fmtTokens(s.tokens));
    d.mesas.hidden = !canEdit;
    setArt(d.art, str(s.svg));
    syncAgents(d.ags, d.agList, agentsOf(s), false);

    var log = (Array.isArray(s.log) ? s.log.filter(isObj) : []).slice(-d.logMax);
    var lsig = JSON.stringify(log);
    if (d.logSig !== lsig) {
      d.logSig = lsig;
      while (d.logList.firstChild) d.logList.removeChild(d.logList.firstChild);
      for (var i = log.length - 1; i >= 0; i--) { // mais recente primeiro
        var li = el('li');
        li.appendChild(el('time', null, fmtHour(log[i].at)));
        li.appendChild(document.createTextNode(str(log[i].text)));
        d.logList.appendChild(li);
      }
      d.logList.hidden = log.length === 0;
    }
  }

  // ── Lista ──
  var rows = new Map();
  var lstAct = $('#lst-act'), lstStale = $('#lst-stale'), staleBox = $('#stale'), staleSum = $('#stale-sum');
  var destDetail = buildDetail({ logMax: oneId !== null ? 20 : 10 });
  $('#dest').appendChild(destDetail.root);

  function buildRow(id) {
    var r = { id: id };
    r.root = el('div', 'row');
    r.root.setAttribute('role', 'button'); r.root.tabIndex = 0;
    r.sd = el('i', 'sd');
    r.t = el('span', 'rt'); r.ago = el('span', 'rago');
    r.p = el('span', 'rp'); r.k = el('span', 'rk'); r.c = el('span', 'rc');
    r.root.appendChild(r.sd); r.root.appendChild(r.t); r.root.appendChild(r.ago);
    r.root.appendChild(r.p); r.root.appendChild(r.k); r.root.appendChild(r.c);
    r.root.addEventListener('click', function () { pickRow(id); });
    r.root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRow(id); }
    });
    return r;
  }
  function updRow(r, s, selected) {
    var st = stateOf(s);
    setCls(r.sd, 'sd ' + st.cls);
    setText(r.t, nameOf(s));
    r.t.title = nameOf(s);
    r.ago.dataset.at = String(num(s.updatedAt));
    setText(r.p, str(s.project));
    setText(r.k, fmtTokens(s.tokens));
    setText(r.c, countsText(s));
    setCls(r.c, 'rc ' + st.cls);
    setCls(r.root, 'row' + (selected ? ' sel' : '') + (st.waiting > 0 ? ' attn' : '') + (s.__silent === true ? ' dim' : ''));
    r.root.setAttribute('aria-pressed', selected ? 'true' : 'false');
  }
  function pickRow(id) {
    state.sel = id;
    draw();
    if (window.innerWidth < 800) {
      try { $('#dest').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { $('#dest').scrollIntoView(); }
    }
  }

  function drawLista(single) {
    var pool = single ? ctx.scope : ctx.active.concat(ctx.stale);
    var chosen = null;
    if (single) {
      chosen = pool[0] || null;
    } else {
      if (state.sel !== null && !ctx.map.has(state.sel)) state.sel = null;
      var cid = state.sel;
      if (cid === null) {
        state.autoSel = pickAuto(ctx.active.length ? ctx.active : ctx.stale, state.autoSel);
        cid = state.autoSel;
      }
      chosen = cid !== null ? (ctx.map.get(cid) || null) : null;

      var keep = new Set();
      var cur = chosen ? str(chosen.id) : null;
      var rootsA = ctx.active.map(function (s) {
        var id = str(s.id), r = rows.get(id);
        if (!r) { r = buildRow(id); rows.set(id, r); }
        keep.add(id); updRow(r, s, id === cur); return r.root;
      });
      var rootsS = ctx.stale.map(function (s) {
        var id = str(s.id), r = rows.get(id);
        if (!r) { r = buildRow(id); rows.set(id, r); }
        keep.add(id); updRow(r, s, id === cur); return r.root;
      });
      place(lstAct, rootsA); place(lstStale, rootsS);
      rows.forEach(function (r, id) { if (!keep.has(id)) { r.root.remove(); rows.delete(id); } });
      staleBox.hidden = ctx.stale.length === 0;
      setText(staleSum, 'Parados (' + ctx.stale.length + ')');
      if (ctx.active.length === 0 && ctx.stale.length > 0) staleBox.open = true;
    }
    destDetail.root.hidden = !chosen;
    if (chosen) updDetail(destDetail, chosen);
    return chosen ? [str(chosen.id)] : [];
  }

  // ── Mosaico ──
  var tiles = new Map(), emptyTiles = [];
  var mgrid = $('#mgrid'), mdetBox = $('#mdet');
  var mDetail = buildDetail({ logMax: 6, closable: true, onClose: function () { state.detailId = null; draw(); } });
  mdetBox.appendChild(mDetail.root);

  function buildTile(id) {
    var t = { id: id, art: { img: null, svg: null } };
    t.root = el('div', 'tile');
    t.root.setAttribute('role', 'button'); t.root.tabIndex = 0;
    t.art.img = el('img', 'timg'); t.art.img.alt = ''; t.art.img.hidden = true;
    var bar = el('div', 'tbar');
    t.sd = el('i', 'sd'); t.tt = el('span', 'tt'); t.ts = el('span', 'ts');
    bar.appendChild(t.sd); bar.appendChild(t.tt); bar.appendChild(t.ts);
    t.root.appendChild(t.art.img); t.root.appendChild(bar);
    function open() { state.detailId = state.detailId === id ? null : id; draw(); }
    t.root.addEventListener('click', open);
    t.root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    return t;
  }
  function updTile(t, s, selected) {
    var st = stateOf(s);
    setCls(t.root, 'tile' + (st.waiting > 0 ? ' attn' : '') + (selected ? ' sel' : ''));
    t.root.setAttribute('aria-pressed', selected ? 'true' : 'false');
    t.root.setAttribute('aria-label', nameOf(s) + ': ' + countsText(s));
    setCls(t.sd, 'sd ' + st.cls);
    setText(t.tt, nameOf(s));
    t.tt.title = nameOf(s);
    setText(t.ts, st.waiting > 0 ? 'aguardando você' : (st.cls === 'work' ? st.busy + ' trabalhando' : st.label));
    setCls(t.ts, 'ts ' + st.cls);
    setArt(t.art, str(s.svg));
  }
  function getEmpty(i) {
    while (emptyTiles.length <= i) {
      var e = el('div', 'tile empty', 'sem sinal');
      emptyTiles.push(e);
    }
    return emptyTiles[i];
  }
  function autoDiv(n) {
    var ds = [1, 4, 6, 9, 16];
    for (var i = 0; i < ds.length; i++) if (n <= ds[i]) return ds[i];
    return 16;
  }
  function markPressed(box, attr, val) {
    var bs = box.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute(attr) === String(val) ? 'true' : 'false');
  }

  function drawMosaic() {
    var list = ctx.active.slice().sort(byMosaic);
    var n = list.length;
    var d = state.div === 'auto' ? autoDiv(n) : Number(state.div);
    if (d === 6 && n) {
      state.bigId = pickAuto(list, state.bigId);
      var big = findIn(list, state.bigId);
      if (big) { list.splice(list.indexOf(big), 1); list.unshift(big); }
    }
    state.mIds = list.map(function (s) { return str(s.id); });
    state.mDiv = d;
    var pages = Math.max(1, Math.ceil(n / d));
    if (state.page >= pages) state.page = pages - 1;
    if (state.page < 0) state.page = 0;
    var items = list.slice(state.page * d, state.page * d + d);

    if (state.detailId !== null && !ctx.map.has(state.detailId)) state.detailId = null;
    var keep = new Set(), roots = [], ids = [];
    items.forEach(function (s) {
      var id = str(s.id), t = tiles.get(id);
      if (!t) { t = buildTile(id); tiles.set(id, t); }
      keep.add(id); ids.push(id);
      updTile(t, s, id === state.detailId);
      roots.push(t.root);
    });
    // chats que ficaram de fora desta página perdem o tile (o desenho é refeito ao voltar)
    tiles.forEach(function (t, id) { if (!keep.has(id)) { t.root.remove(); tiles.delete(id); } });
    for (var i = items.length; i < d; i++) roots.push(getEmpty(i));
    mgrid.setAttribute('data-div', String(d));
    place(mgrid, roots);
    while (mgrid.children.length > roots.length) mgrid.removeChild(mgrid.lastChild);

    markPressed($('#divs'), 'data-div', state.div);
    $('#divs').querySelector('[data-div="auto"]').title = 'Automático: ' + d + (d === 1 ? ' tela' : ' telas');
    $('#pager').hidden = pages <= 1;
    setText($('#pg-txt'), (state.page + 1) + '/' + pages);
    $('#pg-prev').disabled = state.page <= 0;
    $('#pg-next').disabled = state.page >= pages - 1;
    var parts = [n + (n === 1 ? ' chat' : ' chats')];
    if (ctx.stale.length) parts.push('+' + ctx.stale.length + ' parado' + (ctx.stale.length === 1 ? '' : 's'));
    setText($('#mst'), parts.join(' · '));

    var det = state.detailId !== null ? ctx.map.get(state.detailId) : null;
    mdetBox.hidden = !det;
    if (det) updDetail(mDetail, det);
    var focus = ids.slice();
    if (state.detailId !== null) focus.push(state.detailId);
    return focus;
  }

  $('#divs').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    state.div = pick(DIVS, b.getAttribute('data-div'), 'auto'); state.page = 0;
    savePrefs(); draw();
  });
  $('#pg-prev').addEventListener('click', function () { state.page = Math.max(0, state.page - 1); draw(); });
  $('#pg-next').addEventListener('click', function () { state.page = state.page + 1; draw(); });

  // ── TV (sequencial) ──
  var tvImg = { img: $('#tv-img'), svg: null };
  tvImg.img.hidden = true;
  var tvAgs = new Map(), tvDotsN = -1;
  var tvLast = 0;

  function tvList() { return ctx ? ctx.active.slice().sort(byMosaic) : []; }
  function tvSet(id) { state.tvId = id; state.tvElapsed = 0; }
  function tvMove(dir) {
    var list = tvList();
    if (list.length < 2) return;
    var idx = 0;
    for (var i = 0; i < list.length; i++) if (str(list[i].id) === state.tvId) idx = i;
    tvSet(str(list[(idx + dir + list.length) % list.length].id));
  }

  function drawTv() {
    var list = tvList();
    var n = list.length;
    var cur = findIn(list, state.tvId);
    if (!cur && n) { cur = list[0]; tvSet(str(cur.id)); }
    if (cur && num(cur.waiting) === 0 && !state.tvPaused) {
      for (var i = 0; i < n; i++) if (num(list[i].waiting) > 0) { cur = list[i]; tvSet(str(cur.id)); break; }
    }
    markPressed($('#tv-tempo'), 'data-t', state.tempo);
    setText($('#tv-pause'), state.tvPaused ? 'Continuar' : 'Pausar');
    if (!cur) {
      setText($('#tv-title'), 'sem sinal');
      $('#tv-badge').hidden = true; $('#tv-seal').hidden = true; setText($('#tv-pos'), '');
      setArt(tvImg, '');
      $('#tv-ags').hidden = true; $('#tv-none').hidden = false; setText($('#tv-sub'), '');
      setText($('#tv-nextlbl'), '');
      return [];
    }
    var st = stateOf(cur);
    var holding = st.waiting > 0;
    setText($('#tv-title'), nameOf(cur));
    $('#tv-badge').hidden = holding; // com o selo laranja grande, o selo pequeno é redundante
    setCls($('#tv-badge'), 'badge ' + st.cls);
    setText($('#tv-badge'), st.label);
    $('#tv-seal').hidden = !holding;
    var idx = 0;
    for (var j = 0; j < n; j++) if (str(list[j].id) === state.tvId) idx = j;
    setText($('#tv-pos'), (idx + 1) + ' de ' + n);
    $('#tv-art').classList.toggle('attn', holding);
    setArt(tvImg, str(cur.svg));

    var working = agentsOf(cur).filter(isWorking);
    syncAgents(tvAgs, $('#tv-ags'), working, true);
    $('#tv-none').hidden = working.length > 0;
    setText($('#tv-sub'), (working.length ? working.length + (working.length === 1 ? ' agente trabalhando' : ' agentes trabalhando') : 'Sem agentes ativos') + ' · ' + fmtTokens(cur.tokens));

    // bolinhas de posição
    var dots = $('#tv-dots');
    if (tvDotsN !== n) {
      tvDotsN = n;
      while (dots.firstChild) dots.removeChild(dots.firstChild);
      for (var k = 0; k < n; k++) dots.appendChild(el('i'));
    }
    for (var m2 = 0; m2 < n; m2++) {
      var cls = (m2 === idx ? 'cur' : '') + (num(list[m2].waiting) > 0 ? ' w' : '');
      if (dots.children[m2].className !== cls) dots.children[m2].className = cls;
    }
    var nx = $('#tv-nextlbl');
    while (nx.firstChild) nx.removeChild(nx.firstChild);
    if (holding) {
      nx.appendChild(document.createTextNode('parado aqui até você responder'));
    } else if (n > 1) {
      nx.appendChild(document.createTextNode('próximo: '));
      nx.appendChild(el('b', null, nameOf(list[(idx + 1) % n])));
    }
    $('#tv-prog').classList.toggle('hold', holding);
    tvProgress();
    return [str(cur.id)];
  }

  function tvProgress() {
    var bar = $('#tv-prog').firstChild;
    var pct = Math.min(100, state.tvElapsed / (state.tempo * 1000) * 100);
    bar.style.width = pct.toFixed(1) + '%';
  }

  // relógio da TV: avança o tempo, troca de chat e segura em quem aguarda você
  function tvTick() {
    var t = performance.now();
    var dt = Math.min(500, Math.max(0, t - tvLast));
    tvLast = t;
    if (!ctx || oneId !== null || state.modo !== 'tv') return;
    var list = tvList();
    if (!list.length) return;
    var cur = findIn(list, state.tvId);
    if (cur && num(cur.waiting) > 0) { state.tvElapsed = 0; tvProgress(); return; }
    if (state.tvPaused) return;
    for (var i = 0; i < list.length; i++) {
      if (num(list[i].waiting) > 0) { tvSet(str(list[i].id)); draw(); return; }
    }
    if (list.length < 2) { state.tvElapsed = 0; tvProgress(); return; }
    state.tvElapsed += dt;
    if (state.tvElapsed >= state.tempo * 1000) { tvMove(1); draw(); return; }
    tvProgress();
  }
  setInterval(tvTick, 100);

  $('#tv-tempo').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    state.tempo = Number(pick(TEMPOS, b.getAttribute('data-t'), '10'));
    state.tvElapsed = 0; savePrefs(); draw();
  });
  $('#tv-pause').addEventListener('click', function () { state.tvPaused = !state.tvPaused; draw(); });
  $('#tv-prev').addEventListener('click', function () { tvMove(-1); draw(); });
  $('#tv-next').addEventListener('click', function () { tvMove(1); draw(); });

  // ── aviso "fulano aguarda você" ──
  var alertBtn = $('#alert');
  function drawAlert(focus, hide) {
    var targets = hide ? [] : ctx.active.filter(function (s) {
      return num(s.waiting) > 0 && focus.indexOf(str(s.id)) < 0;
    }).sort(byMosaic);
    if (!targets.length) { alertBtn.hidden = true; alertBtn.removeAttribute('data-id'); return; }
    var s = targets[0];
    alertBtn.setAttribute('data-id', str(s.id));
    setText($('#alert-n'), nameOf(s));
    setText($('#alert-t'), ' aguarda você — ver' + (targets.length > 1 ? ' (+' + (targets.length - 1) + ')' : ''));
    alertBtn.hidden = false;
  }
  alertBtn.addEventListener('click', function () {
    var id = alertBtn.getAttribute('data-id');
    if (!id) return;
    if (state.modo === 'mosaico') {
      state.detailId = id;
      var idx = state.mIds.indexOf(id);
      if (idx >= 0) state.page = Math.floor(idx / state.mDiv);
    } else if (state.modo === 'tv') {
      tvSet(id);
    } else {
      state.sel = id;
    }
    draw();
    if (state.modo === 'lista' && window.innerWidth < 800) {
      try { $('#dest').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
    }
  });

  // ── resumo do dia ──
  var dailySig = null;
  function renderDaily(salas) {
    var today = todayStr(), map = new Map();
    salas.forEach(function (s) {
      var d = s.daily;
      if (!isObj(d) || str(d.date) !== today || !Array.isArray(d.roles)) return;
      d.roles.forEach(function (r) {
        if (!isObj(r)) return;
        var k = str(r.role) || '?';
        var o = map.get(k);
        if (!o) { o = { role: k, tasks: 0, ms: 0, tokens: 0 }; map.set(k, o); }
        o.tasks += num(r.tasks); o.ms += num(r.ms); o.tokens += num(r.tokens);
      });
    });
    var rws = Array.from(map.values()).sort(function (a, b) { return b.tokens - a.tokens; });
    var tot = rws.reduce(function (t, r) { t.tasks += r.tasks; t.ms += r.ms; t.tokens += r.tokens; return t; }, { tasks: 0, ms: 0, tokens: 0 });
    var sig = JSON.stringify([today, rws]);
    if (sig !== dailySig) {
      dailySig = sig;
      var body = $('#daily-body');
      while (body.firstChild) body.removeChild(body.firstChild);
      rws.forEach(function (r) {
        var tr = el('tr');
        tr.appendChild(el('td', null, r.role));
        tr.appendChild(el('td', null, String(r.tasks)));
        tr.appendChild(el('td', null, fmtDur(r.ms)));
        tr.appendChild(el('td', null, fmtTokens(r.tokens)));
        body.appendChild(tr);
      });
      setText($('#t-tasks'), tot.tasks); setText($('#t-ms'), fmtDur(tot.ms)); setText($('#t-tok'), fmtTokens(tot.tokens));
      $('#daily-tbl').hidden = rws.length === 0;
      $('#daily-empty').hidden = rws.length !== 0;
    }
    return tot.tokens;
  }

  // ── classificação e desenho geral ──
  function compute(data) {
    offset = num(data.serverNow) - Date.now();
    canEdit = data.canEdit === true;
    var t = now();
    var all = (Array.isArray(data.salas) ? data.salas : []).filter(isObj);
    var active = [], stale = [], scope;
    all.forEach(function (s) {
      s.id = str(s.id);
      s.__silent = s.ended !== true && Math.max(0, t - num(s.updatedAt)) > 180e3; // o chat regrava a cada minuto
    });
    if (oneId !== null) {
      scope = all.filter(function (s) { return s.id === oneId; });
      active = scope;
    } else {
      scope = all;
      all.forEach(function (s) {
        if (s.ended === true) return;
        var age = Math.max(0, t - num(s.updatedAt));
        if (age > 6 * 3600e3) return;
        // parado: sem sinal (3 min calado), ou sem mexer há mais de 10 min com ninguém trabalhando nem esperando por você
        if (s.__silent || (age > 600e3 && num(s.busy) === 0 && num(s.waiting) === 0)) stale.push(s); else active.push(s);
      });
      active.sort(byPriority); stale.sort(byPriority);
    }
    var map = new Map();
    active.concat(stale).forEach(function (s) { map.set(s.id, s); });
    ctx = { all: all, active: active, stale: stale, scope: scope, map: map };
  }

  var vLista = $('#v-lista'), vMos = $('#v-mosaico'), vTv = $('#v-tv'), emptyBox = $('#empty');

  function draw() {
    if (!ctx) return;
    var m = oneId !== null ? 'one' : state.modo;
    document.body.setAttribute('data-modo', m);
    document.body.classList.toggle('fit', m === 'mosaico' || m === 'tv');
    markPressed($('#seg'), 'data-modo', state.modo);
    var none = ctx.active.length === 0 && ctx.stale.length === 0;
    vLista.hidden = none || !(m === 'lista' || m === 'one');
    vMos.hidden = none || m !== 'mosaico';
    vTv.hidden = none || m !== 'tv';
    var focus = [];
    if (!none) {
      if (m === 'lista' || m === 'one') focus = drawLista(m === 'one');
      else if (m === 'mosaico') focus = drawMosaic();
      else focus = drawTv();
    }
    drawAlert(focus, none || m === 'one');

    var busy = 0, waiting = 0;
    ctx.active.forEach(function (s) { busy += num(s.busy); waiting += num(s.waiting); });
    var todayTok = renderDaily(ctx.scope);
    setText($('#s-chats'), ctx.active.length);
    setText($('#s-busy'), busy);
    setText($('#s-wait'), waiting);
    $('#s-wait-box').classList.toggle('attn', waiting > 0);
    setText($('#s-tok'), fmtShort(todayTok));
    $('#daily').hidden = !(m === 'lista' || m === 'one');

    if (none) {
      setText(emptyBox, oneId !== null ? 'Sala não encontrada. Ela pode ter sido encerrada ou removida.' : 'Nenhum chat ativo agora. Abra um chat do Claude Code com a Sala dos Agentes carregada.');
      emptyBox.hidden = false;
    } else {
      emptyBox.hidden = true;
    }
    var title = 'Squadesk · Sala dos Agentes';
    document.title = waiting > 0 ? '(' + waiting + ') ' + title : title;
    if (!$('#modal').hidden) renderMesas(false);
    tick();
  }

  function setModo(m) {
    if (state.modo === m) return;
    state.modo = m;
    if (m === 'tv') { state.tvElapsed = 0; tvLast = performance.now(); }
    savePrefs(); draw();
  }
  $('#seg').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (b) setModo(pick(MODOS, b.getAttribute('data-modo'), 'lista'));
  });

  // ── relógio vivo (1 s) ──
  function tick() {
    var t = now();
    var i, list = document.querySelectorAll('.since');
    for (i = 0; i < list.length; i++) {
      var s = Number(list[i].dataset.t);
      if (s > 0) setText(list[i], 'há ' + fmtAgo(t - s));
    }
    list = document.querySelectorAll('.age');
    for (i = 0; i < list.length; i++) {
      var u = Number(list[i].dataset.at);
      if (u > 0) {
        setText(list[i], 'atualizado há ' + fmtAgo(t - u));
        list[i].classList.toggle('old', t - u > 600e3);
      }
    }
    list = document.querySelectorAll('.rago');
    for (i = 0; i < list.length; i++) {
      var r = Number(list[i].dataset.at);
      if (r > 0) setText(list[i], 'há ' + fmtAgo(t - r));
    }
  }
  setInterval(tick, 1000);

  // ── editor de mesas ──
  var mesas = { id: null, pending: {}, confirm: null, busy: false, sig: null, msg: '', msgCls: '' };
  var modal = $('#modal');

  function rolesOf(s) {
    var t = isObj(s.team) ? s.team : {};
    return (Array.isArray(t.roles) ? t.roles : []).filter(isObj).map(function (r) {
      return { name: str(r.name), model: str(r.model), keywords: strArr(r.keywords), aliases: strArr(r.aliases) };
    });
  }
  function namesSig(list) { return list.map(function (r) { return norm(r.name); }).join('|'); }
  function currentRoles(s) {
    var snap = rolesOf(s), p = mesas.pending[str(s.id)];
    if (p) {
      if (Date.now() > p.until || namesSig(p.list) === namesSig(snap)) delete mesas.pending[str(s.id)];
      else return p.list;
    }
    return snap;
  }
  function setMsg(text, cls) {
    mesas.msg = text; mesas.msgCls = cls || '';
    setText($('#f-msg'), text); setCls($('#f-msg'), 'fmsg ' + (cls || ''));
    if (text) { try { $('#f-msg').scrollIntoView({ block: 'nearest' }); } catch (e) {} } // com 11 papéis o formulário fica abaixo da dobra
  }

  function openMesas(id) {
    mesas.id = id; mesas.confirm = null; mesas.sig = null;
    setMsg('', '');
    modal.hidden = false;
    renderMesas(true);
    try { $('#f-nome').focus(); } catch (e) {}
  }
  function closeMesas() { modal.hidden = true; mesas.id = null; mesas.confirm = null; }
  $('#m-close').addEventListener('click', closeMesas);
  modal.addEventListener('click', function (e) { if (e.target === modal) closeMesas(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) closeMesas(); });

  function renderMesas(force) {
    if (mesas.id === null) return;
    var s = ctx ? ctx.map.get(mesas.id) || findIn(ctx.all, mesas.id) : null;
    if (!s) { closeMesas(); return; }
    var roles = currentRoles(s);
    var team = isObj(s.team) ? s.team : {};
    var cwd = str(s.cwd), source = str(team.source);
    var sig = JSON.stringify([roles, mesas.confirm, mesas.busy, cwd, source, str(team.lead), str(team.leadModel)]);
    if (!force && sig === mesas.sig) return;
    mesas.sig = sig;
    setText($('#m-title'), 'Mesas · ' + nameOf(s));
    var target = cwd.replace(/[\\\/]+$/, '') + '\\.claude\\sala-agentes.json';
    var sub = 'Equipe fixa do projeto ' + (str(s.project) || cwd) + ' (' + roles.length + ' de 11 papéis). Arquivo: ' + target;
    if (source && norm(source) !== norm(target)) {
      sub += ' · hoje a equipe vem de: ' + source + (source === 'padrão' ? '. Ao salvar, o arquivo é criado a partir dela.' : '. Ao salvar, o arquivo do projeto é criado/atualizado a partir dela.');
    }
    setText($('#m-sub'), sub);

    var ul = $('#m-roles');
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    var lead = el('li', 'rl lead');
    var lm = el('div', 'rl-main');
    lm.appendChild(el('b', null, str(team.lead) || 'Tech Lead'));
    if (str(team.leadModel)) lm.appendChild(el('span', 'mdl', str(team.leadModel)));
    lm.appendChild(el('span', 'rl-kw', 'líder (fixo)'));
    lead.appendChild(lm);
    ul.appendChild(lead);
    roles.forEach(function (r) {
      var li = el('li', 'rl');
      if (mesas.confirm === norm(r.name)) {
        var c = el('div', 'rl-conf');
        c.appendChild(el('span', null, 'Tirar “' + r.name + '” da equipe?'));
        var yes = el('button', 'btn dng', 'Tirar'); yes.type = 'button'; yes.disabled = mesas.busy;
        yes.addEventListener('click', function () { removeRole(r.name); });
        var no = el('button', 'btn', 'Cancelar'); no.type = 'button';
        no.addEventListener('click', function () { mesas.confirm = null; renderMesas(true); });
        c.appendChild(yes); c.appendChild(no);
        li.appendChild(c);
      } else {
        var m = el('div', 'rl-main');
        m.appendChild(el('b', null, r.name));
        if (r.model) m.appendChild(el('span', 'mdl', r.model));
        var kw = r.keywords.length ? 'palavras: ' + r.keywords.join(', ') : 'sem palavras (só pelo nome)';
        if (r.aliases.length) kw += ' · apelidos: ' + r.aliases.join(', ');
        var k = el('span', 'rl-kw', kw); k.title = kw;
        m.appendChild(k);
        var x = el('button', 'btn ico', '✕'); x.type = 'button';
        x.setAttribute('aria-label', 'Tirar ' + r.name);
        x.title = roles.length <= 1 ? 'A equipe precisa de pelo menos 1 papel' : 'Tirar da equipe';
        x.disabled = roles.length <= 1 || mesas.busy;
        x.addEventListener('click', function () { mesas.confirm = norm(r.name); setMsg('', ''); renderMesas(true); });
        li.appendChild(m); li.appendChild(x);
      }
      ul.appendChild(li);
    });
    var full = roles.length >= 11;
    ['#f-nome', '#f-modelo', '#f-pal', '#f-ape', '#f-ok'].forEach(function (q) { $(q).disabled = full || mesas.busy; });
    if (full && !mesas.msg) { setText($('#f-msg'), 'A equipe já tem 11 papéis (o máximo). Tire um para adicionar outro.'); setCls($('#f-msg'), 'fmsg err'); }
  }

  function postEquipe(body, onOk, okMsg) {
    mesas.busy = true; setMsg('Salvando…', ''); renderMesas(true);
    var id = body.id;
    fetch('/api/equipe', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Sala-Edit': '1' },
      body: JSON.stringify(body)
    })
      .then(function (r) {
        return r.json().catch(function () { return { ok: false, erro: 'Resposta inesperada do painel (HTTP ' + r.status + ').' }; });
      })
      .catch(function () { return { ok: false, erro: 'Sem conexão com o painel.' }; })
      .then(function (res) {
        mesas.busy = false;
        if (res && res.ok === true && Array.isArray(res.papeis)) {
          var s = ctx ? findIn(ctx.all, id) : null;
          var known = s ? currentRoles(s) : [];
          var list = res.papeis.map(function (n) {
            for (var i = 0; i < known.length; i++) if (norm(known[i].name) === norm(n)) return known[i];
            return onOk.added && norm(onOk.added.name) === norm(n) ? onOk.added : { name: str(n), model: '', keywords: [], aliases: [] };
          });
          mesas.pending[id] = { list: list, until: Date.now() + 60000 };
          mesas.confirm = null;
          setMsg(okMsg, 'ok');
          if (onOk.done) onOk.done();
        } else {
          setMsg(str(res && res.erro) || 'Não foi possível salvar.', 'err');
        }
        renderMesas(true);
        if (res && res.ok === true) setCls($('#f-msg'), 'fmsg ok');
      });
  }
  var SALVO = 'Salvo. O Tech Lead desse chat será avisado da nova formação no próximo turno.';

  function removeRole(name) {
    postEquipe({ id: mesas.id, acao: 'remover', papel: { nome: name } }, {}, SALVO);
  }
  function splitList(v) {
    var out = [];
    str(v).split(',').forEach(function (x) {
      var t = x.replace(/\s+/g, ' ').trim();
      if (t && out.map(norm).indexOf(norm(t)) < 0) out.push(t);
    });
    return out;
  }
  $('#m-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (mesas.busy || mesas.id === null) return;
    var s = ctx ? findIn(ctx.all, mesas.id) : null;
    var roles = s ? currentRoles(s) : [];
    var nome = $('#f-nome').value.replace(/\s+/g, ' ').trim();
    var pal = splitList($('#f-pal').value), ape = splitList($('#f-ape').value);
    var lead = s && isObj(s.team) ? str(s.team.lead) : '';
    var err = '';
    if (!nome) err = 'Informe o nome da mesa.';
    else if (nome.length > 22) err = 'O nome aceita até 22 caracteres.';
    else if (roles.some(function (r) { return norm(r.name) === norm(nome); }) || (lead && norm(lead) === norm(nome))) err = 'Já existe uma mesa com esse nome.';
    else if (roles.length >= 11) err = 'A equipe já tem 11 papéis (o máximo).';
    else if (pal.length > 20) err = 'Use no máximo 20 palavras.';
    else if (pal.some(function (x) { return x.length > 30; })) err = 'Cada palavra aceita até 30 caracteres.';
    else if (ape.length > 10) err = 'Use no máximo 10 apelidos.';
    else if (ape.some(function (x) { return x.length > 22; })) err = 'Cada apelido aceita até 22 caracteres.';
    if (err) { setMsg(err, 'err'); $('#f-nome').focus(); return; }
    var modelo = $('#f-modelo').value;
    var papel = { nome: nome, modelo: modelo, palavras: pal.map(function (x) { return x.toLowerCase(); }) };
    if (ape.length) papel.apelidos = ape;
    postEquipe({ id: mesas.id, acao: 'adicionar', papel: papel }, {
      added: { name: nome, model: modelo, keywords: papel.palavras, aliases: ape },
      done: function () { $('#f-nome').value = ''; $('#f-pal').value = ''; $('#f-ape').value = ''; }
    }, SALVO);
  });

  // ── conexão ──
  function setConn(ok, text) {
    var c = $('#conn');
    c.classList.toggle('off', !ok);
    setText($('#connt'), text);
  }

  function poll() {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var to = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : null;
    fetch('/api/salas', { cache: 'no-store', credentials: 'same-origin', signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        if (to) clearTimeout(to);
        if (r.status === 401) { setConn(false, 'acesso negado: abra o link completo com a chave'); return null; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        try { compute(d); draw(); setConn(true, 'ao vivo'); }
        catch (e) { if (window.console) console.error(e); setConn(false, 'erro ao exibir os dados'); }
      })
      .catch(function () { setConn(false, 'sem conexão'); })
      .then(function () { setTimeout(poll, document.hidden ? 10000 : 2000); });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { tvLast = performance.now(); tick(); } });
  document.body.setAttribute('data-modo', oneId !== null ? 'one' : state.modo);
  markPressed($('#seg'), 'data-modo', state.modo);
  tvLast = performance.now();
  poll();
})();
</script>
</body>
</html>
`
