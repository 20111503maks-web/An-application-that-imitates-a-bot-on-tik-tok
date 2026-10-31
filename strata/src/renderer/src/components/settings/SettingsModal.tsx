import { Box, Code2, FolderKanban, Gamepad2, GitBranch, Palette, RefreshCw, Settings2, Sparkles, SquareTerminal, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { PermissionMode, Settings, ThemeName, ToolId } from '@shared/types'
import { tildify } from '@/lib/path'
import { timeAgo } from '@/lib/tools'
import { useApp, type SettingsSection } from '@/store/app'
import { Button, IconButton } from '../ui/Button'
import { Select } from '../ui/Select'
import { Toggle } from '../ui/Toggle'
import { openClaudeInTerminal } from '../ClaudeStatus'
import { ProjectGlyph } from '../ProjectGlyph'

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Settings2 size={14} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={14} /> },
  { id: 'claude', label: 'Claude Code', icon: <Sparkles size={14} /> },
  { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={14} /> },
  { id: 'editor', label: 'Editor', icon: <Code2 size={14} /> },
  { id: 'projects', label: 'Projects', icon: <FolderKanban size={14} /> },
  { id: 'roblox', label: 'Roblox', icon: <Gamepad2 size={14} /> },
  { id: 'blender', label: 'Blender', icon: <Box size={14} /> },
  { id: 'git', label: 'Git', icon: <GitBranch size={14} /> }
]

const ACCENTS = ['#d97757', '#6aa8ff', '#3ecf8e', '#b18cff', '#f0616d', '#e5b454', '#4fd1d9', '#ececee']

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-label">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function Group({ title, children }: { title?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="setting-group">
      {title && <div className="setting-group-title">{title}</div>}
      <div className="setting-group-body">{children}</div>
    </div>
  )
}

/** Path field with Browse + Auto-detect; empty value means "auto-detect". */
function PathField({ value, onChange, tool }: { value: string; onChange(v: string): void; tool: ToolId }): JSX.Element {
  const tools = useApp((s) => s.tools)
  const detecting = useApp((s) => s.detecting)
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const detected = tools?.tools[tool]
  return (
    <div className="path-field">
      <input
        className="input mono"
        value={draft}
        placeholder={detected?.path ? `Auto: ${detected.path}` : 'Auto-detect'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onChange(draft.trim())}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          const p = await window.strata.tools.pickExecutable()
          if (p) onChange(p)
        }}
      >
        Browse
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon={<RefreshCw size={12} className={detecting ? 'spin' : ''} />}
        onClick={() => {
          onChange('')
        }}
      >
        Auto Detect
      </Button>
      <div className={`path-status ${detected?.found ? 'is-ok' : 'is-missing'}`}>
        <span className="detect-dot" />
        {detected?.found ? `${detected.name} ${detected.version ?? ''} — ${detected.path}` : `${detected?.name ?? 'Tool'} not found`}
      </div>
    </div>
  )
}

function Section({ id }: { id: SettingsSection }): JSX.Element | null {
  const s = useApp((x) => x.settings)
  const tools = useApp((x) => x.tools)
  const projects = useApp((x) => x.projects)
  const app = useApp.getState
  if (!s) return null
  const set = async (patch: Partial<Settings>): Promise<void> => {
    await app().updateSettings(patch)
    if (Object.keys(patch).some((k) => k.endsWith('Path'))) app().refreshTools(true)
  }

  switch (id) {
    case 'general':
      return (
        <>
          <Group>
            <Row label="Reopen last project on startup" hint="Strata restores the workspace you used last.">
              <Toggle checked={s.restoreLastProject} onChange={(v) => set({ restoreLastProject: v })} />
            </Row>
            <Row label="Ask before removing a project" hint="Removing never deletes files — it only takes the folder off the list.">
              <Toggle checked={s.confirmRemoveProject} onChange={(v) => set({ confirmRemoveProject: v })} />
            </Row>
          </Group>
          <Group title="Privacy">
            <div className="setting-note">
              Strata runs entirely on your computer. It never stores your Claude credentials and never sends project files anywhere itself — the only network traffic is what
              Claude Code CLI does with Anthropic’s services. Files are only read inside folders you add.
            </div>
          </Group>
          <Group title="Keyboard shortcuts">
            <div className="shortcuts">
              {[
                ['Open folder', 'Ctrl O'],
                ['Focus Claude', 'Ctrl L'],
                ['Toggle terminal', 'Ctrl `'],
                ['Toggle sidebar', 'Ctrl B'],
                ['Toggle workspace panel', 'Ctrl Shift B'],
                ['Source control', 'Ctrl Shift G'],
                ['Files', 'Ctrl Shift E'],
                ['Save file', 'Ctrl S'],
                ['Ask Claude about selection', 'Ctrl Shift L'],
                ['Settings', 'Ctrl ,']
              ].map(([a, k]) => (
                <div key={a} className="shortcut">
                  <span>{a}</span>
                  <kbd className="kbd">{k}</kbd>
                </div>
              ))}
            </div>
          </Group>
        </>
      )
    case 'appearance':
      return (
        <Group>
          <Row label="Theme">
            <div className="theme-picker">
              {(['dark', 'midnight', 'light'] as ThemeName[]).map((t) => (
                <button key={t} className={`theme-swatch theme-${t} ${s.theme === t ? 'is-active' : ''}`} onClick={() => set({ theme: t })}>
                  <span className="theme-preview">
                    <span />
                    <span />
                  </span>
                  <span className="theme-name">{t[0].toUpperCase() + t.slice(1)}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row label="Accent color">
            <div className="accent-picker">
              {ACCENTS.map((c) => (
                <button key={c} className={`accent-swatch ${s.accent === c ? 'is-active' : ''}`} style={{ background: c }} onClick={() => set({ accent: c })} aria-label={c} />
              ))}
            </div>
          </Row>
          <Row label="Interface scale">
            <Select
              value={String(s.uiScale)}
              options={['0.9', '1', '1.1', '1.25'].map((v) => ({ value: v, label: `${Math.round(Number(v) * 100)}%` }))}
              onChange={(v) => set({ uiScale: Number(v) })}
              width={120}
            />
          </Row>
        </Group>
      )
    case 'claude':
      return (
        <>
          <Group title="Claude Code CLI">
            <Row label="Path" hint="Leave empty to auto-detect from PATH and the usual install locations.">
              <PathField tool="claude" value={s.claudePath} onChange={(v) => set({ claudePath: v })} />
            </Row>
            <Row label="Authentication" hint="Strata uses Claude Code’s existing login. It never asks for or stores your password.">
              <div className="inline-gap">
                <span className={`auth-state ${tools?.claudeAuth.loggedIn ? 'is-ok' : 'is-missing'}`}>
                  {tools?.claudeAuth.loggedIn ? `Signed in · ${tools.claudeAuth.method ?? ''}` : tools?.claudeAuth.loggedIn === false ? 'Not signed in' : 'Unknown'}
                </span>
                <Button size="sm" variant="secondary" onClick={() => (app().openSettings(null), openClaudeInTerminal())}>
                  Open Claude Code
                </Button>
              </div>
            </Row>
          </Group>
          <Group title="Defaults">
            <Row label="Permission mode" hint="Can be changed per conversation from the message box.">
              <Select<PermissionMode>
                value={s.permissionMode}
                width={200}
                options={[
                  { value: 'ask', label: 'Ask first', description: 'Approve every edit and command' },
                  { value: 'acceptEdits', label: 'Accept edits', description: 'Edits apply for review; commands ask' },
                  { value: 'plan', label: 'Plan mode', description: 'Read-only exploration and planning' },
                  { value: 'bypassPermissions', label: 'Bypass permissions', description: 'Never ask (dangerous)' }
                ]}
                onChange={(v) => set({ permissionMode: v })}
              />
            </Row>
            <Row label="Model" hint="Passed to Claude Code as --model. Default uses your Claude Code configuration.">
              <Select
                value={s.model}
                width={200}
                options={[
                  { value: '', label: 'Default' },
                  { value: 'opus', label: 'Opus' },
                  { value: 'sonnet', label: 'Sonnet' },
                  { value: 'haiku', label: 'Haiku' }
                ]}
                onChange={(v) => set({ model: v })}
              />
            </Row>
            <Row label="Stream responses" hint="Show Claude’s text as it is being written.">
              <Toggle checked={s.streamPartialMessages} onChange={(v) => set({ streamPartialMessages: v })} />
            </Row>
          </Group>
        </>
      )
    case 'terminal':
      return (
        <Group>
          <Row label="Shell" hint="Windows uses PowerShell by default.">
            <Select
              value={s.shell}
              width={240}
              options={[{ value: '', label: 'Default (PowerShell)' }, ...(tools?.shells ?? []).map((x) => ({ value: x.path, label: x.label, description: x.path }))]}
              onChange={(v) => set({ shell: v })}
            />
          </Row>
          <Row label="Font size">
            <NumberField value={s.terminalFontSize} min={9} max={24} onChange={(v) => set({ terminalFontSize: v })} />
          </Row>
        </Group>
      )
    case 'editor':
      return (
        <Group>
          <Row label="Editor" hint="Monaco — the editor that powers VS Code.">
            <span className="setting-static">Monaco</span>
          </Row>
          <Row label="Font size">
            <NumberField value={s.editorFontSize} min={9} max={28} onChange={(v) => set({ editorFontSize: v })} />
          </Row>
          <Row label="Tab size">
            <NumberField value={s.editorTabSize} min={1} max={8} onChange={(v) => set({ editorTabSize: v })} />
          </Row>
          <Row label="Word wrap">
            <Toggle checked={s.editorWordWrap} onChange={(v) => set({ editorWordWrap: v })} />
          </Row>
          <Row label="Minimap">
            <Toggle checked={s.editorMinimap} onChange={(v) => set({ editorMinimap: v })} />
          </Row>
        </Group>
      )
    case 'projects':
      return (
        <Group title={`${projects.length} project${projects.length === 1 ? '' : 's'}`}>
          {projects.map((p) => (
            <div key={p.id} className="project-setting">
              <ProjectGlyph project={p} size={26} />
              <div className="project-setting-text">
                <div>{p.name}</div>
                <div className="setting-hint mono">{tildify(p.path)}</div>
                {!!p.allowedTools?.length && (
                  <div className="rules">
                    {p.allowedTools.map((r) => (
                      <span key={r} className="rule-chip">
                        {r}
                        <button onClick={() => app().updateProject(p.id, { allowedTools: p.allowedTools!.filter((x) => x !== r) })}>
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="setting-hint">{timeAgo(p.lastOpenedAt)}</span>
              <Button size="sm" variant="ghost" onClick={() => app().removeProject(p.id)}>
                Remove
              </Button>
            </div>
          ))}
          {!projects.length && <div className="setting-note">No projects yet.</div>}
        </Group>
      )
    case 'roblox':
      return (
        <Group>
          <Row label="Roblox Studio" hint="Auto-detected from %LOCALAPPDATA%\Roblox\Versions.">
            <PathField tool="roblox" value={s.robloxStudioPath} onChange={(v) => set({ robloxStudioPath: v })} />
          </Row>
          <Row label="Rojo" hint="Found on PATH or in Aftman / Rokit / Foreman bin folders.">
            <PathField tool="rojo" value={s.rojoPath} onChange={(v) => set({ rojoPath: v })} />
          </Row>
          <div className="setting-note">
            Roblox projects (.rbxl, .rbxlx, default.project.json, src/ with ReplicatedStorage, ServerScriptService, StarterPlayer, StarterGui…) are detected automatically. Claude
            Code edits your Luau sources on disk; use Rojo to sync them into Studio.
          </div>
        </Group>
      )
    case 'blender':
      return (
        <Group>
          <Row label="Blender" hint="Auto-detected from Program Files\Blender Foundation and Steam.">
            <PathField tool="blender" value={s.blenderPath} onChange={(v) => set({ blenderPath: v })} />
          </Row>
          <div className="setting-note">
            Folders with .blend files are detected as Blender projects. Claude Code works with the project’s Python scripts and files; Strata opens Blender alongside it.
            Integrations such as a Blender MCP server can be configured in Claude Code itself (<span className="mono">claude mcp add</span>) and will be used automatically.
          </div>
        </Group>
      )
    case 'git':
      return (
        <Group>
          <Row label="Git executable">
            <PathField tool="git" value={s.gitPath} onChange={(v) => set({ gitPath: v })} />
          </Row>
          <Row label="Refresh automatically" hint="Update the Git panel when files change on disk.">
            <Toggle checked={s.gitAutoRefresh} onChange={(v) => set({ gitAutoRefresh: v })} />
          </Row>
        </Group>
      )
    default:
      return null
  }
}

function NumberField({ value, min, max, onChange }: { value: number; min: number; max: number; onChange(v: number): void }): JSX.Element {
  return (
    <div className="number-field">
      <button onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span>{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  )
}

export function SettingsModal(): JSX.Element | null {
  const section = useApp((s) => s.settingsOpen)
  const app = useApp.getState
  useEffect(() => {
    if (!section) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') app().openSettings(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [section])
  if (!section) return null
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && app().openSettings(null)}>
      <div className="settings">
        <nav className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`settings-nav-item ${s.id === section ? 'is-active' : ''}`} onClick={() => app().openSettings(s.id)}>
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          <div className="settings-head">
            <h2>{current.label}</h2>
            <IconButton tip="Close (Esc)" onClick={() => app().openSettings(null)}>
              <X size={16} />
            </IconButton>
          </div>
          <div className="settings-scroll">
            <Section id={current.id} />
          </div>
        </div>
      </div>
    </div>
  )
}
