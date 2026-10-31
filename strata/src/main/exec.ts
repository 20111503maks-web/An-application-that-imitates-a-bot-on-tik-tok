import spawn from 'cross-spawn'
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const isWin = process.platform === 'win32'

/** Extra folders where CLIs usually live but which GUI apps may not have on PATH. */
function extraPathDirs(): string[] {
  const home = homedir()
  if (isWin) {
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    return [
      join(home, '.local', 'bin'),
      join(appData, 'npm'),
      join(home, '.claude', 'local'),
      join(home, '.aftman', 'bin'),
      join(home, '.rokit', 'bin'),
      join(home, '.foreman', 'bin'),
      join(local, 'Programs', 'Git', 'cmd'),
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files\\nodejs'
    ]
  }
  return [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    join(home, '.aftman', 'bin'),
    join(home, '.rokit', 'bin'),
    join(home, '.foreman', 'bin'),
    join(home, '.cargo', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin'
  ]
}

let cachedEnv: NodeJS.ProcessEnv | null = null

/** process.env with a PATH that also includes the usual CLI install folders. */
export function childEnv(): NodeJS.ProcessEnv {
  if (cachedEnv) return cachedEnv
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  const parts = (env[key] ?? '').split(delimiter).filter(Boolean)
  for (const d of extraPathDirs()) if (!parts.includes(d) && existsSync(d)) parts.push(d)
  env[key] = parts.join(delimiter)
  cachedEnv = env
  return env
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/** Resolves a command name against PATH (+ PATHEXT on Windows) without spawning a shell. */
export function findOnPath(cmd: string): string | null {
  const env = childEnv()
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
  const dirs = (env[key] ?? '').split(delimiter).filter(Boolean)
  const exts = isWin ? ['.exe', '.cmd', '.bat', '.com', ''] : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = join(dir.replace(/^"|"$/g, ''), cmd + ext)
      if (isFile(full)) return full
    }
  }
  return null
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** Runs a command to completion (handles .cmd shims on Windows via cross-spawn). */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; input?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    let child: ChildProcess
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env ?? childEnv(),
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      resolvePromise({ code: -1, stdout: '', stderr: String(err), timedOut: false })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let done = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, opts.timeoutMs ?? 30000)
    child.stdout?.on('data', (d) => (stdout += d))
    child.stderr?.on('data', (d) => (stderr += d))
    const finish = (code: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr, timedOut })
    }
    child.on('error', (err) => {
      stderr += String(err)
      finish(-1)
    })
    child.on('close', (code) => finish(code))
    if (opts.input !== undefined) child.stdin?.end(opts.input)
    else child.stdin?.end()
  })
}

/** Kills a process and all of its children (cmd.exe shims spawn grandchildren on Windows). */
export function killTree(child: ChildProcess | null | undefined): void {
  if (!child || child.exitCode !== null || child.killed) return
  if (isWin && child.pid) {
    try {
      nodeSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      return
    } catch {
      /* fall through */
    }
  }
  try {
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, 1500).unref()
  } catch {
    /* already gone */
  }
}

/** Starts a GUI application detached from Strata (Blender, Roblox Studio, ...). */
export function launchDetached(file: string, args: string[], cwd?: string): void {
  const opts: SpawnOptions = { cwd, detached: true, stdio: 'ignore', windowsHide: false, env: childEnv() }
  const child = nodeSpawn(file, args, opts)
  child.on('error', (err) => console.error('[launch]', file, err))
  child.unref()
}

export { spawn as crossSpawn }
