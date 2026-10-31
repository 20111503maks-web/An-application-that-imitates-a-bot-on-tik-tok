import { useEffect } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { Welcome } from './components/Welcome'
import { Workspace } from './components/Workspace'
import { SetupOverlay } from './components/SetupOverlay'
import { StatusBar } from './components/StatusBar'
import { TerminalPanel } from './components/terminal/TerminalPanel'
import { SettingsModal } from './components/settings/SettingsModal'
import { ContextMenuHost } from './components/ui/Menu'
import { DialogHost } from './components/ui/Dialog'
import { Toasts } from './components/ui/Toasts'
import { activeProject, useApp } from './store/app'
import { useShortcuts } from './lib/shortcuts'

export function App(): JSX.Element {
  const ready = useApp((s) => s.ready)
  const settings = useApp((s) => s.settings)
  const project = useApp(activeProject)
  const setup = useApp((s) => s.setup)
  const sidebarOpen = useApp((s) => s.layout.sidebarOpen)

  useEffect(() => {
    useApp.getState().init()
  }, [])

  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    root.dataset.theme = settings.theme
    root.style.setProperty('--accent', settings.accent || '#d97757')
    window.strata.window.setZoom(settings.uiScale || 1)
    root.dataset.platform = window.strata.platform
  }, [settings])

  useShortcuts()

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        {ready && sidebarOpen && <Sidebar />}
        <main className="app-main">
          <div className="main-content">{ready && (project ? <Workspace key={project.id} project={project} /> : <Welcome />)}</div>
          {ready && <TerminalPanel />}
        </main>
      </div>
      <StatusBar />
      {setup && <SetupOverlay />}
      <SettingsModal />
      <ContextMenuHost />
      <DialogHost />
      <Toasts />
    </div>
  )
}
