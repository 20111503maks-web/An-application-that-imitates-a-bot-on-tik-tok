import '@/lib/monaco'
import { DiffEditor, Editor, type OnMount } from '@monaco-editor/react'
import { Box, Check, Columns2, ExternalLink, FileWarning, Gamepad2, Rows2, Save, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileContent, Project } from '@shared/types'
import { languageFor } from '@/lib/fileIcons'
import { onFsChange } from '@/lib/fsEvents'
import { dirname, extname, relative, samePath } from '@/lib/path'
import { useApp, type EditorTab } from '@/store/app'
import { useChat } from '@/store/chat'
import { toast } from '@/store/toast'
import type * as Monaco from 'monaco-editor'
import { Button, IconButton } from '../ui/Button'
import { openBlender, openRoblox } from '../workspace/FileExplorer'

function useEditorOptions(): Monaco.editor.IStandaloneEditorConstructionOptions {
  const s = useApp((x) => x.settings)
  return {
    fontFamily: "'JetBrains Mono Variable', 'Cascadia Code', Consolas, monospace",
    fontSize: s?.editorFontSize ?? 13,
    fontLigatures: true,
    lineHeight: 1.6,
    minimap: { enabled: s?.editorMinimap ?? true, renderCharacters: false, scale: 1 },
    wordWrap: s?.editorWordWrap ? 'on' : 'off',
    tabSize: s?.editorTabSize ?? 2,
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    renderLineHighlight: 'all',
    scrollBeyondLastLine: false,
    padding: { top: 12, bottom: 12 },
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: 'active', indentation: true },
    stickyScroll: { enabled: true },
    automaticLayout: true,
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
    overviewRulerBorder: false,
    fixedOverflowWidgets: true
  }
}

function Breadcrumb({ project, path, children }: { project: Project; path: string; children?: React.ReactNode }): JSX.Element {
  const parts = relative(project.path, path).split('/')
  return (
    <div className="editor-toolbar">
      <div className="breadcrumb">
        <span className="crumb">{project.name}</span>
        {parts.map((p, i) => (
          <span key={i} className={`crumb ${i === parts.length - 1 ? 'is-last' : ''}`}>
            <span className="crumb-sep">/</span>
            {p}
          </span>
        ))}
      </div>
      <div className="editor-toolbar-actions">{children}</div>
    </div>
  )
}

export function CodeEditor({ project, tab }: { project: Project; tab: EditorTab }): JSX.Element {
  const [file, setFile] = useState<FileContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diskChanged, setDiskChanged] = useState(false)
  const saved = useRef('')
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const dirtyRef = useRef(false)
  const options = useEditorOptions()
  const theme = useApp((s) => s.settings?.theme)
  const app = useApp.getState

  const load = useCallback(async (): Promise<void> => {
    try {
      const f = await window.strata.fs.readFile(tab.path)
      saved.current = f.content
      setFile(f)
      setError(null)
      setDiskChanged(false)
      const model = editorRef.current?.getModel()
      if (model && model.getValue() !== f.content) model.setValue(f.content)
      dirtyRef.current = false
      app().setTabDirty(tab.id, false)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [tab.path, tab.id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    return onFsChange(({ paths }) => {
      if (!paths.some((p) => samePath(p, tab.path))) return
      window.strata.fs.readFile(tab.path).then((f) => {
        if (f.content === saved.current) return
        if (dirtyRef.current) setDiskChanged(true)
        else load()
      }).catch(() => undefined)
    })
  }, [tab.path, load])

  const save = useCallback(async (): Promise<void> => {
    const value = editorRef.current?.getValue()
    if (value === undefined) return
    try {
      await window.strata.fs.writeFile(tab.path, value)
      saved.current = value
      dirtyRef.current = false
      setDiskChanged(false)
      app().setTabDirty(tab.id, false)
    } catch (err) {
      toast.error('Save failed', (err as Error).message)
    }
  }, [tab.path, tab.id])

  const saveRef = useRef(save)
  saveRef.current = save

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
    editor.addAction({
      id: 'strata.askClaude',
      label: 'Ask Claude about selection',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 0,
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL],
      run: (ed) => {
        const sel = ed.getSelection()
        const rel = relative(project.path, tab.path)
        const range = sel && !sel.isEmpty() ? `#L${sel.startLineNumber}-${sel.endLineNumber}` : ''
        app().insertIntoComposer(`@${rel}${range} `)
      }
    })
    editor.focus()
  }

  if (error) return <div className="editor-placeholder"><FileWarning size={22} /><div>{error}</div></div>
  if (!file) return <div className="editor-loading"><span className="spinner" /></div>

  if (file.binary || file.tooLarge) {
    const ext = extname(tab.path)
    return (
      <div className="editor-wrap">
        <Breadcrumb project={project} path={tab.path} />
        <div className="editor-placeholder">
          <FileWarning size={24} />
          <div className="placeholder-title">{file.tooLarge ? 'File is too large to edit here' : 'Binary file'}</div>
          <small>{(file.size / 1024).toFixed(1)} KB</small>
          <div className="placeholder-actions">
            {ext === '.blend' && (
              <Button variant="primary" size="sm" icon={<Box size={13} />} onClick={() => openBlender(tab.path)}>
                Open in Blender
              </Button>
            )}
            {(ext === '.rbxl' || ext === '.rbxlx') && (
              <Button variant="primary" size="sm" icon={<Gamepad2 size={13} />} onClick={() => openRoblox(tab.path)}>
                Open in Roblox Studio
              </Button>
            )}
            <Button size="sm" variant="secondary" icon={<ExternalLink size={13} />} onClick={() => window.strata.tools.openFolder(dirname(tab.path))}>
              Show in folder
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="editor-wrap">
      <Breadcrumb project={project} path={tab.path}>
        {tab.dirty && (
          <Button size="sm" variant="ghost" icon={<Save size={13} />} onClick={save} kbd="Ctrl S">
            Save
          </Button>
        )}
      </Breadcrumb>
      {diskChanged && (
        <div className="editor-banner">
          File changed on disk.
          <Button size="sm" variant="secondary" onClick={load}>
            Reload
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDiskChanged(false)}>
            Keep my version
          </Button>
        </div>
      )}
      <div className="editor-host">
        <Editor
          path={tab.path}
          defaultValue={file.content}
          defaultLanguage={languageFor(tab.path)}
          theme={`strata-${theme ?? 'dark'}`}
          options={options}
          onMount={onMount}
          onChange={(v) => {
            const dirty = (v ?? '') !== saved.current
            if (dirty !== dirtyRef.current) {
              dirtyRef.current = dirty
              app().setTabDirty(tab.id, dirty)
            }
          }}
          loading={<span className="spinner" />}
        />
      </div>
    </div>
  )
}

export function DiffView({ project, tab }: { project: Project; tab: EditorTab }): JSX.Element {
  const [original, setOriginal] = useState<string | null>(null)
  const [modified, setModified] = useState<string | null>(null)
  const [sideBySide, setSideBySide] = useState(true)
  const [missing, setMissing] = useState(false)
  const options = useEditorOptions()
  const theme = useApp((s) => s.settings?.theme)
  const change = useChat((s) => s.chats[project.id]?.changes.find((c) => samePath(c.path, tab.path)))
  const { accept, reject } = useChat.getState()
  const app = useApp.getState
  const isClaude = tab.diffSource === 'claude'
  const diffRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null)

  // We keep the models alive past the widget (avoids a Monaco dispose-order error) and free them here.
  useEffect(
    () => () => {
      const models = diffRef.current?.getModel()
      setTimeout(() => {
        models?.original.dispose()
        models?.modified.dispose()
      }, 0)
    },
    []
  )

  const load = useCallback(async () => {
    let current = ''
    try {
      const f = await window.strata.fs.readFile(tab.path)
      current = f.binary || f.tooLarge ? '(binary or large file)' : f.content
    } catch {
      current = ''
    }
    setModified(current)
    if (isClaude) {
      const c = useChat.getState().chats[project.id]?.changes.find((x) => samePath(x.path, tab.path))
      if (!c) setMissing(true)
      setOriginal(c?.original ?? '')
    } else {
      const head = await window.strata.git.fileAtHead(project.path, tab.gitPath ?? relative(project.path, tab.path)).catch(() => null)
      setOriginal(head ?? '')
    }
  }, [tab.path, isClaude, project.id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => onFsChange(({ paths }) => paths.some((p) => samePath(p, tab.path)) && load()), [tab.path, load])

  const done = async (fn: () => Promise<void>): Promise<void> => {
    await fn()
    app().closeTab(tab.id)
  }

  return (
    <div className="editor-wrap">
      <Breadcrumb project={project} path={tab.path}>
        {change && (
          <span className="diffstat">
            <span className="add">+{change.additions}</span>
            <span className="del">−{change.deletions}</span>
          </span>
        )}
        <IconButton tip={sideBySide ? 'Inline view' : 'Side-by-side view'} onClick={() => setSideBySide((v) => !v)}>
          {sideBySide ? <Rows2 size={14} /> : <Columns2 size={14} />}
        </IconButton>
        <Button size="sm" variant="ghost" onClick={() => app().openFile(tab.path)}>
          Open file
        </Button>
        {isClaude && change && (
          <>
            <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={() => done(() => reject(project.id, [tab.path]))}>
              Reject
            </Button>
            <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={() => done(() => accept(project.id, [tab.path]))}>
              Accept
            </Button>
          </>
        )}
      </Breadcrumb>
      {isClaude && missing && !change && <div className="editor-banner">This change was already accepted or rejected — showing the file as it is now.</div>}
      <div className="editor-host">
        {original !== null && modified !== null && (
          <DiffEditor
            original={original}
            modified={modified}
            language={languageFor(tab.path)}
            originalModelPath={`diff-original://${tab.path}`}
            modifiedModelPath={`diff-modified://${tab.path}`}
            theme={`strata-${theme ?? 'dark'}`}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            onMount={(ed) => (diffRef.current = ed)}
            options={{ ...options, readOnly: true, originalEditable: false, renderSideBySide: sideBySide, minimap: { enabled: false }, renderOverviewRuler: true, diffWordWrap: 'inherit', hideUnchangedRegions: { enabled: true } } as Monaco.editor.IDiffEditorConstructionOptions}
          />
        )}
      </div>
    </div>
  )
}

