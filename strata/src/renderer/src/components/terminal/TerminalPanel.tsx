import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITheme } from '@xterm/xterm'
import { ChevronDown, Plus, SquareTerminal, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { activeProject, useApp } from '@/store/app'
import { useTerminals, type TermTab } from '@/store/terminals'
import { IconButton } from '../ui/Button'
import { Resizer } from '../ui/Resizer'

// One IPC subscription routes pty output to the right xterm instance.
const sinks = new Map<string, (data: string) => void>()
const exitSinks = new Map<string, (code: number) => void>()
let routed = false
function route(): void {
  if (routed) return
  routed = true
  window.strata.terminal.onData(({ id, data }) => sinks.get(id)?.(data))
  window.strata.terminal.onExit(({ id, code }) => exitSinks.get(id)?.(code))
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function xtermTheme(): ITheme {
  const light = document.documentElement.dataset.theme === 'light'
  return {
    background: cssVar('--bg-1'),
    foreground: cssVar('--text-0'),
    cursor: cssVar('--accent'),
    cursorAccent: cssVar('--bg-1'),
    selectionBackground: light ? 'rgba(47,111,224,0.2)' : 'rgba(106,168,255,0.28)',
    black: light ? '#3b3d45' : '#1e1f25',
    red: '#f0616d',
    green: '#3ecf8e',
    yellow: '#e5b454',
    blue: '#6aa8ff',
    magenta: '#b18cff',
    cyan: '#4fd1d9',
    white: light ? '#6e6f78' : '#c8c9cf',
    brightBlack: '#5b5c64',
    brightRed: '#ff7b86',
    brightGreen: '#5fe0a5',
    brightYellow: '#f2c873',
    brightBlue: '#8bbcff',
    brightMagenta: '#c6a8ff',
    brightCyan: '#74e0e6',
    brightWhite: light ? '#17171c' : '#ffffff'
  }
}

function TermView({ tab, cwd, visible }: { tab: TermTab; cwd: string; visible: boolean }): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyRef = useRef<string | null>(null)
  const fontSize = useApp((s) => s.settings?.terminalFontSize ?? 13)
  const shell = useApp((s) => s.settings?.shell)
  const theme = useApp((s) => s.settings?.theme)

  useEffect(() => {
    route()
    const term = new Terminal({
      fontFamily: "'JetBrains Mono Variable', 'Cascadia Mono', Consolas, monospace",
      fontSize,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      scrollback: 10000,
      theme: xtermTheme(),
      windowsPty: window.strata.platform === 'win32' ? { backend: 'conpty' } : undefined
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_e, uri) => window.strata.tools.openExternal(uri)))
    term.open(host.current!)
    termRef.current = term
    fitRef.current = fit
    try {
      fit.fit()
    } catch {
      /* hidden */
    }

    // Ctrl+C copies when there is a selection, Ctrl+V pastes (Windows Terminal behaviour).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      if (mod && e.key.toLowerCase() === 'v') {
        navigator.clipboard.readText().then((t) => ptyRef.current && window.strata.terminal.write(ptyRef.current, t))
        e.preventDefault()
        return false
      }
      if (mod && e.key === '`') return false
      return true
    })

    let disposed = false
    const startPty = async (): Promise<void> => {
      try {
        const info = await window.strata.terminal.create({
          projectId: tab.projectId,
          cwd,
          cols: term.cols,
          rows: term.rows,
          shell: shell || undefined,
          command: tab.command || undefined
        })
        if (disposed) {
          window.strata.terminal.kill(info.id)
          return
        }
        ptyRef.current = info.id
        useTerminals.getState().update(tab.key, { ptyId: info.id, title: tab.command ? tab.title : info.title, exited: false })
        sinks.set(info.id, (d) => term.write(d))
        exitSinks.set(info.id, (code) => {
          term.write(`\r\n\x1b[2m[process exited with code ${code}] — press any key to restart\x1b[0m\r\n`)
          useTerminals.getState().update(tab.key, { exited: true })
          sinks.delete(info.id)
          exitSinks.delete(info.id)
          ptyRef.current = null
        })
      } catch (err) {
        term.write(`\x1b[31m${(err as Error).message}\x1b[0m\r\n`)
      }
    }
    startPty()

    const dataSub = term.onData((d) => {
      if (ptyRef.current) window.strata.terminal.write(ptyRef.current, d)
      else if (useTerminals.getState().tabs.find((t) => t.key === tab.key)?.exited) {
        term.reset()
        startPty()
      }
    })
    const resizeSub = term.onResize(({ cols, rows }) => ptyRef.current && window.strata.terminal.resize(ptyRef.current, cols, rows))

    const ro = new ResizeObserver(() => {
      if (!host.current?.offsetParent) return
      try {
        fit.fit()
      } catch {
        /* ignore */
      }
    })
    ro.observe(host.current!)

    return () => {
      disposed = true
      ro.disconnect()
      dataSub.dispose()
      resizeSub.dispose()
      if (ptyRef.current) {
        sinks.delete(ptyRef.current)
        exitSinks.delete(ptyRef.current)
      }
      term.dispose()
    }
  }, [])

  useEffect(() => {
    if (termRef.current) termRef.current.options.fontSize = fontSize
    try {
      fitRef.current?.fit()
    } catch {
      /* ignore */
    }
  }, [fontSize])

  useEffect(() => {
    if (!termRef.current) return
    // Theme variables update a frame after the data-theme attribute changes.
    requestAnimationFrame(() => termRef.current && (termRef.current.options.theme = xtermTheme()))
  }, [theme])

  useEffect(() => {
    if (!visible) return
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
      } catch {
        /* ignore */
      }
      termRef.current?.focus()
    })
  }, [visible])

  return <div className="term-host" ref={host} style={{ display: visible ? undefined : 'none' }} />
}

export function TerminalPanel(): JSX.Element | null {
  const open = useApp((s) => s.terminalOpen)
  const project = useApp(activeProject)
  const projects = useApp((s) => s.projects)
  const height = useApp((s) => s.layout.terminalHeight)
  const { tabs, active } = useTerminals()
  const [base, setBase] = useState(height)
  const app = useApp.getState
  const term = useTerminals.getState

  const projectTabs = project ? tabs.filter((t) => t.projectId === project.id) : []
  const activeKey = project ? active[project.id] : undefined

  useEffect(() => {
    if (open && project && !tabs.some((t) => t.projectId === project.id)) term().requestNew(project.id)
  }, [open, project?.id])

  if (!project && !tabs.length) return null

  return (
    <div className="terminal-panel" style={{ height, display: open && project ? undefined : 'none' }}>
      <Resizer
        direction="y"
        className="terminal-resizer"
        onStart={() => setBase(useApp.getState().layout.terminalHeight)}
        onResize={(d) => app().setLayout({ terminalHeight: Math.max(120, Math.min(window.innerHeight - 220, base - d)) })}
      />
      <div className="terminal-bar">
        <div className="terminal-tabs">
          {projectTabs.map((t) => (
            <div key={t.key} className={`term-tab ${t.key === activeKey ? 'is-active' : ''} ${t.exited ? 'is-exited' : ''}`} onClick={() => term().setActive(t.projectId, t.key)}>
              <SquareTerminal size={12} />
              <span>{t.title}</span>
              <button
                className="term-tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  term().close(t.key)
                }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <IconButton size="xs" tip="New terminal" onClick={() => project && term().requestNew(project.id)}>
            <Plus size={13} />
          </IconButton>
        </div>
        <div className="terminal-actions">
          <span className="terminal-cwd mono">{project?.path}</span>
          <IconButton size="xs" tip="Kill terminal" onClick={() => activeKey && term().close(activeKey)}>
            <Trash2 size={12} />
          </IconButton>
          <IconButton size="xs" tip="Hide panel (Ctrl `)" onClick={() => app().toggleTerminal(false)}>
            <ChevronDown size={14} />
          </IconButton>
        </div>
      </div>
      <div className="terminal-body">
        {tabs.map((t) => {
          const p = projects.find((x) => x.id === t.projectId)
          if (!p) return null
          return <TermView key={t.key} tab={t} cwd={p.path} visible={open && t.projectId === project?.id && t.key === activeKey} />
        })}
      </div>
    </div>
  )
}
