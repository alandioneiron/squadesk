// Gera o pacote da skill portátil "sala-agentes" (dist/sala-agentes.skill).
//
//   node scripts/gerar-skill.mjs            copia o plugin para a skill e empacota
//   node scripts/gerar-skill.mjs --so-assets  só copia o plugin para skill/sala-agentes/assets/plugin
//
// 1. Apaga e recria skill/sala-agentes/assets/plugin/ e copia para lá o plugin (sem tests/ nem web/sample/).
// 2. Empacota com o package_skill.py do skill-creator (pasta em SKILL_CREATOR_DIR, ou achada no APPDATA do Claude).
//    Sem o empacotador, gera o zip com o zipfile do Python (raiz do zip = sala-agentes/, sem a pasta evals/).
// 3. Mostra o caminho e o tamanho do .skill e a versão do plugin empacotada.
//
// A fonte do plugin é plugin/ deste repositório; a pasta assets/plugin é gerada e não vai para o git.
// O filtro do que entra no pacote (manifesto + hooks/ + types/ + web/ menos web/sample/) também existe em
// skill/sala-agentes/scripts/instalar.mjs (listarPacote), para instalar direto de um clone: mude os dois juntos.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN = path.join(RAIZ, 'plugin')
const SKILL = path.join(RAIZ, 'skill', 'sala-agentes')
const ASSETS = path.join(SKILL, 'assets', 'plugin')
const DIST = path.join(RAIZ, 'dist')
const SO_ASSETS = process.argv.includes('--so-assets')

function parar(msg) {
  console.error(`Erro: ${msg}`)
  process.exit(1)
}

// ───────────── 1. Copiar o plugin para os assets da skill ─────────────

function copiarArquivo(rel) {
  const origem = path.join(PLUGIN, rel)
  if (!fs.existsSync(origem)) parar(`não achei ${origem}`)
  const destino = path.join(ASSETS, rel)
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  fs.copyFileSync(origem, destino)
}

/** Copia todos os arquivos de plugin/<rel>, menos as subpastas listadas em `pular` (relativas a essa pasta). */
function copiarPasta(rel, pular = []) {
  const origem = path.join(PLUGIN, rel)
  if (!fs.existsSync(origem)) parar(`não achei a pasta ${origem}`)
  const visita = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (pular.includes(path.relative(origem, completo).split(path.sep).join('/'))) continue
        visita(completo)
      } else if (e.isFile()) copiarArquivo(path.relative(PLUGIN, completo))
    }
  }
  visita(origem)
}

fs.rmSync(ASSETS, { recursive: true, force: true })
fs.mkdirSync(ASSETS, { recursive: true })
copiarArquivo(path.join('.claude-plugin', 'plugin.json'))
copiarPasta('hooks')
copiarPasta('types')
copiarPasta('web', ['sample']) // tudo do painel, menos os retratos de exemplo: um arquivo novo do painel não some do pacote

const versao = JSON.parse(fs.readFileSync(path.join(ASSETS, '.claude-plugin', 'plugin.json'), 'utf8')).version
const total = (function contar(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? contar(path.join(dir, e.name)) : 1), 0)
})(ASSETS)
console.log(`Plugin ${versao}: ${total} arquivo(s) copiado(s) para ${path.relative(RAIZ, ASSETS)}`)

if (SO_ASSETS) process.exit(0)

// Um .skill velho nunca pode passar por novo: apaga antes de qualquer coisa que possa falhar.
fs.rmSync(path.join(DIST, 'sala-agentes.skill'), { force: true })

if (!fs.existsSync(path.join(SKILL, 'SKILL.md'))) parar(`falta o ${path.join(SKILL, 'SKILL.md')}; sem ele não dá para empacotar (use --so-assets para só copiar o plugin).`)

// ───────────── 2. Empacotar ─────────────

function acharPython() {
  for (const nome of [process.env.PYTHON, 'python', 'python3', 'py']) {
    if (!nome) continue
    const r = spawnSync(nome, ['--version'], { encoding: 'utf8', windowsHide: true })
    if (!r.error && r.status === 0) return nome
  }
  return null
}

/** Procura skills/skill-creator (com scripts/package_skill.py) dentro dos dados do Claude, até 6 níveis. */
function acharSkillCreator() {
  const dado = process.env.SKILL_CREATOR_DIR
  if (dado) {
    if (fs.existsSync(path.join(dado, 'scripts', 'package_skill.py'))) return dado
    console.warn(`Aviso: SKILL_CREATOR_DIR (${dado}) não tem scripts/package_skill.py; procurando em outros lugares.`)
  }
  const bases = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'Claude', 'local-agent-mode-sessions', 'skills-plugin'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions', 'skills-plugin'),
    path.join(os.homedir(), '.config', 'Claude', 'local-agent-mode-sessions', 'skills-plugin'),
  ].filter(Boolean)
  const achados = []
  const visita = (dir, nivel) => {
    if (nivel > 6) return
    let itens
    try {
      itens = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of itens) {
      if (!e.isDirectory()) continue
      const completo = path.join(dir, e.name)
      if (e.name === 'skill-creator' && fs.existsSync(path.join(completo, 'scripts', 'package_skill.py'))) achados.push(completo)
      else visita(completo, nivel + 1)
    }
  }
  for (const b of bases) visita(b, 0)
  achados.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return achados[0] || null
}

/**
 * Confere o SKILL.md com as mesmas regras do quick_validate.py do skill-creator (sem precisar de PyYAML):
 * frontmatter com name (kebab-case, até 64) e description (sem < >, até 1024), só chaves permitidas, um único SKILL.md.
 */
function validarSkillMd() {
  const arquivo = path.join(SKILL, 'SKILL.md')
  const texto = fs.readFileSync(arquivo, 'utf8').replace(/\r\n/g, '\n')
  const m = /^---\n([\s\S]*?)\n---/.exec(texto)
  if (!m) return 'o SKILL.md precisa começar com um frontmatter entre linhas "---"'
  const campos = {}
  let chave = null
  for (const linha of m[1].split('\n')) {
    const k = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(linha)
    if (k) {
      chave = k[1]
      campos[chave] = k[2].replace(/^["']|["']$/g, '')
    } else if (chave && /^\s+\S/.test(linha)) campos[chave] = `${campos[chave]} ${linha.trim()}`.trim()
  }
  const permitidas = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata', 'compatibility'])
  const extras = Object.keys(campos).filter((c) => !permitidas.has(c))
  if (extras.length > 0) return `chave(s) não permitida(s) no frontmatter: ${extras.join(', ')}`
  const { name, description } = campos
  if (!name) return "falta 'name' no frontmatter"
  if (!description || /^[>|][+-]?$/.test(description)) return "falta 'description' no frontmatter"
  if (!/^[a-z0-9-]+$/.test(name) || name.startsWith('-') || name.endsWith('-') || name.includes('--')) return `name "${name}" precisa ser kebab-case`
  if (name.length > 64) return `name com ${name.length} caracteres (máximo 64)`
  if (name !== path.basename(SKILL)) return `name "${name}" é diferente do nome da pasta "${path.basename(SKILL)}"`
  if (/[<>]/.test(description)) return 'a description não pode ter < nem >'
  if (description.length > 1024) return `description com ${description.length} caracteres (máximo 1024)`
  if (campos.compatibility && campos.compatibility.length > 500) return `compatibility com ${campos.compatibility.length} caracteres (máximo 500)`
  const outros = []
  const visita = (dir, nivel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '__pycache__' || (nivel === 0 && e.name === 'evals')) continue
        visita(path.join(dir, e.name), nivel + 1)
      } else if (e.name === 'SKILL.md' && nivel > 0) outros.push(path.relative(SKILL, path.join(dir, e.name)))
    }
  }
  visita(SKILL, 0)
  if (outros.length > 0) return `só pode haver um SKILL.md; achei também: ${outros.join(', ')}`
  return null
}

const python = acharPython()
if (!python) parar('não achei o Python (python, python3 ou py) no PATH; ele é necessário para empacotar.')

fs.mkdirSync(DIST, { recursive: true })
const saida = path.join(DIST, 'sala-agentes.skill')
const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } // o empacotador imprime emojis
const criador = acharSkillCreator()
let usouZip = !criador

if (criador) {
  console.log(`Empacotando com o skill-creator: ${criador}`)
  const r = spawnSync(python, ['-m', 'scripts.package_skill', SKILL, DIST], { cwd: criador, encoding: 'utf8', windowsHide: true, env })
  const texto = `${r.stdout || ''}${r.stderr || ''}`.trim()
  if (!r.error && r.status === 0) {
    console.log(texto.split(/\r?\n/).filter(Boolean).slice(-3).join('\n'))
  } else if (/ModuleNotFoundError|ImportError/.test(texto)) {
    // Falta uma biblioteca do Python (o quick_validate usa PyYAML): problema do ambiente, não da skill.
    const faltando = /No module named '([^']+)'/.exec(texto)
    const pacotePip = faltando ? (faltando[1] === 'yaml' ? 'pyyaml' : faltando[1]) : ''
    console.warn(`Aviso: o empacotador do skill-creator não rodou (falta o módulo Python ${faltando ? `"${faltando[1]}"` : 'necessário'}${pacotePip ? `; para usá-lo: pip install ${pacotePip}` : ''}).`)
    console.warn('Seguindo com o zip do Python, depois de conferir o SKILL.md com as mesmas regras do quick_validate.')
    usouZip = true
  } else {
    parar(`o empacotador falhou${r.error ? ` (${r.error.message})` : ''}:\n${texto}`)
  }
} else {
  console.log('skill-creator não encontrado (defina SKILL_CREATOR_DIR); empacotando com o zipfile do Python.')
}

if (usouZip) {
  const problema = validarSkillMd()
  if (problema) parar(`SKILL.md inválido: ${problema}`)
  const codigo = `
import fnmatch, sys, zipfile
from pathlib import Path
skill = Path(sys.argv[1]).resolve()
saida = Path(sys.argv[2]).resolve()
saida.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(saida, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(skill.rglob('*')):
        if not f.is_file():
            continue
        rel = f.relative_to(skill.parent)
        partes = rel.parts
        if any(p in ('__pycache__', 'node_modules') for p in partes): continue
        if len(partes) > 1 and partes[1] == 'evals': continue
        if f.name == '.DS_Store' or fnmatch.fnmatch(f.name, '*.pyc'): continue
        z.write(f, rel.as_posix())
`
  const r = spawnSync(python, ['-I', '-c', codigo, SKILL, saida], { encoding: 'utf8', windowsHide: true, env })
  if (r.error || r.status !== 0) parar(`o zip falhou: ${r.error ? r.error.message : r.stderr}`)
}

// ───────────── 3. Resultado ─────────────

if (!fs.existsSync(saida)) parar(`o empacotador terminou, mas ${saida} não existe.`)
const kb = (fs.statSync(saida).size / 1024).toFixed(1)
console.log(`\nPacote: ${saida}`)
console.log(`Tamanho: ${kb} KB`)
console.log(`Versão do plugin empacotada: ${versao}`)
