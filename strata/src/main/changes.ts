import { shell } from 'electron'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { PendingChange } from '@shared/types'
import { isInside, normalizeForCompare } from './paths'

const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024

export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

interface Tracked {
  path: string
  original: string | null
  createdAt: number
  /** True once the tool call finished; only then may a no-op entry be pruned. */
  settled: boolean
}

function readIfText(path: string): string | null {
  try {
    if (!existsSync(path)) return null
    if (statSync(path).size > MAX_SNAPSHOT_BYTES) return null
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Counts added/removed lines with a multiset comparison (fast, good enough for badges). */
export function lineStats(before: string | null, after: string | null): { additions: number; deletions: number } {
  const a = before === null ? [] : before.split(/\r?\n/)
  const b = after === null ? [] : after.split(/\r?\n/)
  const counts = new Map<string, number>()
  for (const l of a) counts.set(l, (counts.get(l) ?? 0) + 1)
  let additions = 0
  for (const l of b) {
    const c = counts.get(l) ?? 0
    if (c > 0) counts.set(l, c - 1)
    else additions++
  }
  let deletions = 0
  for (const c of counts.values()) deletions += c
  return { additions, deletions }
}

/**
 * Remembers the original content of every file Claude edits, so the user can
 * review a diff and Accept (keep) or Reject (restore) each change.
 */
export class ChangeTracker {
  private files = new Map<string, Tracked>()

  constructor(private root: string) {}

  /**
   * Called when Claude announces an edit tool call. Usually runs before the
   * tool executes; for Edit/MultiEdit we can also undo a late snapshot by
   * reversing the replacement, since the tool input carries old/new strings.
   */
  snapshot(toolName: string, input: Record<string, unknown>): string | null {
    const raw = (input.file_path ?? input.notebook_path ?? input.path) as string | undefined
    if (!raw || typeof raw !== 'string') return null
    const path = resolve(this.root, raw)
    if (!isInside(this.root, path)) return null
    const key = normalizeForCompare(path)
    if (this.files.has(key)) return path

    const existed = existsSync(path)
    let original = readIfText(path)
    // Binary or huge file we could not snapshot: never claim we can restore it.
    if (existed && original === null) return null
    if (original !== null && toolName === 'Edit') {
      const oldS = input.old_string as string | undefined
      const newS = input.new_string as string | undefined
      if (typeof oldS === 'string' && typeof newS === 'string' && newS && !original.includes(oldS) && original.includes(newS)) {
        original = input.replace_all ? original.split(newS).join(oldS) : original.replace(newS, oldS)
      }
    }
    if (original !== null && toolName === 'MultiEdit' && Array.isArray(input.edits)) {
      const edits = input.edits as { old_string?: string; new_string?: string }[]
      const applied = edits.every((e) => e.new_string && original!.includes(e.new_string) && !original!.includes(e.old_string ?? '\0'))
      if (applied) for (const e of [...edits].reverse()) original = original!.replace(e.new_string!, e.old_string ?? '')
    }
    this.files.set(key, { path, original, createdAt: Date.now(), settled: false })
    return path
  }

  settle(path: string): void {
    const t = this.files.get(normalizeForCompare(path))
    if (t) t.settled = true
  }

  has(path: string): boolean {
    return this.files.has(normalizeForCompare(path))
  }

  list(): PendingChange[] {
    const out: PendingChange[] = []
    for (const [key, t] of this.files) {
      const exists = existsSync(t.path)
      const current = exists ? readIfText(t.path) : null
      // The edit was a no-op, failed, or a created file was removed again.
      if ((exists && current === t.original) || (!exists && t.original === null)) {
        if (t.settled) this.files.delete(key)
        continue
      }
      const stats = lineStats(t.original, current)
      out.push({
        path: t.path,
        original: t.original,
        createdAt: t.createdAt,
        additions: stats.additions,
        deletions: stats.deletions,
        deleted: !exists
      })
    }
    return out.sort((a, b) => a.createdAt - b.createdAt)
  }

  private select(paths?: string[]): [string, Tracked][] {
    if (!paths || !paths.length) return [...this.files]
    const keys = new Set(paths.map(normalizeForCompare))
    return [...this.files].filter(([k]) => keys.has(k))
  }

  accept(paths?: string[]): void {
    for (const [key] of this.select(paths)) this.files.delete(key)
  }

  async reject(paths?: string[]): Promise<void> {
    for (const [key, t] of this.select(paths)) {
      if (t.original === null) {
        if (existsSync(t.path)) await shell.trashItem(t.path).catch(() => undefined)
      } else {
        await mkdir(dirname(t.path), { recursive: true })
        await writeFile(t.path, t.original, 'utf8')
      }
      this.files.delete(key)
    }
  }
}
