import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClaudeAuth, ToolId, ToolInfo, ToolsReport } from '@shared/types'
import { findOnPath, run } from './exec'
import { getSettings } from './settings'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const home = homedir()
const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'

const first = (...paths: (string | null | undefined)[]): string | null => {
  for (const p of paths) if (p && existsSync(p)) return p
  return null
}

function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name))
  } catch {
    return []
  }
}

const mtime = (p: string): number => {
  try {
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}

/** Natural version sort: "Blender 4.10" > "Blender 4.2". */
function versionKey(p: string): number[] {
  return (p.match(/\d+/g) ?? []).map(Number)
}
function compareVersionsDesc(a: string, b: string): number {
  const va = versionKey(a)
  const vb = versionKey(b)
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const d = (vb[i] ?? 0) - (va[i] ?? 0)
    if (d) return d
  }
  return 0
}

// ------------------------------------------------------------- locators

function locateClaude(): string | null {
  const exe = isWin ? 'claude.exe' : 'claude'
  return first(
    findOnPath('claude'),
    join(home, '.local', 'bin', exe),
    join(home, '.claude', 'local', isWin ? 'claude.cmd' : 'claude'),
    isWin ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'npm', 'claude.cmd') : null,
    isWin ? null : join(home, '.npm-global', 'bin', 'claude'),
    isWin ? null : '/usr/local/bin/claude',
    isMac ? '/opt/homebrew/bin/claude' : null
  )
}

function locateBlender(): string | null {
  if (isWin) {
    const foundation = join(programFiles, 'Blender Foundation')
    const installs = subdirs(foundation)
      .map((d) => join(d, 'blender.exe'))
      .filter(existsSync)
      .sort(compareVersionsDesc)
    return first(
      installs[0],
      join(programFilesX86, 'Steam', 'steamapps', 'common', 'Blender', 'blender.exe'),
      join(programFiles, 'Steam', 'steamapps', 'common', 'Blender', 'blender.exe'),
      ...subdirs(join(localAppData, 'Microsoft', 'WindowsApps'))
        .filter((d) => /blender/i.test(d))
        .map((d) => join(d, 'blender.exe')),
      findOnPath('blender')
    )
  }
  if (isMac) return first('/Applications/Blender.app/Contents/MacOS/Blender', join(home, 'Applications/Blender.app/Contents/MacOS/Blender'))
  return first(findOnPath('blender'), '/snap/bin/blender', '/usr/bin/blender')
}

function locateRobloxStudio(): string | null {
  if (isWin) {
    const roots = [join(localAppData, 'Roblox', 'Versions'), join(programFilesX86, 'Roblox', 'Versions'), join(programFiles, 'Roblox', 'Versions')]
    const candidates: string[] = []
    for (const root of roots) {
      for (const d of subdirs(root)) {
        for (const exe of ['RobloxStudioBeta.exe', 'RobloxStudio.exe']) {
          const p = join(d, exe)
          if (existsSync(p)) candidates.push(p)
        }
      }
      for (const exe of ['RobloxStudioLauncherBeta.exe', 'RobloxStudioInstaller.exe']) {
        const p = join(root, exe)
        if (existsSync(p)) candidates.push(p)
      }
    }
    // Newest version folder wins; Roblox keeps the active one most recently written.
    candidates.sort((a, b) => mtime(b) - mtime(a))
    return candidates[0] ?? null
  }
  if (isMac) return first('/Applications/RobloxStudio.app/Contents/MacOS/RobloxStudio', join(home, 'Applications/RobloxStudio.app/Contents/MacOS/RobloxStudio'))
  return null
}

function locateRojo(): string | null {
  const exe = isWin ? 'rojo.exe' : 'rojo'
  return first(
    findOnPath('rojo'),
    join(home, '.aftman', 'bin', exe),
    join(home, '.rokit', 'bin', exe),
    join(home, '.foreman', 'bin', exe),
    join(home, '.cargo', 'bin', exe)
  )
}

function locateGit(): string | null {
  return first(findOnPath('git'), isWin ? join(programFiles, 'Git', 'cmd', 'git.exe') : '/usr/bin/git')
}

// ------------------------------------------------------------- version probes

async function version(path: string, args: string[] = ['--version']): Promise<string | undefined> {
  const r = await run(path, args, { timeoutMs: 15000 })
  if (r.code !== 0) return undefined
  const out = (r.stdout || r.stderr).trim().split(/\r?\n/)[0]
  return out.replace(/^(git version|rojo|Python|v)\s*/i, '').trim().slice(0, 60) || undefined
}

function info(id: ToolId, name: string, path: string | null, ver?: string, error?: string): ToolInfo {
  return { id, name, found: !!path, path: path ?? undefined, version: ver, error }
}

function userOverride(p: string): string | null {
  return p && existsSync(p) ? p : null
}

export function claudePath(): string | null {
  return userOverride(getSettings().claudePath) ?? locateClaude()
}

export function blenderPath(): string | null {
  return userOverride(getSettings().blenderPath) ?? locateBlender()
}

export function robloxStudioPath(): string | null {
  return userOverride(getSettings().robloxStudioPath) ?? locateRobloxStudio()
}

export function gitPath(): string {
  return userOverride(getSettings().gitPath) ?? locateGit() ?? 'git'
}

export async function claudeAuthStatus(path: string): Promise<ClaudeAuth> {
  const r = await run(path, ['auth', 'status', '--json'], { timeoutMs: 20000 })
  try {
    const json = JSON.parse(r.stdout.trim())
    return { checked: true, loggedIn: !!json.loggedIn, method: json.authMethod, provider: json.apiProvider }
  } catch {
    // Older CLI without `auth status`: fall back to environment/credential hints.
    const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_USE_BEDROCK || process.env.CLAUDE_CODE_USE_VERTEX)
    const hasCreds = existsSync(join(home, '.claude', '.credentials.json'))
    if (hasKey || hasCreds) return { checked: true, loggedIn: true, method: hasKey ? 'env' : 'credentials' }
    return { checked: true, loggedIn: null, error: (r.stderr || r.stdout).trim().slice(0, 300) || undefined }
  }
}

function detectShells(): ToolsReport['shells'] {
  const shells: ToolsReport['shells'] = []
  if (isWin) {
    const pwsh = first(findOnPath('pwsh'), join(programFiles, 'PowerShell', '7', 'pwsh.exe'))
    if (pwsh) shells.push({ id: 'pwsh', label: 'PowerShell 7', path: pwsh })
    const sysRoot = process.env.SystemRoot ?? 'C:\\Windows'
    shells.push({ id: 'powershell', label: 'Windows PowerShell', path: join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') })
    shells.push({ id: 'cmd', label: 'Command Prompt', path: process.env.ComSpec ?? join(sysRoot, 'System32', 'cmd.exe') })
    const gitBash = first(join(programFiles, 'Git', 'bin', 'bash.exe'))
    if (gitBash) shells.push({ id: 'gitbash', label: 'Git Bash', path: gitBash })
  } else {
    for (const [id, label] of [
      ['zsh', 'zsh'],
      ['bash', 'bash'],
      ['fish', 'fish'],
      ['pwsh', 'PowerShell']
    ]) {
      const p = findOnPath(id)
      if (p) shells.push({ id, label, path: p })
    }
  }
  return shells
}

let cache: ToolsReport | null = null
let inflight: Promise<ToolsReport> | null = null

export function detectTools(force = false): Promise<ToolsReport> {
  if (cache && !force) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = (async () => {
    const s = getSettings()
    const claude = claudePath()
    const blender = blenderPath()
    const roblox = robloxStudioPath()
    const rojo = userOverride(s.rojoPath) ?? locateRojo()
    const git = userOverride(s.gitPath) ?? locateGit()
    const node = findOnPath('node')
    const python = findOnPath('python') ?? findOnPath('python3') ?? (isWin ? findOnPath('py') : null)

    const [claudeVer, rojoVer, gitVer, nodeVer, pyVer, auth] = await Promise.all([
      claude ? version(claude) : Promise.resolve(undefined),
      rojo ? version(rojo) : Promise.resolve(undefined),
      git ? version(git) : Promise.resolve(undefined),
      node ? version(node) : Promise.resolve(undefined),
      python ? version(python) : Promise.resolve(undefined),
      claude ? claudeAuthStatus(claude) : Promise.resolve<ClaudeAuth>({ checked: false, loggedIn: null })
    ])

    const blenderVer = blender ? (blender.match(/Blender\s*([\d.]+)/i)?.[1] ?? undefined) : undefined
    const robloxVer = roblox ? (roblox.match(/version-([0-9a-f]+)/i)?.[1]?.slice(0, 8) ?? undefined) : undefined

    const report: ToolsReport = {
      tools: {
        claude: info('claude', 'Claude Code', claude, claudeVer?.replace(/\(Claude Code\)/i, '').trim(), claude && !claudeVer ? 'Found, but `claude --version` failed' : undefined),
        blender: info('blender', 'Blender', blender, blenderVer),
        roblox: info('roblox', 'Roblox Studio', roblox, robloxVer),
        rojo: info('rojo', 'Rojo', rojo, rojoVer),
        git: info('git', 'Git', git, gitVer),
        node: info('node', 'Node.js', node, nodeVer),
        python: info('python', 'Python', python, pyVer)
      },
      claudeAuth: auth,
      shells: detectShells(),
      detectedAt: Date.now()
    }
    cache = report
    return report
  })().finally(() => {
    inflight = null
  })
  return inflight
}

export function defaultShell(): string {
  const configured = getSettings().shell
  if (configured && existsSync(configured)) return configured
  if (isWin) {
    const sysRoot = process.env.SystemRoot ?? 'C:\\Windows'
    return (
      first(findOnPath('pwsh'), join(programFiles, 'PowerShell', '7', 'pwsh.exe')) ??
      join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    )
  }
  return process.env.SHELL || findOnPath('bash') || '/bin/sh'
}
