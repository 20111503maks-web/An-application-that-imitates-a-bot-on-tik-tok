import { useEffect } from 'react'
import { useApp } from '@/store/app'

/** Global keyboard shortcuts (editor-local ones like Ctrl+S live in the editor). */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      const app = useApp.getState()
      if (mod && e.key === '`') {
        e.preventDefault()
        app.toggleTerminal()
      } else if (mod && e.key === ',') {
        e.preventDefault()
        app.openSettings(app.settingsOpen ? null : 'general')
      } else if (mod && e.key.toLowerCase() === 'o' && !e.shiftKey) {
        e.preventDefault()
        app.openFolderDialog()
      } else if (mod && e.key.toLowerCase() === 'b' && !e.shiftKey) {
        e.preventDefault()
        app.setLayout({ sidebarOpen: !app.layout.sidebarOpen })
      } else if (mod && e.key.toLowerCase() === 'b' && e.shiftKey) {
        e.preventDefault()
        app.setLayout({ rightOpen: !app.layout.rightOpen })
      } else if (mod && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        app.setActiveTab('chat')
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus())
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        app.setRightTab('git')
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        app.setRightTab('files')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
