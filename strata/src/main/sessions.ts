import { existsSync } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { HistoryItem, SessionSummary } from '@shared/types'

/** Where Claude Code keeps its per-project session transcripts. */
function projectsDir(): string {
  const config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(config, 'projects')
}

/** Claude Code names a project's transcript folder after its path with every non-alphanumeric char → '-'. */
export function encodeProjectPath(cwd: string): string {
  return resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-')
}

async function sessionDir(cwd: string): Promise<string | null> {
  const root = projectsDir()
  const enc = encodeProjectPath(cwd)
  const direct = join(root, enc)
  if (existsSync(direct)) return direct
  // Drive-letter case can differ on Windows ("C--" vs "c--"); very long paths are truncated.
  try {
    const dirs = await readdir(root)
    const lower = enc.toLowerCase()
    const hit = dirs.find((d) => d.toLowerCase() === lower) ?? (enc.length > 180 ? dirs.find((d) => lower.startsWith(d.toLowerCase().slice(0, 180))) : undefined)
    return hit ? join(root, hit) : null
  } catch {
    return null
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => (c?.type === 'text' ? c.text : '')).filter(Boolean).join('\n')
  return ''
}

function isNoise(text: string): boolean {
  const t = text.trimStart()
  return !t || t.startsWith('<command-') || t.startsWith('<local-command') || t.startsWith('Caveat:') || t.startsWith('<system-reminder>')
}

async function readHead(file: string, bytes: number): Promise<string> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}

export async function listSessions(cwd: string): Promise<SessionSummary[]> {
  const dir = await sessionDir(cwd)
  if (!dir) return []
  const files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'))
  const withTimes = await Promise.all(
    files.map(async (f) => {
      const st = await stat(join(dir, f)).catch(() => null)
      return { f, mtime: st?.mtimeMs ?? 0, size: st?.size ?? 0 }
    })
  )
  withTimes.sort((a, b) => b.mtime - a.mtime)
  const out: SessionSummary[] = []
  for (const { f, mtime, size } of withTimes.slice(0, 40)) {
    if (size === 0) continue
    let title = ''
    let aiTitle = ''
    let messages = 0
    try {
      const head = await readHead(join(dir, f), Math.min(size, 512 * 1024))
      for (const line of head.split('\n')) {
        if (!line) continue
        let j: any
        try {
          j = JSON.parse(line)
        } catch {
          continue
        }
        if (j.type === 'ai-title' && j.aiTitle) aiTitle = j.aiTitle
        if (j.type === 'summary' && j.summary && !aiTitle) aiTitle = j.summary
        if ((j.type === 'user' || j.type === 'assistant') && !j.isSidechain && !j.isMeta) {
          const t = textOf(j.message?.content)
          if (t && !isNoise(t)) {
            messages++
            if (!title && j.type === 'user') title = t
          }
        }
      }
    } catch {
      continue
    }
    if (!title && !aiTitle) continue
    out.push({ id: f.replace(/\.jsonl$/, ''), title: (aiTitle || title).replace(/\s+/g, ' ').slice(0, 120), updatedAt: mtime, messages })
  }
  return out
}

/** Rebuilds a readable chat transcript from a stored session (for "continue session"). */
export async function loadHistory(cwd: string, sessionId: string): Promise<HistoryItem[]> {
  if (!/^[0-9a-zA-Z-]+$/.test(sessionId)) return []
  const dir = await sessionDir(cwd)
  if (!dir) return []
  const file = join(dir, `${sessionId}.jsonl`)
  if (!existsSync(file)) return []
  const st = await stat(file)
  const raw = st.size > 30 * 1024 * 1024 ? '' : await readFile(file, 'utf8')
  const items: HistoryItem[] = []
  const tools = new Map<string, Extract<HistoryItem, { type: 'tool' }>>()
  for (const line of raw.split('\n')) {
    if (!line) continue
    let j: any
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (j.isSidechain || j.isMeta || (j.type !== 'user' && j.type !== 'assistant')) continue
    const content = j.message?.content
    if (j.type === 'user') {
      if (typeof content === 'string') {
        if (!isNoise(content)) items.push({ type: 'user', text: content, ts: Date.parse(j.timestamp) || undefined })
        continue
      }
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type === 'tool_result') {
          const tool = tools.get(block.tool_use_id)
          if (tool) {
            const text = textOf(block.content) || (typeof block.content === 'string' ? block.content : '')
            tool.result = text.slice(0, 4000)
            tool.isError = !!block.is_error
          }
        } else if (block.type === 'text' && !isNoise(block.text)) {
          items.push({ type: 'user', text: block.text, ts: Date.parse(j.timestamp) || undefined })
        }
      }
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text?.trim()) items.push({ type: 'assistant', text: block.text })
        else if (block.type === 'tool_use') {
          const item: Extract<HistoryItem, { type: 'tool' }> = { type: 'tool', id: block.id, name: block.name, input: block.input ?? {} }
          tools.set(block.id, item)
          items.push(item)
        }
      }
    }
  }
  return items.slice(-600)
}
