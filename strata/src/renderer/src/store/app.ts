import { create } from 'zustand'
import type { GitStatus, Project, ProjectInfo, Settings, ToolsReport } from '@shared/types'
import { basename } from '@/lib/path'
import { toast } from './toast'

export type RightTab = 'files' | 'changes' | 'git' | 'tools'
export type SettingsSection = 'general' | 'appearance' | 'claude' | 'terminal' | 'editor' | 'projects' | 'roblox' | 'blender' | 'git'

export interface EditorTab {
  id: string
  kind: 'file' | 'diff'
  path: string
  title: string
  /** For diffs: where the "original" side comes from. */
  diffSource?: 'claude' | 'git'
  /** Repo-relative path for git diffs. */
  gitPath?: string
  dirty?: boolean
  preview?: boolean
}

export interface ProjectTabs {
  tabs: EditorTab[]
  /** 'chat' or an EditorTab id. */
  active: string
}

interface Layout {
  sidebarWidth: number
  rightWidth: number
  terminalHeight: number
  sidebarOpen: boolean
  rightOpen: boolean
}

const LAYOUT_KEY = 'strata.layout'
const defaultLayout: Layout = { sidebarWidth: 248, rightWidth: 320, terminalHeight: 260, sidebarOpen: true, rightOpen: true }

function loadLayout(): Layout {
  try {
    return { ...defaultLayout, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') }
  } catch {
    return defaultLayout
  }
}

export interface SetupStep {
  label: string
  state: 'pending' | 'running' | 'done' | 'warn'
  detail?: string
}

interface AppState {
  ready: boolean
  settings: Settings | null
  projects: Project[]
  activeId: string | null
  tools: ToolsReport | null
  detecting: boolean
  infos: Record<string, ProjectInfo>
  git: Record<string, GitStatus>
  tabs: Record<string, ProjectTabs>
  rightTab: RightTab
  terminalOpen: boolean
  settingsOpen: SettingsSection | null
  paletteOpen: boolean
  layout: Layout
  setup: { projectName: string; steps: SetupStep[] } | null
  composerInsert: { text: string; nonce: number } | null
  revealPath: { path: string; nonce: number } | null

  init(): Promise<void>
  refreshTools(force?: boolean): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  openFolderDialog(): Promise<void>
  addFoldersDialog(): Promise<void>
  createWorkspace(parent: string, name: string): Promise<void>
  addAndOpen(path: string): Promise<void>
  openProject(id: string, withSetup?: boolean): Promise<void>
  removeProject(id: string): Promise<void>
  updateProject(id: string, patch: Partial<Project>): Promise<void>
  refreshInfo(path: string): Promise<void>
  refreshGit(projectId?: string): Promise<void>

  setRightTab(tab: RightTab): void
  toggleTerminal(open?: boolean): void
  openSettings(section?: SettingsSection | null): void
  setPalette(open: boolean): void
  setLayout(patch: Partial<Layout>): void

  openFile(path: string, opts?: { preview?: boolean }): void
  openDiff(path: string, source: 'claude' | 'git', gitPath?: string): void
  closeTab(id: string): void
  setActiveTab(id: string): void
  setTabDirty(id: string, dirty: boolean): void
  renameTabPath(from: string, to: string): void
  insertIntoComposer(text: string): void
  reveal(path: string): void
}

export const activeProject = (s: Pick<AppState, 'projects' | 'activeId'>): Project | undefined => s.projects.find((p) => p.id === s.activeId)

const EMPTY_TABS: ProjectTabs = { tabs: [], active: 'chat' }
const tabsOf = (s: AppState, id: string | null): ProjectTabs => (id && s.tabs[id]) || EMPTY_TABS

export const useApp = create<AppState>((set, get) => {
  const patchTabs = (fn: (t: ProjectTabs) => ProjectTabs): void => {
    const id = get().activeId
    if (!id) return
    set((s) => ({ tabs: { ...s.tabs, [id]: fn(tabsOf(s, id)) } }))
  }

  const runSetup = async (project: Project): Promise<void> => {
    const steps: SetupStep[] = [
      { label: 'Detecting tools', state: 'running' },
      { label: 'Finding Claude Code', state: 'pending' },
      { label: 'Analyzing project', state: 'pending' },
      { label: 'Opening workspace', state: 'pending' }
    ]
    const update = (i: number, patch: Partial<SetupStep>): void => {
      steps[i] = { ...steps[i], ...patch }
      if (i + 1 < steps.length && (patch.state === 'done' || patch.state === 'warn') && steps[i + 1].state === 'pending') steps[i + 1] = { ...steps[i + 1], state: 'running' }
      set({ setup: { projectName: project.name, steps: [...steps] } })
    }
    set({ setup: { projectName: project.name, steps: [...steps] } })
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    await get().refreshTools()
    const t = get().tools
    const found = t ? Object.values(t.tools).filter((x) => x.found && x.id !== 'claude').map((x) => x.name) : []
    update(0, { state: 'done', detail: found.length ? found.join(' · ') : 'No extra tools found' })
    await sleep(160)
    const c = t?.tools.claude
    update(1, c?.found ? { state: 'done', detail: `Claude Code ${c.version ?? ''}`.trim() } : { state: 'warn', detail: 'Not found — set the path in Settings' })
    await sleep(160)
    await get().refreshInfo(project.path)
    const info = get().infos[project.path]
    update(2, { state: 'done', detail: info?.label ?? 'Folder' })
    await sleep(160)
    update(3, { state: 'done', detail: project.path })
    await sleep(380)
    set({ setup: null })
  }

  return {
    ready: false,
    settings: null,
    projects: [],
    activeId: null,
    tools: null,
    detecting: false,
    infos: {},
    git: {},
    tabs: {},
    rightTab: 'files',
    terminalOpen: false,
    settingsOpen: null,
    paletteOpen: false,
    layout: loadLayout(),
    setup: null,
    composerInsert: null,
    revealPath: null,

    async init() {
      const [settings, projects] = await Promise.all([window.strata.settings.get(), window.strata.projects.list()])
      set({ settings, projects })
      let activeId: string | null = null
      if (settings.restoreLastProject && settings.lastProjectId && projects.some((p) => p.id === settings.lastProjectId)) activeId = settings.lastProjectId
      set({ ready: true })
      get().refreshTools()
      if (activeId) await get().openProject(activeId)
    },

    async refreshTools(force) {
      set({ detecting: true })
      try {
        const tools = await window.strata.tools.detect(force)
        set({ tools })
      } catch (err) {
        toast.error('Tool detection failed', (err as Error).message)
      } finally {
        set({ detecting: false })
      }
    },

    async updateSettings(patch) {
      const settings = await window.strata.settings.set(patch)
      set({ settings })
    },

    async openFolderDialog() {
      const [folder] = await window.strata.projects.pickFolder(false)
      if (folder) await get().addAndOpen(folder)
    },

    async addFoldersDialog() {
      const folders = await window.strata.projects.pickFolder(true)
      if (!folders.length) return
      let last: Project | null = null
      for (const f of folders) {
        try {
          last = await window.strata.projects.add(f)
        } catch (err) {
          toast.error(`Could not add ${basename(f)}`, (err as Error).message)
        }
      }
      set({ projects: await window.strata.projects.list() })
      if (folders.length === 1 && last) await get().openProject(last.id, true)
      else toast.success(`Added ${folders.length} folders`)
    },

    async createWorkspace(parent, name) {
      const p = await window.strata.projects.create(parent, name)
      set({ projects: await window.strata.projects.list() })
      await get().openProject(p.id, true)
    },

    async addAndOpen(path) {
      try {
        const p = await window.strata.projects.add(path)
        set({ projects: await window.strata.projects.list() })
        await get().openProject(p.id, true)
      } catch (err) {
        toast.error('Could not open folder', (err as Error).message)
      }
    },

    async openProject(id, withSetup) {
      const project = get().projects.find((p) => p.id === id)
      if (!project) return
      const prev = get().activeId
      if (prev === id && !withSetup) return
      set({ activeId: id })
      window.strata.projects.touch(id).catch(() => undefined)
      if (withSetup || !get().settings?.onboarded) {
        await runSetup(project)
        if (!get().settings?.onboarded) get().updateSettings({ onboarded: true })
      } else {
        get().refreshInfo(project.path)
      }
      get().refreshGit(id)
    },

    async removeProject(id) {
      const projects = await window.strata.projects.remove(id)
      const { [id]: _removed, ...tabs } = get().tabs
      set((s) => ({ projects, tabs, activeId: s.activeId === id ? null : s.activeId }))
    },

    async updateProject(id, patch) {
      await window.strata.projects.update(id, patch)
      set({ projects: await window.strata.projects.list() })
    },

    async refreshInfo(path) {
      try {
        const info = await window.strata.projects.info(path)
        set((s) => ({ infos: { ...s.infos, [path]: info } }))
      } catch {
        /* folder may have been removed */
      }
    },

    async refreshGit(projectId) {
      const id = projectId ?? get().activeId
      const project = get().projects.find((p) => p.id === id)
      if (!id || !project) return
      try {
        const status = await window.strata.git.status(project.path)
        set((s) => ({ git: { ...s.git, [id]: status } }))
      } catch {
        /* git missing */
      }
    },

    setRightTab(tab) {
      set((s) => ({ rightTab: tab, layout: { ...s.layout, rightOpen: true } }))
    },
    toggleTerminal(open) {
      set((s) => ({ terminalOpen: open ?? !s.terminalOpen }))
    },
    openSettings(section = 'general') {
      set({ settingsOpen: section })
    },
    setPalette(open) {
      set({ paletteOpen: open })
    },
    setLayout(patch) {
      const layout = { ...get().layout, ...patch }
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
      set({ layout })
    },

    openFile(path, opts) {
      patchTabs((t) => {
        const existing = t.tabs.find((x) => x.kind === 'file' && x.path === path)
        if (existing) {
          const tabs = opts?.preview ? t.tabs : t.tabs.map((x) => (x.id === existing.id ? { ...x, preview: false } : x))
          return { tabs, active: existing.id }
        }
        const tab: EditorTab = { id: `file:${path}`, kind: 'file', path, title: basename(path), preview: !!opts?.preview }
        // Single-click opens a "preview" tab that the next preview replaces (VS Code behaviour).
        const tabs = opts?.preview ? t.tabs.filter((x) => !(x.preview && !x.dirty)) : t.tabs
        return { tabs: [...tabs, tab], active: tab.id }
      })
    },

    openDiff(path, source, gitPath) {
      patchTabs((t) => {
        const id = `diff:${source}:${path}`
        if (t.tabs.some((x) => x.id === id)) return { ...t, active: id }
        const tab: EditorTab = { id, kind: 'diff', path, title: basename(path), diffSource: source, gitPath }
        return { tabs: [...t.tabs, tab], active: id }
      })
    },

    closeTab(id) {
      patchTabs((t) => {
        const idx = t.tabs.findIndex((x) => x.id === id)
        if (idx < 0) return t
        const tabs = t.tabs.filter((x) => x.id !== id)
        let active = t.active
        if (active === id) active = tabs[Math.min(idx, tabs.length - 1)]?.id ?? 'chat'
        return { tabs, active }
      })
    },

    setActiveTab(id) {
      patchTabs((t) => ({ ...t, active: id }))
    },

    setTabDirty(id, dirty) {
      patchTabs((t) => ({ ...t, tabs: t.tabs.map((x) => (x.id === id ? { ...x, dirty, preview: dirty ? false : x.preview } : x)) }))
    },

    renameTabPath(from, to) {
      patchTabs((t) => ({
        ...t,
        tabs: t.tabs.map((x) => (x.path === from ? { ...x, path: to, title: basename(to), id: x.id.replace(from, to) } : x)),
        active: t.active.replace(from, to)
      }))
    },

    insertIntoComposer(text) {
      patchTabs((t) => ({ ...t, active: 'chat' }))
      set({ composerInsert: { text, nonce: Date.now() } })
    },

    reveal(path) {
      set((s) => ({ rightTab: 'files', layout: { ...s.layout, rightOpen: true }, revealPath: { path, nonce: Date.now() } }))
    }
  }
})

export function useActiveTabs(): ProjectTabs {
  return useApp((s) => tabsOf(s as AppState, s.activeId))
}
