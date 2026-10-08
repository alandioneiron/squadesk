export type Activity =
  | 'livre'
  | 'ocioso'
  | 'pensando'
  | 'lendo'
  | 'editando'
  | 'comando'
  | 'delegando'
  | 'aprovacao'
  | 'concluido'

/** Um papel da equipe, lido do sala-agentes.json (ou o padrão). */
export type Role = {
  id: string
  name: string
  /** Opus, Sonnet, Haiku, Fable ou '' (qualquer). */
  model: string
  /** Começos de palavra que puxam uma tarefa para este papel. */
  keywords: string[]
  /** Outros nomes que, citados na tarefa, mandam para este papel. */
  aliases: string[]
}

export type Team = {
  lead: { name: string; model: string }
  roles: Role[]
  /** De onde veio: caminho do arquivo ou 'padrão'. */
  source: string
  /** Problema no arquivo (a equipe padrão foi usada no lugar). */
  warning: string
  /** Guia da sala no começo de cada conversa ("orientar": false no arquivo desliga). */
  guide: boolean
}

/** Um passo do histórico de um agente: o que fez e com o quê. */
export type TrailItem = { op: string; what: string }

/** Um agente na sala: o Tech Lead (id 'lead') ou um subagente. */
export type AgentRow = {
  id: string
  /** Id do papel, ou 'lead'; 'tmp-…' para papel temporário. */
  role: string
  /** Nome do papel quando o agente chegou (se o papel sair da equipe, o nome fica). */
  roleName: string
  model: string
  activity: Activity
  /** O que está tocando agora (arquivo, comando, busca). */
  detail: string
  /** A tarefa recebida. */
  task: string
  /** tool_use_id da chamada que definiu o estado atual. */
  call: string
  since: number
  born: number
  /** -1: a mesa do papel; 0, 1, 2...: mesa extra. */
  desk: number
  /** Quem delegou (id do agente), '' para o Tech Lead. */
  parent: string
  /** Tokens gastos (entrada nova + gravação de cache + saída), somados ao fim de cada turno. Ausente em linhas antigas. */
  tokens?: number
  /** Início da tarefa atual (ms). Ausente em linhas antigas. */
  taskStart?: number
  /** Arquivos e comandos tocados na tarefa, mais recente por último. Ausente em linhas antigas. */
  trail?: TrailItem[]
}

export type LogLine = { at: number; text: string }

export type DayRole = { role: string; tasks: number; ms: number; tokens: number }

/** Resumo do dia deste chat; zera quando a data muda. */
export type Daily = { date: string; roles: DayRole[] }

/** Resumo de outro chat, lido do retrato que ele grava. */
export type OtherChat = {
  id: string
  /** Título do chat (o da barra lateral do app); '' se ainda não houver. */
  title: string
  project: string
  busy: number
  waiting: number
  lead: string
  tokens: number
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'sala-agentes': {
      agents: Record<string, AgentRow>
      log: LogLine[]
      team: Team
      /** Versão do plugin.json da cópia que esta sessão carregou. */
      version: string
      daily: Daily
      others: OtherChat[]
      /** Links do painel na rede, lidos do web.json do servidor. */
      web: string[]
      /** Relógio dos cronômetros da lista (atualiza a cada 15 s). */
      tick: number
      /** A equipe já foi lida uma vez nesta sessão (mudanças depois disso avisam o Tech Lead). */
      teamSeen: boolean
    }
  }
}
