import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { Project, ProjectInfo, ProjectKind } from '@shared/types'
import { JsonStore } from './store'
import { normalizeForCompare } from './paths'

let store: JsonStore<Project[]> | null = null
const st = (): JsonStore<Project[]> => (store ??= new JsonStore<Project[]>('projects', []))

export function listProjects(): Project[] {
  return [...st().get()].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
    return b.lastOpenedAt - a.lastOpenedAt
  })
}

export function getProject(id: string): Project | undefined {
  return st().get().find((p) => p.id === id)
}

export function addProject(folder: string): Project {
  const path = resolve(folder)
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`Folder does not exist: ${path}`)
  }
  const key = normalizeForCompare(path)
  const existing = st().get().find((p) => normalizeForCompare(p.path) === key)
  if (existing) {
    existing.lastOpenedAt = Date.now()
    st().set([...st().get()])
    return existing
  }
  const project: Project = {
    id: randomUUID(),
    name: basename(path) || path,
    path,
    addedAt: Date.now(),
    lastOpenedAt: Date.now()
  }
  st().set([...st().get(), project])
  return project
}

export async function createProject(parent: string, name: string): Promise<Project> {
  const clean = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
  if (!clean) throw new Error('Workspace name is empty')
  const path = join(parent, clean)
  if (existsSync(path)) throw new Error(`"${clean}" already exists in that folder`)
  await mkdir(path, { recursive: true })
  return addProject(path)
}

/** Removes a project from the app's list. Never touches files on disk. */
export function removeProject(id: string): Project[] {
  st().set(st().get().filter((p) => p.id !== id))
  return listProjects()
}

export function updateProject(id: string, patch: Partial<Project>): Project | null {
  const list = st().get()
  const idx = list.findIndex((p) => p.id === id)
  if (idx < 0) return null
  const { id: _ignored, path: _path, ...safe } = patch
  list[idx] = { ...list[idx], ...safe }
  st().set([...list])
  return list[idx]
}

export function touchProject(id: string): void {
  updateProject(id, { lastOpenedAt: Date.now() })
}

export function projectRoots(): string[] {
  return st().get().map((p) => p.path)
}

export function flushProjects(): void {
  store?.flush()
}

// ------------------------------------------------------------ type detection

const LABELS: Record<ProjectKind, string> = {
  roblox: 'Roblox',
  rojo: 'Rojo',
  blender: 'Blender',
  node: 'Node.js',
  python: 'Python',
  csharp: 'C#',
  unity: 'Unity',
  web: 'Web',
  rust: 'Rust',
  go: 'Go',
  lua: 'Lua',
  git: 'Git'
}

const ROBLOX_SERVICE_DIRS = [
  'replicatedstorage',
  'serverscriptservice',
  'starterplayer',
  'startergui',
  'serverstorage',
  'replicatedfirst',
  'workspace'
]

/**
 * Looks at the top level of a folder (and one level into src/) to guess what
 * kind of project it is. Never walks the whole tree — this must stay instant
 * even for huge folders.
 */
export async function detectProject(path: string): Promise<ProjectInfo> {
  const info: ProjectInfo = {
    path,
    kinds: [],
    label: 'Folder',
    blendFiles: [],
    placeFiles: [],
    rojoProjects: [],
    isGit: false,
    exists: existsSync(path)
  }
  if (!info.exists) return info

  let top: string[] = []
  try {
    top = (await readdir(path, { withFileTypes: true })).slice(0, 2000).map((d) => (d.isDirectory() ? d.name + '/' : d.name))
  } catch {
    return info
  }
  const lower = top.map((n) => n.toLowerCase())
  const has = (name: string): boolean => lower.includes(name)
  const ext = (e: string): string[] => top.filter((n) => n.toLowerCase().endsWith(e))
  const kinds = new Set<ProjectKind>()

  info.placeFiles = [...ext('.rbxl'), ...ext('.rbxlx')].map((n) => join(path, n))
  info.rojoProjects = top.filter((n) => n.toLowerCase().endsWith('.project.json')).map((n) => join(path, n))
  info.blendFiles = ext('.blend').map((n) => join(path, n))

  // Blender projects often keep .blend files one level down (models/, scenes/).
  for (const dir of top.filter((n) => n.endsWith('/')).slice(0, 12)) {
    if (!/^(models?|scenes?|blend|assets|art|source)\/$/i.test(dir)) continue
    try {
      const inner = await readdir(join(path, dir))
      for (const f of inner) if (f.toLowerCase().endsWith('.blend')) info.blendFiles.push(join(path, dir, f))
    } catch {
      /* ignore */
    }
  }

  let luaInSrc = false
  let robloxDirs = lower.some((n) => ROBLOX_SERVICE_DIRS.includes(n.replace(/\/$/, '')))
  if (has('src/')) {
    try {
      const inner = (await readdir(join(path, 'src'))).map((n) => n.toLowerCase())
      luaInSrc = inner.some((n) => n.endsWith('.lua') || n.endsWith('.luau'))
      if (inner.some((n) => ROBLOX_SERVICE_DIRS.includes(n) || ['server', 'client', 'shared'].includes(n))) {
        robloxDirs = robloxDirs || inner.some((n) => ROBLOX_SERVICE_DIRS.includes(n))
      }
    } catch {
      /* ignore */
    }
  }

  if (info.rojoProjects.length || has('aftman.toml') || has('rokit.toml') || has('foreman.toml')) kinds.add('rojo')
  if (info.placeFiles.length || kinds.has('rojo') || robloxDirs || has('wally.toml') || has('selene.toml')) kinds.add('roblox')
  if (!kinds.has('roblox') && (luaInSrc || ext('.lua').length || ext('.luau').length)) kinds.add('lua')
  if (info.blendFiles.length) kinds.add('blender')
  if (has('package.json')) kinds.add('node')
  if (has('requirements.txt') || has('pyproject.toml') || has('setup.py') || has('pipfile') || ext('.py').length) kinds.add('python')
  if (has('assets/') && has('projectsettings/')) kinds.add('unity')
  else if (ext('.csproj').length || ext('.sln').length) kinds.add('csharp')
  if (has('cargo.toml')) kinds.add('rust')
  if (has('go.mod')) kinds.add('go')
  if (!kinds.has('node') && (has('index.html') || ext('.html').length)) kinds.add('web')
  if (has('.git/') || has('.git')) {
    kinds.add('git')
    info.isGit = true
  }

  info.kinds = [...kinds]
  const main = info.kinds.filter((k) => k !== 'git' && !(k === 'rojo' && kinds.has('roblox')))
  let label = main.map((k) => LABELS[k]).join(' + ')
  if (kinds.has('roblox') && kinds.has('rojo')) label = ['Roblox + Rojo', ...main.filter((k) => k !== 'roblox').map((k) => LABELS[k])].join(' + ')
  info.label = label || (info.isGit ? 'Git repository' : 'Folder')
  return info
}
