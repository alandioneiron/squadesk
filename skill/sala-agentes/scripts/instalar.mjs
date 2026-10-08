#!/usr/bin/env node
// Instalador da skill portátil "sala-agentes" (Sala dos Agentes, plugin do Claude Code).
//
// O que faz (resumo; detalhes em --ajuda):
//   1. copia o plugin para ~/.claude/mods/sala-agentes. A origem é a pasta ../assets/plugin (pacote .skill) ou,
//      num clone do repositório, a pasta plugin/ da raiz (só os arquivos que o pacote levaria)
//   2. põe essa pasta no CLAUDE_CODE_PLUGIN_DIRS do ~/.claude/settings.json (e liga o recarregamento automático)
//   3. grava a equipe (opcional), na conta ou num projeto
//   4. liga o painel web (opcional) e, no Windows, o atalho de inicialização
//
// Node 18+, sem dependências. Para testar sem tocar na conta real:
//   SALA_HOME=<pasta de teste>           substitui a pasta pessoal
//   SALA_STARTUP_DIR=<pasta de teste>    substitui a pasta Inicializar do Windows
//
// Códigos de saída: 0 deu certo; 1 erro; 2 precisa de confirmação do usuário (nada foi alterado).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ───────────────────────── Caminhos ─────────────────────────

const IS_WIN = process.platform === 'win32'
const TESTE = Boolean(process.env.SALA_HOME)
const HOME = path.resolve(process.env.SALA_HOME || os.homedir())
const CLAUDE_DIR = path.join(HOME, '.claude')
const PLUGIN_DEST = path.join(CLAUDE_DIR, 'mods', 'sala-agentes')
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json')
const SALA_DIR = path.join(CLAUDE_DIR, 'sala-agentes')
const WEB_JSON = path.join(SALA_DIR, 'web.json')
const INSTALL_JSON = path.join(SALA_DIR, 'instalacao.json')
const VBS_LOCAL = path.join(SALA_DIR, 'start-painel.vbs')
const PID_FILE = path.join(SALA_DIR, 'painel.pid') // PID do painel que o instalador subiu
const SERVER_DEST = path.join(PLUGIN_DEST, 'web', 'server.mjs')
const MANIFESTO = '.claude-plugin/plugin.json'

// De onde vem o plugin: do pacote .skill (assets/plugin, gerado por scripts/gerar-skill.mjs) ou, quando essa pasta
// não existe (clone do repositório, onde ela fica fora do git), da pasta plugin/ na raiz do clone.
const PKG_EMBUTIDO = path.resolve(fileURLToPath(new URL('../assets/plugin/', import.meta.url)))
const PKG_CLONE = path.resolve(fileURLToPath(new URL('../../../plugin/', import.meta.url)))
const DO_CLONE = !fs.existsSync(path.join(PKG_EMBUTIDO, MANIFESTO)) && fs.existsSync(path.join(PKG_CLONE, MANIFESTO))
const PKG_PLUGIN = DO_CLONE ? PKG_CLONE : PKG_EMBUTIDO
const PKG_ORIGEM = DO_CLONE ? 'clone do repositório' : 'pacote da skill'
const PKG_SERVER = path.join(PKG_PLUGIN, 'web', 'server.mjs')

// Com SALA_HOME definida, nunca usa o APPDATA verdadeiro: a pasta Inicializar de teste fica dentro dela.
const STARTUP_DIR = process.env.SALA_STARTUP_DIR
  ? path.resolve(process.env.SALA_STARTUP_DIR)
  : IS_WIN
    ? path.join(
        TESTE ? path.join(HOME, 'AppData', 'Roaming') : process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'),
        'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
      )
    : ''
const STARTUP_VBS = STARTUP_DIR ? path.join(STARTUP_DIR, 'sala-agentes-painel.vbs') : ''

const VAR_DIRS = 'CLAUDE_CODE_PLUGIN_DIRS'
const VAR_WATCH = 'CLAUDE_CODE_PLUGIN_DIR_WATCH'
const PASTAS_DO_PLUGIN = ['hooks', 'types', 'web', '.claude-plugin'] // as que o instalador limpa antes de copiar
// Do clone só vai o que o pacote levaria (mesmo filtro do scripts/gerar-skill.mjs; mantenha os dois iguais):
// o manifesto, hooks/**, types/** e web/** menos web/sample/. Nunca tests/, tsconfig.json nem .claude-plugin/types/.
const PASTAS_DO_CLONE = ['hooks', 'types', 'web']
const PULAR_NO_CLONE = ['web/sample/']
const PORTA_PADRAO = 8787
const MAX_MESAS = 11

// ───────────────────────── Saída para o usuário ─────────────────────────

class Sair extends Error {
  constructor(codigo, ...linhas) {
    super(linhas.join('\n'))
    this.codigo = codigo
    this.linhas = linhas
  }
}

const titulo = (t) => console.log(`\n== ${t} ==`)
const info = (t) => console.log(`  ${t}`)
const ok = (t) => console.log(`  [ok] ${t}`)
const aviso = (t) => console.log(`  [!] ${t}`)
const pergunta = (t) => console.log(`  [?] ${t}`)
const falha = (t) => console.error(`  [x] ${t}`)

// ───────────────────────── Utilidades gerais ─────────────────────────

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const existe = (p) => fs.existsSync(p)
const ehPasta = (p) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Se `arquivo` é um link simbólico, devolve o arquivo real para onde ele aponta (existindo ou não); senão, o próprio caminho. */
function destinoReal(arquivo) {
  let lst
  try {
    lst = fs.lstatSync(arquivo)
  } catch {
    return arquivo
  }
  if (!lst.isSymbolicLink()) return arquivo
  try {
    return fs.realpathSync(arquivo)
  } catch {
    // link quebrado: grava onde ele aponta, em vez de trocar o link por um arquivo comum
    return path.resolve(path.dirname(arquivo), fs.readlinkSync(arquivo))
  }
}

/**
 * Grava por arquivo temporário + rename (o Claude Code recarrega ao ver mudanças: nunca deixa meio escrito).
 * Se `arquivo` for um link simbólico, grava no destino real e o link continua link. Preserva o modo (POSIX).
 * O .tmp nunca fica para trás, nem quando dá erro.
 */
function gravar(arquivo, dados) {
  const destino = destinoReal(arquivo)
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  let modo
  try {
    modo = fs.statSync(destino).mode & 0o7777
  } catch {}
  const tmp = `${destino}.tmp-${process.pid}`
  try {
    fs.writeFileSync(tmp, dados)
    if (modo !== undefined && !IS_WIN) fs.chmodSync(tmp, modo)
    try {
      fs.renameSync(tmp, destino)
    } catch {
      // alguns sistemas (Windows com o arquivo aberto por outro programa) não deixam o rename: grava direto
      fs.writeFileSync(destino, dados)
    }
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {}
  }
}

/** Se `pasta` é um link simbólico ou junção, devolve o destino real do link (ou "(destino inexistente)"); senão, null. */
function linkDaPasta(pasta) {
  let lst
  try {
    lst = fs.lstatSync(pasta)
  } catch {
    return null
  }
  if (!lst.isSymbolicLink()) return null
  try {
    return fs.realpathSync(pasta)
  } catch {
    return '(destino inexistente)'
  }
}

const hashArquivo = (arquivo) => createHash('sha256').update(fs.readFileSync(arquivo)).digest('hex')

function lerJson(arquivo) {
  if (!existe(arquivo)) return { existe: false }
  let texto
  try {
    texto = fs.readFileSync(arquivo, 'utf8')
  } catch (e) {
    return { existe: true, erro: `não consegui ler (${e.message})` }
  }
  try {
    return { existe: true, texto, obj: JSON.parse(texto.replace(/^\uFEFF/, '')) }
  } catch (e) {
    return { existe: true, texto, erro: `não é um JSON válido (${e.message})` }
  }
}

function versaoNumeros(v) {
  const n = String(v || '').split('.').map((x) => Number.parseInt(x, 10) || 0)
  while (n.length < 3) n.push(0)
  return n
}

/** Compara x.y.z numericamente: -1, 0 ou 1. */
function compararVersoes(a, b) {
  const x = versaoNumeros(a)
  const y = versaoNumeros(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

/** Arquivos de uma pasta, caminhos relativos com "/". */
function listar(raiz) {
  const saida = []
  const visita = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, e.name)
      if (e.isDirectory()) visita(completo)
      else if (e.isFile()) saida.push(path.relative(raiz, completo).split(path.sep).join('/'))
    }
  }
  if (ehPasta(raiz)) visita(raiz)
  return saida.sort()
}

/**
 * Arquivos do plugin que o instalador copia (caminhos relativos com "/"). No pacote .skill é a pasta inteira
 * (o gerar-skill.mjs já filtrou); no clone do repositório aplica o mesmo filtro do pacote.
 */
function listarPacote() {
  if (!DO_CLONE) return listar(PKG_PLUGIN)
  const saida = existe(path.join(PKG_PLUGIN, MANIFESTO)) ? [MANIFESTO] : []
  for (const pasta of PASTAS_DO_CLONE) {
    for (const rel of listar(path.join(PKG_PLUGIN, pasta))) {
      const completo = `${pasta}/${rel}`
      if (PULAR_NO_CLONE.some((p) => completo.startsWith(p))) continue
      saida.push(completo)
    }
  }
  return saida.sort()
}

/** Apaga as pastas vazias de dentro de `dir` (e a própria `dir` se `incluirRaiz`). Nunca apaga arquivo. */
function removerPastasVazias(dir, incluirRaiz) {
  if (!ehPasta(dir) || linkDaPasta(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) removerPastasVazias(path.join(dir, e.name), true)
  if (incluirRaiz && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
}

/** Lista curta para mensagens: os primeiros itens e "e mais N". */
function resumirLista(itens, max = 8) {
  return itens.length <= max ? itens.join(', ') : `${itens.slice(0, max).join(', ')} e mais ${itens.length - max}`
}

/** Chave para comparar caminhos: tira aspas em volta e, no Windows, ignora maiúsculas e o tipo de barra. */
function chaveCaminho(p) {
  const limpo = (t) => t.trim().replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const s = limpo(limpo(String(p)).replace(/^"(.*)"$/, '$1')) // barra depois das aspas, ou dentro delas: tanto faz
  return IS_WIN ? s.toLowerCase() : s
}

const fold = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const mesmoNome = (t) => fold(t).replace(/[\s_-]+/g, ' ').trim()
const clip = (t, max) => {
  const plano = t.replace(/\s+/g, ' ').trim()
  return plano.length > max ? plano.slice(0, max - 1) + '…' : plano
}

// ───────────────────────── Equipe (mesmas regras do plugin/hooks/team.ts) ─────────────────────────

function modeloCurto(m) {
  if (typeof m !== 'string' || !m) return ''
  if (/opus/i.test(m)) return 'Opus'
  if (/sonnet/i.test(m)) return 'Sonnet'
  if (/haiku/i.test(m)) return 'Haiku'
  if (/fable/i.test(m)) return 'Fable'
  return ''
}

/** JSON da equipe com 2 espaços, mas palavras e apelidos numa linha só (igual ao formatTeamFile do plugin). */
function formatarEquipe(conteudo) {
  return JSON.stringify(conteudo, null, 2).replace(/("(?:palavras|apelidos)": )\[([^\]]*)\]/g, (inteiro, chave, itens) => {
    try {
      const lista = JSON.parse(`[${itens}]`)
      return `${chave}[${lista.map((i) => JSON.stringify(i)).join(', ')}]`
    } catch {
      return inteiro
    }
  })
}

/** Confere a equipe e devolve a lista de problemas (vazia = serve). Junta todos, para corrigir de uma vez. */
function validarEquipe(raw) {
  const erros = []
  if (!isObj(raw)) return ['o arquivo precisa ser um objeto JSON com a lista "papeis"']
  const papeis = raw.papeis
  if (!Array.isArray(papeis) || papeis.length === 0) {
    erros.push('"papeis" precisa ser uma lista com pelo menos 1 mesa')
  } else {
    if (papeis.length > MAX_MESAS) erros.push(`no máximo ${MAX_MESAS} mesas (o arquivo tem ${papeis.length})`)
    const vistos = new Map()
    papeis.forEach((p, i) => {
      const n = i + 1
      if (!isObj(p)) return erros.push(`mesa ${n}: precisa ser um objeto com "nome"`)
      if (typeof p.nome !== 'string' || !p.nome.trim()) return erros.push(`mesa ${n}: falta o "nome"`)
      const nome = p.nome.replace(/\s+/g, ' ').trim()
      if (nome.length > 22) erros.push(`mesa ${n} ("${nome}"): o nome tem ${nome.length} caracteres e o máximo é 22`)
      const chave = mesmoNome(nome)
      if (vistos.has(chave)) erros.push(`mesa ${n} ("${nome}"): o nome repete o da mesa ${vistos.get(chave)} (sem diferenciar maiúsculas e acentos)`)
      else vistos.set(chave, n)
      if (p.modelo !== undefined) {
        if (typeof p.modelo !== 'string') erros.push(`mesa "${nome}": "modelo" precisa ser um texto (Opus, Sonnet, Haiku ou Fable)`)
        else if (p.modelo.trim() && !modeloCurto(p.modelo)) erros.push(`mesa "${nome}": modelo "${p.modelo}" desconhecido (use Opus, Sonnet, Haiku ou Fable)`)
      }
      for (const campo of ['palavras', 'apelidos']) {
        const v = p[campo]
        if (v === undefined) continue
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) erros.push(`mesa "${nome}": "${campo}" precisa ser uma lista de textos`)
      }
    })
  }
  if (raw.lider !== undefined) {
    if (!isObj(raw.lider)) erros.push('"lider" precisa ser um objeto {"nome": "...", "modelo": "..."}')
    else {
      if (raw.lider.nome !== undefined && typeof raw.lider.nome !== 'string') erros.push('"lider.nome" precisa ser um texto')
      if (raw.lider.modelo !== undefined) {
        if (typeof raw.lider.modelo !== 'string') erros.push('"lider.modelo" precisa ser um texto (Opus, Sonnet, Haiku ou Fable)')
        else if (raw.lider.modelo.trim() && !modeloCurto(raw.lider.modelo)) erros.push(`lider: modelo "${raw.lider.modelo}" desconhecido (use Opus, Sonnet, Haiku ou Fable)`)
      }
    }
  }
  if (raw.orientar !== undefined && typeof raw.orientar !== 'boolean') erros.push('"orientar" precisa ser true ou false')
  return erros
}

/** Linhas para mostrar uma equipe (já validada): líder e mesas com modelo. */
function linhasEquipe(raw) {
  if (!isObj(raw)) return ['(conteúdo inesperado)']
  const l = isObj(raw.lider) ? raw.lider : {}
  const lider = typeof l.nome === 'string' && l.nome.trim() ? clip(l.nome, 22) : 'Tech Lead'
  const modeloLider = modeloCurto(l.modelo) || 'Opus'
  const papeis = Array.isArray(raw.papeis) ? raw.papeis : []
  const linhas = [`Líder: ${lider} (${modeloLider})`, `Mesas (${papeis.length}):`]
  papeis.forEach((p, i) => {
    const nome = isObj(p) && typeof p.nome === 'string' ? clip(p.nome, 22) : '?'
    const modelo = (isObj(p) && modeloCurto(p.modelo)) || 'sem modelo fixo'
    linhas.push(`  ${i + 1}. ${nome} - ${modelo}`)
  })
  return linhas
}

/** Lê um arquivo de equipe: { existe, erro?, obj?, texto? } (erro já cobre JSON ruim e regras quebradas). */
function lerEquipe(arquivo) {
  const j = lerJson(arquivo)
  if (!j.existe) return j
  if (j.erro) return j
  const erros = validarEquipe(j.obj)
  if (erros.length > 0) return { ...j, erro: erros.join('; ') }
  return j
}

function mostrarEquipe(raw, recuo = '  ') {
  for (const l of linhasEquipe(raw)) info(recuo + l)
}

// ───────────────────────── Pacote e plugin instalado ─────────────────────────

function lerPacote(precisaServidor) {
  const manifesto = path.join(PKG_PLUGIN, MANIFESTO)
  if (!ehPasta(PKG_PLUGIN) || !existe(manifesto) || !existe(path.join(PKG_PLUGIN, 'hooks', 'hooks.json'))) {
    throw new Sair(
      1,
      `Não achei o plugin para instalar (${PKG_ORIGEM}: ${PKG_PLUGIN}).`,
      'O instalador procura em dois lugares:',
      `  - no pacote da skill: ${PKG_EMBUTIDO}`,
      `  - num clone do repositório: ${PKG_CLONE}`,
      'Rode-o de dentro do pacote .skill completo ou de um clone inteiro do repositório (ou gere o pacote de novo: node scripts/gerar-skill.mjs).',
    )
  }
  if (precisaServidor && !existe(path.join(PKG_PLUGIN, 'web', 'server.mjs'))) {
    throw new Sair(1, `O plugin (${PKG_ORIGEM}) está sem o painel web (web/server.mjs).`)
  }
  let versao
  try {
    versao = JSON.parse(fs.readFileSync(manifesto, 'utf8').replace(/^\uFEFF/, '')).version
  } catch (e) {
    throw new Sair(1, `Não consegui ler ${manifesto}: ${e.message}`)
  }
  if (typeof versao !== 'string' || !versao) throw new Sair(1, 'O plugin do pacote não informa a "version" no plugin.json.')
  return { versao }
}

/** Versão do plugin instalado: null = não instalado, "" = pasta existe mas sem versão legível. */
function versaoInstalada() {
  if (!ehPasta(PLUGIN_DEST)) return null
  const j = lerJson(path.join(PLUGIN_DEST, MANIFESTO))
  return j.obj && typeof j.obj.version === 'string' ? j.obj.version : ''
}

/**
 * Compara o pacote com a pasta instalada: o que copiar e o que sobra (arquivos que não são do pacote, nas
 * pastas que o instalador cuida). O que sobra só é listado: o instalador nunca apaga arquivo que não é do pacote.
 */
function planoDoPlugin() {
  const pacote = listarPacote()
  const noPacote = new Set(pacote)
  const copiar = pacote.filter((rel) => {
    const destino = path.join(PLUGIN_DEST, rel)
    if (!existe(destino)) return true
    return !fs.readFileSync(path.join(PKG_PLUGIN, rel)).equals(fs.readFileSync(destino))
  })
  // o manifesto (com a versão) vai por último: se algo falhar no meio, a versão antiga ainda aparece e a próxima rodada refaz
  copiar.sort((a, b) => (a === MANIFESTO ? 1 : b === MANIFESTO ? -1 : a < b ? -1 : 1))
  const sobrando = []
  for (const pasta of PASTAS_DO_PLUGIN) {
    for (const rel of listar(path.join(PLUGIN_DEST, pasta))) {
      const completo = `${pasta}/${rel}`
      if (noPacote.has(completo)) continue
      if (completo.startsWith('.claude-plugin/types/')) continue // gerada pelo próprio Claude Code ao carregar o plugin
      sobrando.push(completo)
    }
  }
  return { total: pacote.length, pacote, copiar, sobrando, servidorMudou: copiar.includes('web/server.mjs') }
}

function aplicarPlugin(plano) {
  for (const rel of plano.copiar) gravar(path.join(PLUGIN_DEST, rel), fs.readFileSync(path.join(PKG_PLUGIN, rel)))
}

// ───────────────────────── settings.json ─────────────────────────

/** Texto cru do settings.json agora (null se não existe): serve para ver se alguém mexeu no arquivo enquanto trabalhávamos. */
function textoDoSettings() {
  try {
    return fs.readFileSync(SETTINGS, 'utf8')
  } catch {
    return null
  }
}

/** Lê o settings.json. `texto` é o conteúdo cru lido (null se o arquivo não existe). */
function lerSettings() {
  if (!existe(SETTINGS)) return { existe: false, obj: {}, texto: null }
  const j = lerJson(SETTINGS)
  const texto = j.texto === undefined ? null : j.texto
  if (j.erro && texto !== null && texto.trim() === '') return { existe: true, obj: {}, vazio: true, texto }
  if (j.erro) return { existe: true, invalido: j.erro, texto }
  if (!isObj(j.obj)) return { existe: true, invalido: 'a raiz do arquivo precisa ser um objeto', texto }
  if (j.obj.env !== undefined && !isObj(j.obj.env)) return { existe: true, invalido: 'a chave "env" precisa ser um objeto', texto }
  const dirs = isObj(j.obj.env) ? j.obj.env[VAR_DIRS] : undefined
  if (dirs !== undefined && typeof dirs !== 'string') return { existe: true, invalido: `${VAR_DIRS} precisa ser um texto`, texto }
  return { existe: true, obj: j.obj, texto }
}

/**
 * Para tudo (código 1) se o settings.json não serve. `quando` ajusta o que dizemos que já foi feito:
 * 'instalar' (antes de qualquer coisa), 'desinstalar' (nada alterado) ou 'depois' (no meio da execução).
 */
function exigirSettingsValido(st, quando = 'instalar') {
  if (!st.invalido) return
  const o_que = {
    instalar: 'Não gravei nada (nem copiei o plugin).',
    desinstalar: 'Nada foi alterado.',
    depois: 'O settings.json ficou como estava; o resto já foi feito.',
  }[quando]
  throw new Sair(1, `O arquivo ${SETTINGS} está com problema: ${st.invalido}.`, `${o_que} Peça ao usuário para corrigir o arquivo (ou corrija com cuidado), depois rode de novo.`)
}

// As entradas voltam como estão no arquivo (com aspas, se tiverem): só a comparação (chaveCaminho) as ignora.
const dividirPastas = (valor) => (typeof valor === 'string' ? valor.split(path.delimiter).map((s) => s.trim()).filter(Boolean) : [])
const temPasta = (lista) => lista.some((d) => chaveCaminho(d) === chaveCaminho(PLUGIN_DEST))

function chavesSalaAtivas(obj) {
  if (!isObj(obj.enabledPlugins)) return []
  return Object.keys(obj.enabledPlugins).filter((k) => k.startsWith('sala-agentes@') && obj.enabledPlugins[k] === true)
}

/** Calcula o settings.json novo para instalar. Não grava. */
function planejarSettings(st, registro) {
  const obj = JSON.parse(JSON.stringify(st.obj))
  if (obj.env === undefined) obj.env = {}
  const env = obj.env
  const mudancas = []
  const avisos = []

  const atuais = dividirPastas(env[VAR_DIRS])
  if (!temPasta(atuais)) {
    env[VAR_DIRS] = [...atuais, PLUGIN_DEST].join(path.delimiter)
    mudancas.push(atuais.length > 0 ? `settings.json: acrescentei a pasta do plugin ao ${VAR_DIRS} (as outras pastas ficaram)` : `settings.json: criei ${VAR_DIRS} com a pasta do plugin`)
  }

  const watch = env[VAR_WATCH]
  const watchFalta = watch === undefined || watch === null || String(watch).trim() === ''
  let colocouWatch
  if (watchFalta) {
    env[VAR_WATCH] = '1'
    colocouWatch = true
    mudancas.push(`settings.json: liguei ${VAR_WATCH}=1 (os chats recarregam o plugin sozinhos)`)
  } else {
    colocouWatch = registro.colocouWatch === true && String(watch).trim() === '1'
    if (!/^(1|true)$/i.test(String(watch).trim())) {
      avisos.push(`${VAR_WATCH} está como "${watch}", então o recarregamento automático do plugin está desligado. Deixei como está.`)
    }
  }

  const dobradas = chavesSalaAtivas(obj)
  if (dobradas.length > 0) {
    avisos.push(
      `O settings.json também tem o plugin ativado em enabledPlugins (${dobradas.join(', ')}). Isso pode carregar a sala duas vezes. Não mexi; considere desligar essa entrada.`,
    )
  }
  return { obj, mudou: mudancas.length > 0, mudancas, avisos, colocouWatch }
}

/**
 * Calcula o settings.json novo para desinstalar: tira a pasta do plugin do CLAUDE_CODE_PLUGIN_DIRS e, só se foi o
 * instalador que o pôs e não restou nenhuma outra pasta de plugin, o CLAUDE_CODE_PLUGIN_DIR_WATCH. Não grava.
 */
function planejarRemocao(st, registro, simular) {
  const obj = JSON.parse(JSON.stringify(st.obj))
  const env = isObj(obj.env) ? obj.env : null
  const mudancas = []
  const infos = []
  if (!env) return { obj, mudou: false, mudancas, infos }
  const lista = dividirPastas(env[VAR_DIRS])
  if (!temPasta(lista)) return { obj, mudou: false, mudancas, infos }
  const resto = lista.filter((d) => chaveCaminho(d) !== chaveCaminho(PLUGIN_DEST))
  if (resto.length > 0) env[VAR_DIRS] = resto.join(path.delimiter)
  else delete env[VAR_DIRS]
  mudancas.push(`${simular ? 'tiraria' : 'tirei'} a pasta do plugin do ${VAR_DIRS}${resto.length > 0 ? ' (as outras pastas ficaram)' : ''}`)
  if (registro.colocouWatch === true && resto.length === 0 && env[VAR_WATCH] !== undefined) {
    delete env[VAR_WATCH]
    mudancas.push(`${simular ? 'tiraria' : 'tirei'} ${VAR_WATCH} (foi o instalador que colocou)`)
  } else if (env[VAR_WATCH] !== undefined) {
    infos.push(`${VAR_WATCH} ficou como está (${registro.colocouWatch === true ? 'há outras pastas de plugin usando' : 'não foi o instalador que colocou'}).`)
  }
  if (Object.keys(env).length === 0) delete obj.env
  return { obj, mudou: true, mudancas, infos }
}

/** Grava o settings.json (com cópia de segurança antes, se já existia). Devolve o caminho da cópia ou null. */
function gravarSettings(obj, existiaArquivo) {
  let copia = null
  if (existiaArquivo) {
    copia = `${SETTINGS}.bak-sala-${stamp()}`
    fs.copyFileSync(SETTINGS, copia)
  }
  gravar(SETTINGS, JSON.stringify(obj, null, 2) + '\n')
  return copia
}

/**
 * Grava o resultado de `planejar(st)` sem passar por cima de uma mudança feita por outro programa (o Claude Code, o
 * usuário) desde que lemos o arquivo: relê o texto antes de gravar; se mudou, refaz a leitura e o plano UMA vez sobre
 * o texto novo; se mudar de novo, para com código 1 sem gravar.
 * Devolve { ps, copia, gravou } com o plano que valeu.
 */
function gravarSettingsSeguro(st, planejar, quando) {
  let atual = st
  let ps = planejar(atual)
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (!ps.mudou) return { ps, copia: null, gravou: false }
    if (textoDoSettings() === atual.texto) {
      const copia = gravarSettings(ps.obj, atual.existe)
      return { ps, copia, gravou: true }
    }
    atual = lerSettings()
    exigirSettingsValido(atual, quando)
    ps = planejar(atual)
  }
  throw new Sair(
    1,
    `O ${SETTINGS} mudou enquanto eu trabalhava e mudou de novo quando reli. Não gravei nada nele.`,
    'Veja se outro programa está editando o arquivo e rode de novo.',
  )
}

// ───────────────────────── Registro da instalação ─────────────────────────

function lerRegistro() {
  const j = lerJson(INSTALL_JSON)
  return j.obj && isObj(j.obj) ? j.obj : {}
}

// ───────────────────────── Painel web ─────────────────────────

function lerWeb() {
  const j = lerJson(WEB_JSON)
  return j.obj && isObj(j.obj) ? j.obj : null
}

function portaEHost(web) {
  const porta = web && Number.isInteger(web.port) && web.port > 0 && web.port < 65536 ? web.port : PORTA_PADRAO
  const host = web && typeof web.host === 'string' && web.host ? web.host : '0.0.0.0'
  return { porta, host }
}

/**
 * true se o painel nunca chegou a subir nesta conta: sem web.json, ou sem a chave (token), ou sem os links.
 * O painel só preenche os links depois de abrir a porta; uma primeira subida que falhou deixa só {"port": N}
 * (ou o token com a lista de links vazia). Nesse caso a porta ainda pode ser trocada com --porta.
 */
function painelNuncaSubiu(web) {
  return !web || typeof web.token !== 'string' || !web.token || !Array.isArray(web.urls) || web.urls.length === 0
}

/**
 * true se GET /health responde "ok". Resolve uma vez só, aconteça o que acontecer (resposta enorme ou em fluxo,
 * conexão cortada, erro, demora): o prazo `ms` vale para a resposta inteira, não só para o silêncio do socket.
 */
function saude(porta, host, ms = 1500) {
  return new Promise((resolve) => {
    let feito = false
    let timer = null
    let req = null
    const fim = (valor) => {
      if (feito) return
      feito = true
      clearTimeout(timer)
      try {
        if (req) req.destroy()
      } catch {}
      resolve(valor)
    }
    timer = setTimeout(() => fim(false), ms)
    const alvo = !host || host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
    try {
      req = http.get({ host: alvo, port: porta, path: '/health', agent: false }, (res) => {
        let corpo = ''
        const certo = () => res.statusCode === 200 && corpo.trim() === 'ok'
        res.setEncoding('utf8')
        res.on('data', (c) => {
          corpo += c
          if (corpo.length > 100) fim(false) // o painel responde "ok": isso não é ele
        })
        res.on('end', () => fim(certo()))
        res.on('close', () => fim(false)) // fechou sem terminar a resposta (o 'end' normal já resolveu antes)
        res.on('error', () => fim(false))
      })
      req.on('error', () => fim(false))
    } catch {
      fim(false)
    }
  })
}

async function esperarSaude(porta, host, segundos, esperado = true) {
  const fim = Date.now() + segundos * 1000
  for (;;) {
    if ((await saude(porta, host)) === esperado) return true
    if (Date.now() >= fim) return false
    await dormir(300)
  }
}

function executar(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: 25000, windowsHide: true })
}

/** PIDs que escutam na porta (vazio se não achou ou se faltou a ferramenta). */
function pidsDaPorta(porta) {
  const r = IS_WIN
    ? executar('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(Get-NetTCPConnection -LocalPort ${porta} -State Listen -ErrorAction SilentlyContinue).OwningProcess`,
      ])
    : executar('lsof', ['-ti', `tcp:${porta}`, '-sTCP:LISTEN'])
  if (r.error || !r.stdout) return []
  return [...new Set(r.stdout.split(/\r?\n/).map((s) => Number.parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0))]
}

function linhaDeComando(pid) {
  // No Windows o PowerShell responde na página de código do console (OEM) e estraga acentos do caminho: força UTF-8.
  const r = IS_WIN
    ? executar('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; (Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
      ])
    : executar('ps', ['-ww', '-p', String(pid), '-o', 'args=']) // -ww: sem cortar a linha de comando
  return r.error || !r.stdout ? '' : r.stdout.replace(/^\uFEFF/, '').trim()
}

const normalizarCmd = (s) => String(s).replace(/\\/g, '/').toLowerCase()

/** true se o processo `pid` roda o server.mjs instalado (…/sala-agentes/web/server.mjs) desta conta. */
function ehOPainelInstalado(pid) {
  const cmd = normalizarCmd(linhaDeComando(pid))
  return cmd.includes('sala-agentes') && cmd.includes(normalizarCmd(SERVER_DEST))
}

/** PID gravado quando o instalador subiu o painel (null se não há). */
function lerPidGravado() {
  try {
    const n = Number.parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10)
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function apagarPidGravado() {
  try {
    fs.unlinkSync(PID_FILE)
  } catch {}
}

/**
 * Encerra o painel desta conta. Primeiro confere o PID gravado em painel.pid; se ele não estiver mais rodando o
 * server.mjs instalado, procura quem escuta na porta. Só encerra processo cuja linha de comando mostre o
 * server.mjs instalado: qualquer outro programa, ou um painel de outra pasta ou de outra conta, não é tocado.
 * Devolve { parou, alheio?, motivo? }.
 */
async function pararPainel(porta, host) {
  let alvos = []
  const gravado = lerPidGravado()
  if (gravado && gravado !== process.pid && ehOPainelInstalado(gravado)) alvos = [gravado]
  if (alvos.length === 0) {
    const pids = pidsDaPorta(porta).filter((p) => p !== process.pid)
    if (pids.length === 0) return { parou: false, motivo: 'não consegui descobrir qual programa usa a porta' }
    for (const pid of pids) {
      if (!ehOPainelInstalado(pid)) {
        return {
          parou: false,
          alheio: true,
          motivo: `a porta ${porta} é usada por um programa que não é o painel instalado nesta conta (processo ${pid}), e não mexi nele`,
        }
      }
    }
    alvos = pids
  }
  for (const pid of alvos) {
    try {
      process.kill(pid)
    } catch (e) {
      return { parou: false, motivo: `não consegui encerrar o processo ${pid} (${e.message})` }
    }
  }
  const livre = await esperarSaude(porta, host, 6, false)
  if (!livre) return { parou: false, motivo: 'o painel antigo não encerrou a tempo' }
  apagarPidGravado()
  return { parou: true }
}

function subirPainel(servidor) {
  const env = { ...process.env }
  delete env.SALA_PORT // o web.json é quem manda na porta; o /health olha a mesma porta
  delete env.SALA_LIVE_DIR
  if (TESTE) {
    env.USERPROFILE = HOME // o servidor usa os.homedir(): aponta para a pasta de teste
    env.HOME = HOME
  }
  let erro = null
  const filho = spawn(process.execPath, [servidor], { detached: true, stdio: 'ignore', windowsHide: true, env })
  filho.once('error', (e) => {
    erro = e
  })
  filho.unref()
  if (filho.pid) {
    // o PID fica registrado para o próximo reinício achar o painel sem depender de quem escuta na porta
    try {
      gravar(PID_FILE, `${filho.pid}\n`)
    } catch {}
  }
  return () => erro
}

/** Sobe o painel e espera o /health (até 10 s). Devolve { subiu, erro }. */
async function subirEEsperar(servidor, porta, host) {
  const erroDoFilho = subirPainel(servidor)
  const subiu = await esperarSaude(porta, host, 10)
  if (!subiu) apagarPidGravado() // o processo que subimos não ficou de pé: o PID gravado não vale
  return { subiu, erro: subiu ? null : erroDoFilho() }
}

/** Texto do start-painel.vbs (o mesmo modelo de sempre, com os caminhos desta máquina). */
function textoVbs() {
  const aspas = (s) => s.replace(/"/g, '""')
  const linhas = [
    "' Inicia o painel web da Sala dos Agentes (Squadesk) oculto, sem esperar.",
    "' Para desligar: apague este arquivo da pasta Inicializar e encerre o processo node do painel.",
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'Set sh = CreateObject("WScript.Shell")',
    'node = "node"',
    `If fso.FileExists("${aspas(process.execPath)}") Then node = """${aspas(process.execPath)}"""`,
    `sh.Run node & " ""${aspas(SERVER_DEST)}""", 0, False`,
  ]
  return linhas.join('\r\n') + '\r\n'
}

/** O WScript lê o vbs na página de código do Windows; com acento no caminho, grava em UTF-16 com BOM (que ele entende). */
function bytesVbs(texto) {
  if (!/[^\x00-\x7f]/.test(texto)) return Buffer.from(texto, 'latin1')
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(texto, 'utf16le')])
}

function mostrarLinks(web, porta) {
  const urls = web && Array.isArray(web.urls) ? web.urls.filter((u) => typeof u === 'string') : []
  if (urls.length > 0) {
    info('Links do painel (use o que combina com o aparelho: o localhost só serve neste computador):')
    for (const u of urls) info(`  ${u}`)
  } else if (web && typeof web.token === 'string') {
    info('Link do painel:')
    info(`  http://localhost:${porta}/?t=${web.token}`)
  }
}

// ───────────────────────── Argumentos ─────────────────────────

const OPCOES_COM_VALOR = new Set(['equipe', 'onde', 'projeto', 'porta'])
const OPCOES_SEM_VALOR = new Set(['verificar', 'simular', 'substituir', 'painel', 'iniciar-com-windows', 'forcar', 'desinstalar', 'ajuda'])

function lerArgumentos(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    if (a === '-h' || a === '--help') a = '--ajuda'
    if (!a.startsWith('--')) throw new Sair(1, `Argumento inesperado: "${a}". Veja as opções com --ajuda.`)
    let valor
    const igual = a.indexOf('=')
    if (igual > 0) {
      valor = a.slice(igual + 1)
      a = a.slice(0, igual)
    }
    const nome = a.slice(2)
    if (OPCOES_COM_VALOR.has(nome)) {
      if (valor === undefined) {
        valor = argv[++i]
        if (valor === undefined || valor.startsWith('--')) throw new Sair(1, `A opção --${nome} precisa de um valor.`)
      }
      o[nome] = valor
    } else if (OPCOES_SEM_VALOR.has(nome)) {
      if (valor !== undefined) throw new Sair(1, `A opção --${nome} não recebe valor.`)
      o[nome] = true
    } else {
      throw new Sair(1, `Opção desconhecida: ${a}. Veja as opções com --ajuda.`)
    }
  }
  return o
}

const AJUDA = `Instalador da Sala dos Agentes (plugin do Claude Code)

Uso: node instalar.mjs [opções]

Dois jeitos de rodar (o plugin é achado sozinho; a saída diz de onde veio):
  - De dentro do pacote .skill (extraído):   node sala-agentes/scripts/instalar.mjs [opções]
    Usa a pasta assets/plugin do pacote.
  - De um clone do repositório (raiz do clone): node skill/sala-agentes/scripts/instalar.mjs [opções]
    Sem assets/plugin, usa a pasta plugin/ da raiz do clone (só o que o pacote levaria: sem tests/ nem web/sample/).

Exemplo mínimo (instala o plugin e liga o painel web):
  node skill/sala-agentes/scripts/instalar.mjs --painel

Opções:
  --verificar                 Só mostra o estado e não muda nada: Node, versão instalada x versão do pacote,
                              variáveis no settings.json, equipe da conta e do projeto, painel e atalho.
  --simular                   Faz toda a análise e diz o que mudaria, sem gravar nada.
  --equipe <arquivo.json>     Equipe a gravar (validada antes de mexer em qualquer coisa).
  --onde conta|projeto        Onde gravar a equipe (padrão: conta).
  --projeto <pasta>           Pasta do projeto (obrigatória com --onde projeto; deve existir).
  --substituir                Permite trocar uma equipe existente e diferente (guarda cópia .bak-AAAAMMDD-HHMMSS).
  --painel                    Liga o painel web agora (e o reinicia se o server.mjs instalado mudou).
  --iniciar-com-windows       Com --painel, no Windows: o painel sobe sozinho quando você entra no Windows.
  --porta <n>                 Porta do painel; só vale se o web.json ainda não existe.
  --forcar                    Instala mesmo se a versão instalada for mais nova que a do pacote.
  --desinstalar               Tira o plugin, a entrada dele no settings.json, o atalho de inicialização e para o painel.
                              Equipes, web.json e retratos ficam.
  --ajuda                     Mostra este texto.

Códigos de saída: 0 deu certo; 1 erro; 2 precisa da confirmação do usuário (nada foi alterado).
Para testar sem tocar na conta real: variáveis SALA_HOME e SALA_STARTUP_DIR.
`

// ───────────────────────── Verificar ─────────────────────────

async function verificar(o) {
  titulo('Estado da Sala dos Agentes (nada é alterado)')
  const faltas = []

  // Node
  const major = Number.parseInt(process.versions.node, 10)
  if (major >= 18) ok(`Node ${process.versions.node}`)
  else {
    falha(`Node ${process.versions.node} é velho demais (precisa do 18 ou mais novo)`)
    faltas.push('Node 18+')
  }

  // Pacote x instalada
  titulo('Plugin')
  let pacote = null
  try {
    pacote = lerPacote(false)
    info(`Versão do pacote: ${pacote.versao}  (origem: ${PKG_ORIGEM}, ${PKG_PLUGIN})`)
  } catch (e) {
    aviso(e.linhas ? e.linhas[0] : e.message)
  }
  const alvoDoLink = linkDaPasta(PLUGIN_DEST)
  const inst = versaoInstalada()
  if (alvoDoLink) {
    aviso(`A pasta do plugin (${PLUGIN_DEST}) é um link para ${alvoDoLink}. O instalador não escreve nela; para instalar de verdade, troque o link por uma pasta comum.`)
    faltas.push('pasta do plugin é um link')
  }
  if (inst === null) {
    if (!alvoDoLink) {
      aviso(`Plugin ainda não instalado (${PLUGIN_DEST})`)
      faltas.push('plugin não instalado')
    }
  } else {
    info(`Versão instalada: ${inst || 'desconhecida'}  (${PLUGIN_DEST})`)
    if (pacote) {
      const c = compararVersoes(inst, pacote.versao)
      if (c < 0) {
        aviso('Há uma versão mais nova no pacote: rode o instalador para atualizar.')
        faltas.push('atualização disponível')
      } else if (c > 0) aviso('A versão instalada é mais nova que a do pacote.')
      else ok('Versão instalada igual à do pacote.')
      const plano = planoDoPlugin()
      if (plano.copiar.length > 0) {
        aviso(`${plano.copiar.length} arquivo(s) do pacote estão diferentes ou faltando na pasta instalada: ${resumirLista(plano.copiar)}.`)
        if (c === 0) faltas.push('arquivos do plugin diferentes do pacote')
      } else ok('Os arquivos do pacote estão todos instalados e idênticos.')
      if (plano.sobrando.length > 0) info(`Arquivos que não são do pacote (ficam como estão): ${resumirLista(plano.sobrando)}.`)
    }
  }

  // settings.json
  titulo('settings.json')
  const st = lerSettings()
  info(SETTINGS)
  if (!st.existe) {
    aviso('O arquivo ainda não existe.')
    faltas.push('settings.json sem as variáveis')
  } else if (st.invalido) {
    falha(`Arquivo com problema: ${st.invalido}`)
    faltas.push('settings.json inválido')
  } else {
    const env = isObj(st.obj.env) ? st.obj.env : {}
    const lista = dividirPastas(env[VAR_DIRS])
    if (temPasta(lista)) ok(`${VAR_DIRS} inclui a pasta do plugin${lista.length > 1 ? ` (mais ${lista.length - 1} outra(s))` : ''}`)
    else {
      aviso(`${VAR_DIRS} não inclui ${PLUGIN_DEST}`)
      faltas.push(`${VAR_DIRS} sem a pasta do plugin`)
    }
    const w = env[VAR_WATCH]
    if (w !== undefined && /^(1|true)$/i.test(String(w).trim())) ok(`${VAR_WATCH}=${w}`)
    else {
      aviso(`${VAR_WATCH} ${w === undefined ? 'não está definido' : `está como "${w}"`} (sem ele os chats não recarregam o plugin sozinhos)`)
      faltas.push(`${VAR_WATCH} desligado`)
    }
    for (const k of chavesSalaAtivas(st.obj)) aviso(`enabledPlugins tem "${k}" ativo: o plugin pode carregar duas vezes.`)
  }

  // Equipes
  titulo('Equipe')
  const mostrar = (rotulo, arquivo) => {
    const e = lerEquipe(arquivo)
    info(`${rotulo}: ${arquivo}`)
    if (!e.existe) info('  não existe (vale a equipe padrão ou a de cima)')
    else if (e.erro) {
      aviso(`  existe mas não serve: ${e.erro}`)
      faltas.push(`${rotulo.toLowerCase()} inválida`)
    } else mostrarEquipe(e.obj, '  ')
  }
  mostrar('Equipe da conta', path.join(CLAUDE_DIR, 'sala-agentes.json'))
  if (o.projeto) {
    const proj = path.resolve(o.projeto)
    if (!ehPasta(proj)) aviso(`A pasta do projeto não existe: ${proj}`)
    else mostrar('Equipe do projeto', path.join(proj, '.claude', 'sala-agentes.json'))
    info('(a equipe do projeto vale no lugar da equipe da conta)')
  }
  if (o.equipe) {
    const e = lerEquipe(path.resolve(o.equipe))
    if (!e.existe) {
      falha(`Arquivo de equipe não encontrado: ${path.resolve(o.equipe)}`)
      faltas.push('arquivo --equipe inexistente')
    } else if (e.erro) {
      falha(`O arquivo ${o.equipe} não serve: ${e.erro}`)
      faltas.push('arquivo --equipe inválido')
    } else {
      ok(`O arquivo ${o.equipe} é uma equipe válida:`)
      mostrarEquipe(e.obj, '  ')
    }
  }

  // Painel
  titulo('Painel web')
  const web = lerWeb()
  const { porta, host } = portaEHost(web)
  let noAr = false
  if (!web) {
    // Sem web.json o painel nunca rodou nesta conta: não adianta (nem é seguro) sondar a porta padrão, que pode ser de outra conta.
    info(`web.json ainda não existe (${WEB_JSON}): o painel nunca foi ligado nesta conta (a porta padrão é a ${PORTA_PADRAO}).`)
  } else {
    info(`web.json: porta ${porta}, endereço ${host}`)
    noAr = await saude(porta, host)
    if (noAr) ok(`/health respondeu na porta ${porta}: o painel está no ar.`)
    else info(`/health não respondeu na porta ${porta}: o painel não está rodando (ou está em outra porta).`)
  }
  if (STARTUP_VBS) {
    if (existe(STARTUP_VBS)) ok(`Atalho de inicialização: ${STARTUP_VBS}`)
    else info('Atalho de inicialização: não existe (o painel não sobe sozinho no login).')
  } else info('Atalho de inicialização: só existe no Windows.')
  if (noAr) mostrarLinks(web, porta)

  const reg = lerRegistro()
  if (reg.instaladoEm) info(`Registro do instalador: v${reg.version || '?'} em ${reg.instaladoEm}`)

  titulo('Situação')
  if (faltas.length === 0) ok('Tudo certo.')
  else aviso(`Pendências: ${faltas.join('; ')}.`)
  return 0
}

// ───────────────────────── Instalar ─────────────────────────

function prepararEquipe(o) {
  const onde = o.onde || 'conta'
  const origem = path.resolve(o.equipe)
  let destino
  if (onde === 'projeto') {
    if (!o.projeto) throw new Sair(1, 'Com --onde projeto é preciso dizer a pasta do projeto: --projeto <pasta>.')
    const proj = path.resolve(o.projeto)
    if (!ehPasta(proj)) throw new Sair(1, `A pasta do projeto não existe: ${proj}`)
    destino = path.join(proj, '.claude', 'sala-agentes.json')
  } else {
    if (o.projeto) throw new Sair(1, 'Você passou --projeto, mas a equipe iria para a conta. Use --onde projeto para gravar no projeto, ou tire o --projeto.')
    destino = path.join(CLAUDE_DIR, 'sala-agentes.json')
  }
  const lido = lerJson(origem)
  if (!lido.existe) throw new Sair(1, `Não achei o arquivo de equipe: ${origem}`)
  if (lido.erro) throw new Sair(1, `O arquivo de equipe ${origem} ${lido.erro}.`, 'Nada foi alterado.')
  const erros = validarEquipe(lido.obj)
  if (erros.length > 0) {
    throw new Sair(1, `A equipe em ${origem} não serve:`, ...erros.map((e) => `  - ${e}`), 'Nada foi alterado. Corrija o arquivo e rode de novo.')
  }
  const texto = formatarEquipe(lido.obj) + '\n'
  const atual = lerJson(destino)
  let situacao = 'nova' // nova | igual | igual-com-bom | diferente
  if (atual.existe) {
    const igual = !atual.erro && formatarEquipe(atual.obj) === formatarEquipe(lido.obj)
    // a equipe é a mesma, mas o arquivo começa com BOM: regrava sem ele (a equipe sempre é gravada sem BOM)
    situacao = igual ? (typeof atual.texto === 'string' && atual.texto.charCodeAt(0) === 0xfeff ? 'igual-com-bom' : 'igual') : 'diferente'
  }
  return { onde, origem, destino, raw: lido.obj, texto, atual, situacao }
}

/**
 * Encerra o painel que está no ar para trocá-lo pelo novo. Na simulação só anuncia.
 * Devolve o resultado de pararPainel ({ parou, alheio?, motivo? }).
 */
async function pararParaReiniciar({ simular, porta, host, motivo, marca, avisos }) {
  if (simular) {
    info(`O painel está no ar na porta ${porta}; reiniciaria (${motivo}).`)
    marca('painel reiniciado com o server.mjs novo')
    return { parou: true }
  }
  info(`O painel está no ar na porta ${porta} (${motivo}): reiniciando.`)
  const r = await pararPainel(porta, host)
  if (r.parou) marca('painel reiniciado com o server.mjs novo')
  else avisos.push(`Não reiniciei o painel: ${r.motivo}. Ele continua rodando a versão antiga; encerre-o à mão e rode com --painel de novo.`)
  return r
}

/** Sobe o painel de verdade e espera o /health. Guarda o hash do server.mjs que ele está rodando. Devolve { subiu, erro }. */
async function ligarPainel({ porta, host, estado, marca, religado }) {
  info(`Ligando o painel (porta ${porta})...`)
  const s = await subirEEsperar(SERVER_DEST, porta, host)
  if (!s.subiu) return s
  estado.painelHash = hashArquivo(SERVER_DEST)
  if (!religado) marca(`painel ligado na porta ${porta}`)
  ok(`Painel no ar na porta ${porta}.`)
  return s
}

/**
 * Atualização sem --painel: se o server.mjs instalado mudou e o painel desta conta está no ar rodando o código
 * velho, reinicia (com a mesma checagem de processo). Devolve { falhou }.
 */
async function reiniciarPainelAntigo({ simular, porta, host, estado, marca, avisos }) {
  const r = await pararParaReiniciar({ simular, porta, host, motivo: 'o server.mjs foi atualizado', marca, avisos })
  if (!r.parou || simular) return { falhou: false }
  const s = await ligarPainel({ porta, host, estado, marca, religado: true })
  if (!s.subiu) {
    falha(s.erro ? `Não consegui iniciar o Node: ${s.erro.message}` : `O painel antigo foi encerrado, mas o novo não respondeu em /health em 10 segundos (porta ${porta}).`)
    info('Rode de novo com --painel para tentar ligá-lo.')
    return { falhou: true }
  }
  mostrarLinks(lerWeb(), porta)
  return { falhou: false }
}

async function instalar(o) {
  const simular = Boolean(o.simular)
  const mudancas = []
  const avisos = []
  const ficaram = [] // arquivos que não são do pacote e foram deixados em paz
  const marca = (t) => mudancas.push(t)

  titulo(simular ? 'Simulação: nada será gravado' : 'Instalando a Sala dos Agentes')
  if (TESTE) aviso(`MODO DE TESTE: pasta pessoal = ${HOME}`)

  // ── Análise: nada é gravado aqui. Qualquer problema para antes de mexer em algo.
  const pacote = lerPacote(Boolean(o.painel))
  info(`Origem do plugin: ${PKG_ORIGEM} (${PKG_PLUGIN})`)
  const alvoDoLink = linkDaPasta(PLUGIN_DEST)
  if (alvoDoLink) {
    throw new Sair(
      1,
      `A pasta do plugin (${PLUGIN_DEST}) é um link para ${alvoDoLink}; não escrevo nele.`,
      'Nada foi alterado. Troque o link por uma pasta comum (ou apague o link) e rode de novo.',
    )
  }
  const registro = lerRegistro()
  const inst = versaoInstalada()
  const pendencias = []

  if (inst === null) info(`Primeira instalação (versão ${pacote.versao}).`)
  else {
    const c = inst ? compararVersoes(inst, pacote.versao) : -1
    if (c < 0) info(`Atualização: ${inst || 'versão desconhecida'} -> ${pacote.versao}.`)
    else if (c === 0) info(`Mesma versão (${pacote.versao}); só copio o que estiver diferente.`)
    else if (o.forcar) aviso(`A versão instalada (${inst}) é mais nova que a do pacote (${pacote.versao}); seguindo por causa do --forcar.`)
    else {
      pendencias.push([
        `A versão instalada (${inst}) é mais nova que a do pacote (${pacote.versao}).`,
        'Se o usuário quiser mesmo voltar para a versão do pacote, rode de novo com --forcar.',
      ])
    }
  }

  const st = lerSettings()
  exigirSettingsValido(st)
  const plano = planoDoPlugin()

  let eq = null
  if (o.equipe) {
    eq = prepararEquipe(o)
    if (eq.situacao === 'diferente' && !o.substituir) {
      const l = []
      l.push(`Já existe uma equipe diferente em ${eq.destino}:`)
      if (eq.atual.erro) l.push(`  (o arquivo atual não pôde ser lido: ${eq.atual.erro})`)
      else l.push(...linhasEquipe(eq.atual.obj).map((x) => `  ${x}`))
      l.push(`A equipe nova (${eq.origem}) tem:`)
      l.push(...linhasEquipe(eq.raw).map((x) => `  ${x}`))
      l.push(`Pergunte ao usuário se pode trocar. Se sim, rode de novo com --substituir (a atual vira ${path.basename(eq.destino)}.bak-AAAAMMDD-HHMMSS).`)
      pendencias.push(l)
    }
  } else if (o.onde || o.projeto) {
    aviso('--onde/--projeto só servem junto com --equipe; ignorei.')
  }

  let portaNova = null
  if (o.porta !== undefined) {
    portaNova = Number(o.porta)
    if (!Number.isInteger(portaNova) || portaNova < 1 || portaNova > 65535) throw new Sair(1, `--porta precisa ser um número de 1 a 65535 (recebi "${o.porta}").`)
  }

  if (pendencias.length > 0) {
    titulo('Preciso da confirmação do usuário')
    for (const bloco of pendencias) {
      pergunta(bloco[0])
      for (const l of bloco.slice(1)) info(`    ${l}`)
    }
    console.log('\nNada foi alterado.')
    return 2
  }

  // ── 1. Plugin
  titulo('1. Plugin')
  if (plano.copiar.length === 0) ok(`Já está em dia (${PLUGIN_DEST}).`)
  else {
    info(`${simular ? 'Copiaria' : 'Copiando'} ${plano.copiar.length} de ${plano.total} arquivo(s) para ${PLUGIN_DEST}.`)
    if (!simular) {
      try {
        aplicarPlugin(plano)
      } catch (e) {
        throw new Sair(1, `Não consegui copiar o plugin: ${e.message}`, 'Pode ter ficado pela metade; rode o instalador de novo.')
      }
    }
    marca(`plugin ${inst === null ? 'instalado' : 'atualizado'} em ${PLUGIN_DEST} (${plano.copiar.length} arquivo(s) copiado(s) do ${PKG_ORIGEM})`)
  }
  if (plano.sobrando.length > 0) ficaram.push(...plano.sobrando)

  // ── 2. settings.json
  titulo('2. settings.json')
  let ps = planejarSettings(st, registro)
  let copia = null
  if (ps.mudou && !simular) {
    try {
      // relê o arquivo antes de gravar: se alguém mexeu nele desde a leitura, refaz o ajuste sobre o texto novo
      const r = gravarSettingsSeguro(st, (s) => planejarSettings(s, registro), 'depois')
      ps = r.ps
      copia = r.copia
    } catch (e) {
      if (e instanceof Sair) throw e
      throw new Sair(1, `Não consegui gravar o settings.json: ${e.message}`, 'O plugin já foi copiado, mas o settings.json ficou como estava.')
    }
  }
  avisos.push(...ps.avisos)
  if (!ps.mudou) ok(`Já tem ${VAR_DIRS} com a pasta do plugin e ${VAR_WATCH} ligado.`)
  else {
    for (const m of ps.mudancas) info(`${simular ? 'Faria' : 'Feito'}: ${m.replace(/^settings\.json: /, '')}`)
    if (copia) info(`Cópia de segurança: ${copia}`)
    else if (simular && st.existe) info(`(Guardaria uma cópia de segurança em ${SETTINGS}.bak-sala-<data>)`)
    for (const m of ps.mudancas) marca(m)
  }

  // ── 3. Equipe
  if (eq) {
    titulo('3. Equipe')
    info(`Destino: ${eq.destino} (${eq.onde === 'projeto' ? 'vale só nesse projeto' : 'vale para a conta toda'})`)
    if (eq.situacao === 'igual') ok('Esse arquivo já tem exatamente essa equipe.')
    else {
      if (eq.situacao === 'igual-com-bom') info('A equipe é a mesma, mas o arquivo começava com um BOM (marca invisível); regravando sem ele.')
      else mostrarEquipe(eq.raw)
      if (!simular) {
        try {
          if (eq.situacao === 'diferente') {
            const bak = `${eq.destino}.bak-${stamp()}`
            fs.copyFileSync(eq.destino, bak)
            info(`Equipe anterior guardada em ${bak}`)
            marca(`equipe anterior guardada em ${bak}`)
          }
          gravar(eq.destino, eq.texto)
        } catch (e) {
          throw new Sair(1, `Não consegui gravar a equipe: ${e.message}`)
        }
      }
      marca(
        eq.situacao === 'igual-com-bom'
          ? `equipe regravada sem BOM em ${eq.destino}`
          : `equipe ${eq.situacao === 'nova' ? 'gravada' : 'substituída'} em ${eq.destino}`,
      )
    }
  }

  // ── 4. Painel
  const estado = { painelHash: typeof registro.painelHash === 'string' ? registro.painelHash : null }
  let atalho = null
  let painelFalhou = false
  if (o.painel || portaNova !== null) {
    titulo('4. Painel web')
    const r = await etapaPainel(o, { simular, portaNova, plano, registro, estado, marca, avisos })
    atalho = r.atalho
    painelFalhou = r.falhou
  } else if (plano.servidorMudou) {
    // Atualizou o server.mjs sem pedir --painel: se o painel desta conta está no ar com o código velho, reinicia.
    const web = lerWeb()
    const { porta, host } = portaEHost(web)
    if (!painelNuncaSubiu(web) && (await saude(porta, host))) {
      titulo('4. Painel web')
      const r = await reiniciarPainelAntigo({ simular, porta, host, estado, marca, avisos })
      painelFalhou = r.falhou
    }
  }
  if (atalho === null && STARTUP_VBS && existe(STARTUP_VBS)) atalho = STARTUP_VBS

  // ── 5. Registro
  if (!simular) {
    try {
      gravar(
        INSTALL_JSON,
        JSON.stringify(
          {
            version: pacote.versao,
            instaladoEm: new Date().toISOString(),
            pastaPlugin: PLUGIN_DEST,
            colocouWatch: ps.colocouWatch,
            atalhoInicializar: atalho,
            painelHash: estado.painelHash, // hash do server.mjs com que o painel foi iniciado
            arquivos: plano.pacote, // o que o instalador pôs na pasta do plugin (a desinstalação só apaga isso)
          },
          null,
          2,
        ) + '\n',
      )
    } catch (e) {
      avisos.push(`Não consegui gravar o registro da instalação (${e.message}); a desinstalação pode não saber o que foi colocado pelo instalador.`)
    }
  }

  // ── Resumo
  titulo(simular ? 'Resumo da simulação' : 'Resumo')
  if (mudancas.length === 0) info(simular ? 'Nada mudaria: tudo já está em dia.' : 'Nada mudou: tudo já estava em dia.')
  else {
    info(simular ? 'O que mudaria:' : 'O que mudou:')
    for (const m of mudancas) info(`  - ${m}`)
  }
  if (ficaram.length > 0) info(`Arquivos que não são do pacote ficaram onde estavam (o instalador não apaga o que não é dele): ${resumirLista(ficaram)}.`)
  if (avisos.length > 0) {
    info('Avisos:')
    for (const a of avisos) info(`  [!] ${a}`)
  }
  if (!simular) {
    info('')
    info('Próximos passos:')
    info('  1. Abra um chat novo no Claude Code e digite /sala.')
    info('     (Chats já abertos não leem a variável nova; se mesmo assim não aparecer, reinicie o app.)')
    validarComClaude()
  } else {
    info('(Simulação: nada foi gravado.)')
  }
  if (painelFalhou) {
    falha(simular ? 'O painel web não poderia ser ligado (veja acima).' : 'O plugin foi instalado, mas o painel web não está no ar (veja acima).')
    return 1
  }
  return 0
}

async function etapaPainel(o, { simular, portaNova, plano, registro, estado, marca, avisos }) {
  const resultado = { atalho: null, falhou: false }
  const servidor = SERVER_DEST

  // Sem web.json, ou com um web.json de uma primeira subida que não chegou a acontecer, o painel nunca rodou nesta
  // conta. Se a porta que ele usaria já responde ao /health, quem responde é outro painel (de outra conta ou
  // instalação): não o reaproveito nem mexo nele.
  let web = lerWeb()
  const jaExistiaWeb = existe(WEB_JSON)
  const nuncaSubiu = painelNuncaSubiu(web)
  const portaPrevista = nuncaSubiu && portaNova !== null ? portaNova : portaEHost(web).porta
  if (o.painel && nuncaSubiu && (await saude(portaPrevista, '0.0.0.0'))) {
    falha(`A porta ${portaPrevista} já está sendo usada por outro painel (talvez de outra conta do Windows ou de outra instalação), e não mexi nele.`)
    info(`Rode de novo com outra porta, por exemplo --porta ${portaPrevista + 1}.`)
    resultado.falhou = true
    return resultado
  }

  // --porta: vale enquanto o painel nunca subiu (sem web.json, ou web.json sem chave/links); depois disso é ignorada
  if (portaNova !== null) {
    if (!nuncaSubiu) {
      avisos.push(`O painel já subiu antes (porta ${portaEHost(web).porta}); a porta pedida (${portaNova}) foi ignorada. Para mudar, edite "port" em ${WEB_JSON} e reinicie o painel.`)
    } else if (!(jaExistiaWeb && web && web.port === portaNova)) {
      info(`${simular ? 'Gravaria' : 'Gravando'} a porta ${portaNova} em ${WEB_JSON}${jaExistiaWeb ? ' (o painel ainda não tinha subido; os outros campos ficam)' : ''}.`)
      if (!simular) gravar(WEB_JSON, JSON.stringify({ ...(web || {}), port: portaNova }, null, 2) + '\n')
      marca(`web.json ${jaExistiaWeb ? 'ajustado' : 'criado'} com a porta ${portaNova}`)
      web = { ...(web || {}), port: portaNova }
    }
  }
  if (!o.painel) return resultado

  const { porta, host } = portaEHost(web)

  // atalho de inicialização (Windows)
  if (IS_WIN) {
    const vbs = bytesVbs(textoVbs())
    const mudouLocal = !existe(VBS_LOCAL) || !fs.readFileSync(VBS_LOCAL).equals(vbs)
    if (mudouLocal) {
      info(`${simular ? 'Geraria' : 'Gerando'} ${VBS_LOCAL}`)
      if (!simular) gravar(VBS_LOCAL, vbs)
      marca(`script de inicialização do painel gerado em ${VBS_LOCAL}`)
    }
    const jaTem = existe(STARTUP_VBS)
    if (o['iniciar-com-windows'] || jaTem) {
      const igual = jaTem && fs.readFileSync(STARTUP_VBS).equals(vbs)
      if (!igual) {
        info(`${simular ? 'Poria' : 'Pondo'} o atalho na pasta Inicializar: ${STARTUP_VBS}`)
        if (!simular) {
          try {
            gravar(STARTUP_VBS, vbs)
          } catch (e) {
            avisos.push(`Não consegui gravar o atalho de inicialização (${e.message}).`)
          }
        }
        marca(`atalho de inicialização ${jaTem ? 'atualizado' : 'criado'} em ${STARTUP_VBS}`)
      } else ok('Atalho de inicialização já está em dia.')
      if (existe(STARTUP_VBS) || simular) resultado.atalho = STARTUP_VBS
    } else {
      info('O painel não vai subir sozinho quando o Windows iniciar (use --iniciar-com-windows para isso).')
    }
  } else if (o['iniciar-com-windows']) {
    avisos.push(`--iniciar-com-windows só funciona no Windows. Para subir o painel à mão: node "${servidor}" (para iniciar no login, use o systemd, o launchd ou um @reboot do cron).`)
  }

  if (!simular && !existe(servidor)) {
    falha(`Não achei ${servidor}.`)
    resultado.falhou = true
    return resultado
  }

  // ligar (ou religar) o painel
  const noAr = nuncaSubiu ? false : await saude(porta, host)
  const hashAlvo = hashArquivo(PKG_SERVER) // o que ficará instalado depois desta rodada
  const hashRodando = typeof registro.painelHash === 'string' ? registro.painelHash : null
  const motivoReiniciar = plano.servidorMudou ? 'o server.mjs mudou' : hashRodando && hashRodando !== hashAlvo ? 'o painel roda um server.mjs diferente do instalado' : null
  let religado = false
  if (noAr && motivoReiniciar) {
    const r = await pararParaReiniciar({ simular, porta, host, motivo: motivoReiniciar, marca, avisos })
    if (!r.parou) {
      if (r.alheio) {
        falha('O painel desta conta não está no ar: a porta está ocupada por outro programa.')
        resultado.falhou = true
      } else mostrarLinks(lerWeb(), porta)
      return resultado
    }
    religado = true
  } else if (noAr) {
    ok(`O painel já está no ar na porta ${porta}.`)
    mostrarLinks(web, porta)
    return resultado
  }

  if (simular) {
    if (!noAr) {
      info(`Subiria o painel (node ${servidor}) e esperaria o /health na porta ${porta}.`)
      marca(`painel ligado na porta ${porta}`)
    }
    return resultado
  }

  const s = await ligarPainel({ porta, host, estado, marca, religado })
  if (!s.subiu) {
    if (s.erro) falha(`Não consegui iniciar o Node: ${s.erro.message}`)
    else if (painelNuncaSubiu(lerWeb())) {
      falha(
        `O painel não respondeu em /health em 10 segundos. A porta ${porta} pode estar ocupada por outro programa. ` +
          `Como o painel ainda não chegou a subir, dá para escolher outra porta: rode de novo com --porta <n> (por exemplo ${porta + 1}).`,
      )
    } else {
      falha(`O painel não respondeu em /health em 10 segundos. A porta ${porta} pode estar ocupada por outro programa; para usar outra, edite "port" no ${WEB_JSON}.`)
    }
    resultado.falhou = true
    return resultado
  }
  // o servidor completa o web.json (token e links) logo ao subir
  for (let i = 0; i < 10; i++) {
    const w = lerWeb()
    if (w && Array.isArray(w.urls) && w.urls.length > 0) break
    await dormir(300)
  }
  mostrarLinks(lerWeb(), porta)
  avisos.push('Cada link contém a chave de acesso do painel: quem tiver o link vê a sala. Compartilhe só com quem deve ver.')
  avisos.push('Na primeira vez o Windows pode perguntar se o Node.js pode acessar a rede. Quem decide é você ("Redes privadas" basta para a rede local); este instalador não mexe no firewall.')
  return resultado
}

function validarComClaude() {
  const nome = IS_WIN ? 'claude.exe' : 'claude'
  const env = { ...process.env }
  if (TESTE) {
    env.USERPROFILE = HOME
    env.HOME = HOME
  }
  const r = spawnSync(nome, ['plugin', 'validate', PLUGIN_DEST], { encoding: 'utf8', timeout: 90000, windowsHide: true, env })
  if (r.error) {
    info(r.error.code === 'ENOENT' ? 'O comando claude não está no PATH; pulei a validação do plugin (é opcional).' : `Não consegui rodar o claude plugin validate (${r.error.message}); pulei.`)
    return
  }
  const ultima = `${r.stdout || ''}\n${r.stderr || ''}`.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop() || '(sem saída)'
  if (r.status === 0) ok(`claude plugin validate: ${ultima}`)
  else aviso(`claude plugin validate terminou com código ${r.status}: ${ultima}`)
}

// ───────────────────────── Desinstalar ─────────────────────────

/** Caminho relativo que não escapa da pasta do plugin. */
const relativoSeguro = (r) => typeof r === 'string' && r !== '' && !path.isAbsolute(r) && !r.split(/[\\/]/).includes('..')

/** Arquivos que o instalador põe na pasta do plugin: os do pacote e os do registro da última instalação. */
function arquivosDoInstalador(registro) {
  const conhecidos = new Set(ehPasta(PKG_PLUGIN) ? listarPacote() : [])
  if (Array.isArray(registro.arquivos)) for (const r of registro.arquivos) if (relativoSeguro(r)) conhecidos.add(r.replace(/\\/g, '/'))
  return conhecidos
}

/** true se algum diretório do caminho (dentro da pasta do plugin) é link: por ele não se apaga nada. */
function passaPorLink(rel) {
  const partes = rel.split('/').slice(0, -1)
  let atual = PLUGIN_DEST
  for (const p of partes) {
    atual = path.join(atual, p)
    if (linkDaPasta(atual)) return true
  }
  return false
}

// Gerado pelo Claude Code ao carregar o plugin (não é do pacote): sai junto, se for mesmo o que ele gera.
const GERADOS_DIR = '.claude-plugin/types'

function ehTsconfigGerado(arquivo) {
  try {
    return fs.readFileSync(arquivo, 'utf8').includes('.claude-plugin/types/tsconfig.json')
  } catch {
    return false
  }
}

/**
 * Tira da pasta do plugin só o que é do instalador (arquivos do pacote), o que o Claude Code gera nela
 * (.claude-plugin/types/ e o tsconfig.json que aponta para ele) e as pastas que ficarem vazias. O que sobrar fica.
 * Devolve { removidos, sobrou[], pastaRemovida }.
 */
function removerPlugin(registro, simular) {
  const conhecidos = arquivosDoInstalador(registro)
  const noDisco = listar(PLUGIN_DEST)
  const apagar = []
  for (const rel of noDisco) {
    if (conhecidos.has(rel) && !passaPorLink(rel)) apagar.push(rel)
  }
  const tsconfig = path.join(PLUGIN_DEST, 'tsconfig.json')
  const apagaTsconfig = existe(tsconfig) && ehTsconfigGerado(tsconfig)
  const typesDir = path.join(PLUGIN_DEST, GERADOS_DIR)
  const apagaTypes = existe(typesDir)

  const sobrou = noDisco.filter((rel) => {
    if (apagar.includes(rel)) return false
    if (rel === 'tsconfig.json' && apagaTsconfig) return false
    if (rel.startsWith(`${GERADOS_DIR}/`) && apagaTypes && !linkDaPasta(typesDir)) return false
    return true
  })

  if (!simular) {
    for (const rel of apagar) fs.unlinkSync(path.join(PLUGIN_DEST, rel))
    if (apagaTsconfig) fs.unlinkSync(tsconfig)
    if (apagaTypes) {
      if (linkDaPasta(typesDir)) fs.unlinkSync(typesDir)
      else fs.rmSync(typesDir, { recursive: true, force: true })
    }
    removerPastasVazias(PLUGIN_DEST, true)
    const mods = path.dirname(PLUGIN_DEST)
    if (ehPasta(mods) && !linkDaPasta(mods) && fs.readdirSync(mods).length === 0) fs.rmdirSync(mods)
  }
  return {
    removidos: apagar.length + (apagaTsconfig ? 1 : 0) + (apagaTypes ? 1 : 0),
    sobrou,
    pastaRemovida: sobrou.length === 0,
  }
}

async function desinstalar(o) {
  const simular = Boolean(o.simular)
  const mudancas = []
  const avisos = []
  titulo(simular ? 'Simulação da desinstalação: nada será apagado' : 'Desinstalando a Sala dos Agentes')
  if (TESTE) aviso(`MODO DE TESTE: pasta pessoal = ${HOME}`)

  // análise antes de apagar qualquer coisa
  const st = lerSettings()
  exigirSettingsValido(st, 'desinstalar')
  const registro = lerRegistro()
  const web = lerWeb()
  const { porta, host } = portaEHost(web)
  const alvoDoLink = linkDaPasta(PLUGIN_DEST)

  // 1. painel
  titulo('1. Painel web')
  const noAr = web ? await saude(porta, host) : false
  const pidGravado = lerPidGravado()
  const pidDoPainel = pidGravado && pidGravado !== process.pid && ehOPainelInstalado(pidGravado)
  if (noAr || pidDoPainel) {
    if (simular) {
      info(`O painel ${noAr ? `está no ar na porta ${porta}` : 'está rodando'}; seria encerrado (se for o da sala).`)
      mudancas.push('painel encerrado')
    } else {
      const r = await pararPainel(porta, host)
      if (r.parou) {
        ok(`Painel encerrado (porta ${porta}).`)
        mudancas.push('painel encerrado')
      } else avisos.push(`Não encerrei o painel: ${r.motivo}.`)
    }
  } else info(web ? `Nenhum painel respondendo na porta ${porta}.` : 'O painel nunca foi ligado nesta conta (não há web.json).')

  // 2. atalho de inicialização e script local
  titulo('2. Atalho de inicialização')
  const candidatos = new Set()
  if (STARTUP_VBS) candidatos.add(STARTUP_VBS)
  // O registro só vale se aponta para o atalho da pasta Inicializar atual: nunca apagamos um arquivo de outro lugar.
  if (typeof registro.atalhoInicializar === 'string' && registro.atalhoInicializar) {
    const reg = path.resolve(registro.atalhoInicializar)
    if (STARTUP_VBS && path.basename(reg) === 'sala-agentes-painel.vbs' && chaveCaminho(path.dirname(reg)) === chaveCaminho(path.dirname(STARTUP_VBS))) {
      candidatos.add(reg)
    } else {
      avisos.push(`O registro da instalação cita o atalho ${registro.atalhoInicializar}, que não está na pasta Inicializar deste computador; ignorei e não apaguei.`)
    }
  }
  let achouAtalho = false
  for (const f of [...candidatos, VBS_LOCAL]) {
    if (!existe(f)) continue
    achouAtalho = true
    info(`${simular ? 'Apagaria' : 'Apagando'} ${f}`)
    if (!simular) {
      try {
        fs.unlinkSync(f)
      } catch (e) {
        avisos.push(`Não consegui apagar ${f} (${e.message}).`)
        continue
      }
    }
    mudancas.push(`${simular ? 'apagaria' : 'apaguei'} ${f}`)
  }
  if (!achouAtalho) info('Nenhum atalho encontrado.')

  // 3. pasta do plugin
  titulo('3. Pasta do plugin')
  if (alvoDoLink) {
    info(`${PLUGIN_DEST} é um link para ${alvoDoLink}: ${simular ? 'tiraria' : 'tirando'} só o link; o conteúdo para onde ele aponta não é tocado.`)
    if (!simular) {
      try {
        fs.unlinkSync(PLUGIN_DEST)
      } catch {
        try {
          fs.rmdirSync(PLUGIN_DEST) // junção do Windows: rmdir tira a junção sem entrar nela
        } catch (e) {
          throw new Sair(1, `Não consegui tirar o link ${PLUGIN_DEST}: ${e.message}`)
        }
      }
    }
    mudancas.push(`${simular ? 'tiraria' : 'tirei'} o link ${PLUGIN_DEST} (o destino ficou intacto)`)
  } else if (ehPasta(PLUGIN_DEST)) {
    let r
    try {
      r = removerPlugin(registro, simular)
    } catch (e) {
      throw new Sair(1, `Não consegui apagar os arquivos do plugin em ${PLUGIN_DEST}: ${e.message}`, 'Feche o que estiver usando a pasta (o painel, por exemplo) e rode de novo.')
    }
    info(`${simular ? 'Apagaria' : 'Apagados'} ${r.removidos} arquivo(s)/pasta(s) do plugin em ${PLUGIN_DEST}.`)
    mudancas.push(`${simular ? 'apagaria' : 'apaguei'} os arquivos do plugin em ${PLUGIN_DEST} (${r.removidos})`)
    if (r.pastaRemovida) mudancas.push(`${simular ? 'apagaria' : 'apaguei'} a pasta ${PLUGIN_DEST}`)
    else {
      avisos.push(
        `A pasta ${PLUGIN_DEST} ficou, porque tem arquivos que não são do plugin: ${resumirLista(r.sobrou)}. ` +
          'O desinstalador não apaga o que não é dele; se quiser, o usuário pode apagar a pasta à mão.',
      )
    }
  } else info('O plugin não estava instalado nessa pasta.')

  // 4. settings.json
  titulo('4. settings.json')
  if (!st.existe) info('Sem settings.json para ajustar.')
  else {
    let ps = planejarRemocao(st, registro, simular)
    let copia = null
    if (ps.mudou && !simular) {
      try {
        // relê o arquivo antes de gravar: se alguém mexeu nele desde a leitura, refaz a remoção sobre o texto novo
        const r = gravarSettingsSeguro(st, (s) => planejarRemocao(s, registro, false), 'depois')
        ps = r.ps
        copia = r.copia
      } catch (e) {
        if (e instanceof Sair) throw e
        throw new Sair(1, `Não consegui gravar o settings.json: ${e.message}`)
      }
    }
    if (!ps.mudou) info('O settings.json não tinha a pasta do plugin.')
    else {
      for (const m of ps.mudancas) info(`${simular ? 'Faria' : 'Feito'}: ${m}`)
      for (const i of ps.infos) info(i)
      if (copia) info(`Cópia de segurança: ${copia}`)
      mudancas.push(...ps.mudancas)
    }
  }

  // 5. registro e PID do painel
  if (existe(PID_FILE)) {
    if (!simular) apagarPidGravado()
  }
  if (existe(INSTALL_JSON)) {
    if (!simular) {
      try {
        fs.unlinkSync(INSTALL_JSON)
      } catch {}
    }
    mudancas.push(`${simular ? 'apagaria' : 'apaguei'} o registro da instalação`)
  }
  if (!simular) {
    try {
      if (ehPasta(SALA_DIR) && !linkDaPasta(SALA_DIR) && fs.readdirSync(SALA_DIR).length === 0) fs.rmdirSync(SALA_DIR) // sobrou vazia
    } catch {}
  }

  titulo(simular ? 'Resumo da simulação' : 'Resumo')
  if (mudancas.length === 0) info('Não havia nada para desinstalar.')
  else {
    info(simular ? 'O que mudaria:' : 'O que mudou:')
    for (const m of mudancas) info(`  - ${m}`)
  }
  info('Ficaram: as equipes (sala-agentes.json), o web.json e os retratos em ~/.claude/sala-agentes.')
  for (const a of avisos) aviso(a)
  if (!simular) info('Chats já abertos só param de carregar o plugin quando forem fechados.')
  return 0
}

// ───────────────────────── Principal ─────────────────────────

async function main() {
  const o = lerArgumentos(process.argv.slice(2))
  if (o.ajuda) {
    console.log(AJUDA)
    return 0
  }
  if (Number.parseInt(process.versions.node, 10) < 18) {
    throw new Sair(1, `Este instalador precisa do Node 18 ou mais novo (aqui é ${process.versions.node}). Instale o Node em https://nodejs.org e rode de novo.`)
  }
  if (o.verificar && o.desinstalar) throw new Sair(1, 'Use --verificar ou --desinstalar, não os dois juntos.')
  if (o.onde !== undefined && o.onde !== 'conta' && o.onde !== 'projeto') throw new Sair(1, `--onde precisa ser "conta" ou "projeto" (recebi "${o.onde}").`)
  if (o['iniciar-com-windows'] && !o.painel && !o.verificar && !o.desinstalar) throw new Sair(1, '--iniciar-com-windows só vale junto com --painel.')
  if (o.verificar) return verificar(o)
  if (o.desinstalar) return desinstalar(o)
  return instalar(o)
}

main().then(
  (codigo) => {
    process.exitCode = codigo
  },
  (e) => {
    if (e instanceof Sair) {
      for (const l of e.linhas) falha(l)
      process.exitCode = e.codigo
    } else {
      falha(`Erro inesperado: ${e && e.stack ? e.stack : e}`)
      process.exitCode = 1
    }
  },
)
