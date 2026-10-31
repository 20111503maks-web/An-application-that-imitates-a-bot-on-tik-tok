import { useEffect, useRef } from 'react'
import type { Project } from '@shared/types'
import { onFsChange } from '@/lib/fsEvents'
import { isInside } from '@/lib/path'
import { useApp } from '@/store/app'
import { useChat } from '@/store/chat'
import { EditorArea } from './editor/EditorArea'
import { RightPanel } from './workspace/RightPanel'

export function Workspace({ project }: { project: Project }): JSX.Element {
  const rightOpen = useApp((s) => s.layout.rightOpen)
  const gitTimer = useRef<number | null>(null)

  useEffect(() => {
    window.strata.fs.watch(project.path).catch(() => undefined)
    const off = onFsChange(({ root, paths }) => {
      if (!isInside(project.path, root) && !isInside(root, project.path)) return
      if (!paths.length) return
      // Coalesce bursts (e.g. npm install) into one git refresh.
      if (gitTimer.current) window.clearTimeout(gitTimer.current)
      gitTimer.current = window.setTimeout(() => {
        if (useApp.getState().settings?.gitAutoRefresh !== false) useApp.getState().refreshGit(project.id)
        useChat.getState().refreshChanges(project.id)
      }, 600)
    })
    return () => {
      off()
      if (gitTimer.current) window.clearTimeout(gitTimer.current)
      window.strata.fs.unwatch(project.path).catch(() => undefined)
    }
  }, [project.id, project.path])

  return (
    <div className="workspace">
      <section className="center">
        <EditorArea project={project} />
      </section>
      {rightOpen && <RightPanel project={project} />}
    </div>
  )
}
