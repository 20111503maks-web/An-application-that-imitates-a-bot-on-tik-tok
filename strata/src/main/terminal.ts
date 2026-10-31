import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { IPty } from 'node-pty'
import type { TerminalCreateOptions, TerminalInfo } from '@shared/types'
import { childEnv } from './exec'
import { assertAllowed } from './paths'
import { defaultShell } from './tools'

type PtyModule = typeof import('node-pty')
let ptyModule: PtyModule | null = null
let ptyLoadError: string | null = null

function loadPty(): PtyModule {
  if (ptyModule) return ptyModule
  if (ptyLoadError) throw new Error(ptyLoadError)
  try {
    // Loaded lazily so a broken native module can never prevent the app from starting.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ptyModule = require('node-pty') as PtyModule
    return ptyModule
  } catch (err) {
    ptyLoadError = `Terminal backend failed to load: ${(err as Error).message}`
    throw new Error(ptyLoadError)
  }
}

interface Session {
  pty: IPty
  projectId: string
  buffer: string
  timer: NodeJS.Timeout | null
}

const sessions = new Map<string, Session>()

type DataSink = (id: string, data: string) => void
type ExitSink = (id: string, code: number) => void

let onData: DataSink = () => {}
let onExit: ExitSink = () => {}

export function setTerminalSinks(data: DataSink, exit: ExitSink): void {
  onData = data
  onExit = exit
}

function shellArgs(shell: string): string[] {
  const name = basename(shell).toLowerCase()
  if (name.startsWith('powershell') || name.startsWith('pwsh')) return ['-NoLogo']
  if (name === 'bash.exe' || name === 'bash' || name === 'zsh') return ['-l']
  return []
}

export function createTerminal(opts: TerminalCreateOptions): TerminalInfo {
  const pty = loadPty()
  const cwd = assertAllowed(opts.cwd)
  const shell = opts.shell || defaultShell()
  const env = { ...childEnv(), TERM_PROGRAM: 'Strata', COLORTERM: 'truecolor' } as Record<string, string>
  const proc = pty.spawn(shell, shellArgs(shell), {
    name: 'xterm-256color',
    cols: Math.max(10, opts.cols | 0),
    rows: Math.max(4, opts.rows | 0),
    cwd,
    env,
    useConpty: process.platform === 'win32' ? true : undefined
  })
  const id = randomUUID()
  const session: Session = { pty: proc, projectId: opts.projectId, buffer: '', timer: null }
  sessions.set(id, session)

  // Coalesce output into ~16ms batches: far fewer IPC messages for noisy commands.
  proc.onData((data) => {
    session.buffer += data
    if (session.timer) return
    session.timer = setTimeout(() => {
      session.timer = null
      const chunk = session.buffer
      session.buffer = ''
      if (chunk) onData(id, chunk)
    }, 16)
  })
  proc.onExit(({ exitCode }) => {
    if (session.buffer) onData(id, session.buffer)
    session.buffer = ''
    sessions.delete(id)
    onExit(id, exitCode)
  })

  if (opts.command) {
    const eol = process.platform === 'win32' ? '\r' : '\n'
    setTimeout(() => sessions.has(id) && proc.write(opts.command + eol), 400)
  }
  return { id, shell, title: basename(shell).replace(/\.exe$/i, '') }
}

export function writeTerminal(id: string, data: string): void {
  sessions.get(id)?.pty.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const s = sessions.get(id)
  if (!s) return
  try {
    s.pty.resize(Math.max(10, cols | 0), Math.max(4, rows | 0))
  } catch {
    /* pty already closed */
  }
}

export function killTerminal(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  try {
    s.pty.kill()
  } catch {
    /* ignore */
  }
  sessions.delete(id)
}

export function killAllTerminals(): void {
  for (const id of [...sessions.keys()]) killTerminal(id)
}
