import { create } from 'zustand'

export interface TermTab {
  key: string
  projectId: string
  title: string
  command?: string
  /** Backend pty id once created. */
  ptyId?: string
  exited?: boolean
}

interface TerminalsState {
  tabs: TermTab[]
  active: Record<string, string>
  requestNew(projectId: string, command?: string): void
  close(key: string): void
  setActive(projectId: string, key: string): void
  update(key: string, patch: Partial<TermTab>): void
}

let n = 1

export const useTerminals = create<TerminalsState>((set, get) => ({
  tabs: [],
  active: {},
  requestNew(projectId, command) {
    const key = `t${n++}`
    const title = command ? command.split(' ')[0] : 'Terminal'
    set((s) => ({ tabs: [...s.tabs, { key, projectId, title, command }], active: { ...s.active, [projectId]: key } }))
  },
  close(key) {
    const tab = get().tabs.find((t) => t.key === key)
    if (!tab) return
    if (tab.ptyId && !tab.exited) window.strata.terminal.kill(tab.ptyId)
    set((s) => {
      const tabs = s.tabs.filter((t) => t.key !== key)
      const active = { ...s.active }
      if (active[tab.projectId] === key) {
        const rest = tabs.filter((t) => t.projectId === tab.projectId)
        active[tab.projectId] = rest[rest.length - 1]?.key ?? ''
      }
      return { tabs, active }
    })
  },
  setActive(projectId, key) {
    set((s) => ({ active: { ...s.active, [projectId]: key } }))
  },
  update(key, patch) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...patch } : t)) }))
  }
}))
