import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { GitFile, GitStatus } from '@shared/types'
import { childEnv, run } from './exec'
import { assertAllowed } from './paths'
import { gitPath } from './tools'

async function git(cwd: string, args: string[], timeoutMs = 30000): Promise<string> {
  const r = await run(gitPath(), args, {
    cwd,
    timeoutMs,
    // Never block on an interactive credential prompt inside a GUI app.
    env: { ...childEnv(), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
  })
  if (r.timedOut) throw new Error(`git ${args[0]} timed out`)
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `git ${args[0]} failed (${r.code})`)
  return r.stdout
}

/** Parses `git status --porcelain=v1 -b -z`. */
export function parseStatus(out: string): Omit<GitStatus, 'isRepo'> {
  const parts = out.split('\0')
  const result: Omit<GitStatus, 'isRepo'> = { ahead: 0, behind: 0, files: [] }
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry) continue
    if (entry.startsWith('## ')) {
      const head = entry.slice(3)
      const m = head.match(/^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/)
      if (m) {
        result.branch = m[1] === 'HEAD (no branch)' ? 'detached' : m[1]
        result.upstream = m[2]
        const ahead = m[3]?.match(/ahead (\d+)/)
        const behind = m[3]?.match(/behind (\d+)/)
        result.ahead = ahead ? Number(ahead[1]) : 0
        result.behind = behind ? Number(behind[1]) : 0
      }
      continue
    }
    const index = entry[0]
    const work = entry[1]
    const path = entry.slice(3)
    const file: GitFile = { path, index, work }
    if (index === 'R' || index === 'C') {
      file.origPath = parts[++i]
    }
    result.files.push(file)
  }
  return result
}

export async function status(cwd: string): Promise<GitStatus> {
  const dir = assertAllowed(cwd)
  let root: string
  try {
    // git prints C:/forward/slashes on Windows; normalise to the native form.
    const top = (await git(dir, ['rev-parse', '--show-toplevel'], 10000)).trim()
    if (!top) return { isRepo: false, ahead: 0, behind: 0, files: [] }
    root = resolve(top)
  } catch {
    return { isRepo: false, ahead: 0, behind: 0, files: [] }
  }
  try {
    const out = await git(dir, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all'])
    return { isRepo: true, root, ...parseStatus(out) }
  } catch (err) {
    return { isRepo: true, root, ahead: 0, behind: 0, files: [], error: (err as Error).message }
  }
}

async function repoRoot(cwd: string): Promise<string> {
  const dir = assertAllowed(cwd)
  try {
    return (await git(dir, ['rev-parse', '--show-toplevel'], 10000)).trim() || dir
  } catch {
    return dir
  }
}

// Paths passed to stage/unstage/discard/fileAtHead are relative to the repo root,
// exactly as reported by status().
export async function stage(cwd: string, paths: string[]): Promise<void> {
  const dir = await repoRoot(cwd)
  await git(dir, paths.length ? ['add', '-A', '--', ...paths] : ['add', '-A'])
}

export async function unstage(cwd: string, paths: string[]): Promise<void> {
  const dir = await repoRoot(cwd)
  try {
    await git(dir, paths.length ? ['restore', '--staged', '--', ...paths] : ['restore', '--staged', '.'])
  } catch {
    // Repos without any commit yet have no HEAD to restore from.
    await git(dir, paths.length ? ['rm', '--cached', '-r', '-q', '--', ...paths] : ['rm', '--cached', '-r', '-q', '.'])
  }
}

export async function discard(cwd: string, paths: string[]): Promise<void> {
  const dir = await repoRoot(cwd)
  if (!paths.length) return
  const st = await status(dir)
  const untracked = paths.filter((p) => st.files.some((f) => f.path === p && f.index === '?'))
  const tracked = paths.filter((p) => !untracked.includes(p))
  if (tracked.length) await git(dir, ['checkout', '--', ...tracked])
  if (untracked.length) await git(dir, ['clean', '-f', '--', ...untracked])
}

export async function commit(cwd: string, message: string): Promise<string> {
  const dir = assertAllowed(cwd)
  if (!message.trim()) throw new Error('Commit message is empty')
  return git(dir, ['commit', '-m', message])
}

export async function push(cwd: string): Promise<string> {
  const dir = assertAllowed(cwd)
  const st = await status(dir)
  const args = st.upstream ? ['push'] : ['push', '-u', 'origin', st.branch ?? 'HEAD']
  const r = await run(gitPath(), args, { cwd: dir, timeoutMs: 120000, env: { ...childEnv(), GIT_TERMINAL_PROMPT: '0' } })
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || 'git push failed')
  return (r.stderr + r.stdout).trim()
}

export async function pull(cwd: string): Promise<string> {
  const dir = assertAllowed(cwd)
  const r = await run(gitPath(), ['pull', '--ff-only'], { cwd: dir, timeoutMs: 120000, env: { ...childEnv(), GIT_TERMINAL_PROMPT: '0' } })
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || 'git pull failed')
  return (r.stdout + r.stderr).trim()
}

/** Content of a file at HEAD, or null if the file is new / repo has no commits. */
export async function fileAtHead(cwd: string, relPath: string): Promise<string | null> {
  const dir = await repoRoot(cwd)
  try {
    return await git(dir, ['show', `HEAD:${relPath.replace(/\\/g, '/')}`])
  } catch {
    return null
  }
}

export async function init(cwd: string): Promise<void> {
  const dir = assertAllowed(cwd)
  if (existsSync(join(dir, '.git'))) return
  await git(dir, ['init'])
}
