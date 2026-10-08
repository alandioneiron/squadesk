// Publica plugin/ na pasta instalada (~/.claude/mods/sala-agentes), que todo chat do Claude Code
// carrega pelo CLAUDE_CODE_PLUGIN_DIRS e recarrega sozinho ao mudar.
//
//   node scripts/publicar.mjs            valida, testa, confere a cópia instalada e publica
//   node scripts/publicar.mjs --force    publica mesmo se alguém editou a cópia instalada
//   node scripts/publicar.mjs --sem-teste
//
// A fonte é ESTE repositório: nunca editar a cópia instalada direto (os chats recarregam a cada
// arquivo salvo, e uma edição pela metade quebra a sala em todos eles).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugin')
const DEST = process.env.SALA_DEST ?? join(homedir(), '.claude', 'mods', 'sala-agentes')
const MANIFEST = join(DEST, '.publicado.json')
const args = new Set(process.argv.slice(2))
// Gerados pelo Claude Code ao carregar o plugin, ou locais de cada máquina.
const SKIP = [/^\.claude-plugin[\\/]types([\\/]|$)/, /^node_modules([\\/]|$)/, /^tsconfig\.json$/, /^\.publicado\.json$/]

function walk(root) {
  const out = []
  const visit = dir => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const rel = relative(root, full)
      if (SKIP.some(re => re.test(rel))) continue
      if (statSync(full).isDirectory()) visit(full)
      else out.push(rel)
    }
  }
  if (existsSync(root)) visit(root)
  return out.sort()
}

const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const version = JSON.parse(readFileSync(join(SRC, '.claude-plugin', 'plugin.json'), 'utf8')).version

// 1. Valida e testa a fonte (o mesmo que o Claude Code fará ao carregar).
if (!args.has('--sem-teste')) {
  for (const cmd of [['plugin', 'validate', SRC], ['plugin', 'test', SRC]]) {
    console.log(`> claude ${cmd.slice(0, 2).join(' ')}`)
    try {
      execFileSync(process.platform === 'win32' ? 'claude.exe' : 'claude', cmd, { stdio: 'inherit' })
    } catch {
      console.error('\nFalhou: nada foi publicado.')
      process.exit(1)
    }
  }
}

// 2. Alguém editou a cópia instalada depois da última publicação? Então não sobrescreve sem --force.
if (existsSync(MANIFEST) && !args.has('--force')) {
  const before = JSON.parse(readFileSync(MANIFEST, 'utf8')).files ?? {}
  const touched = Object.entries(before).filter(([rel, h]) => {
    const file = join(DEST, rel)
    return existsSync(file) && hash(file) !== h
  })
  if (touched.length > 0) {
    console.error('A cópia instalada foi editada fora deste repositório:')
    for (const [rel] of touched) console.error(`  - ${rel}`)
    console.error('Traga essas mudanças para plugin/ (diff abaixo) e publique de novo, ou use --force para descartá-las.')
    for (const [rel] of touched) console.error(`  diff "${join(DEST, rel)}" "${join(SRC, rel)}"`)
    process.exit(2)
  }
}

// 3. Copia tudo de uma vez (os chats recarregam quando a pasta fica quieta).
const files = walk(SRC)
const record = {}
const changed = []
for (const rel of files) {
  const from = join(SRC, rel)
  const to = join(DEST, rel)
  const data = readFileSync(from)
  record[rel] = createHash('sha256').update(data).digest('hex')
  if (existsSync(to) && hash(to) === record[rel]) continue
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, data)
  changed.push(rel)
}
writeFileSync(MANIFEST, JSON.stringify({ version, at: new Date().toISOString(), files: record }, null, 1))

console.log(`\nPublicado v${version} em ${DEST}: ${changed.length} arquivo(s) alterado(s).`)
for (const rel of changed) console.log(`  ~ ${rel}`)
console.log('Os chats abertos recarregam a sala em alguns segundos.')
if (changed.some(rel => rel.startsWith('web'))) {
  console.log('O painel web mudou: reinicie o servidor (encerre o node do server.mjs e rode o start-painel.vbs).')
}
