import type { Project } from '@shared/types'
import { useApp } from '@/store/app'

const KIND_COLORS: Record<string, string> = {
  roblox: '#e5534b',
  rojo: '#e5534b',
  blender: '#ea7600',
  node: '#3ecf8e',
  python: '#4b8bbe',
  csharp: '#9b4f96',
  unity: '#9aa0ab',
  web: '#e34c26',
  rust: '#dea584',
  go: '#00add8',
  lua: '#4f7cff'
}

function hashColor(s: string): string {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 45% 55%)`
}

/** Small rounded monogram tinted by project type. */
export function ProjectGlyph({ project, size = 22 }: { project: Project; size?: number }): JSX.Element {
  const info = useApp((s) => s.infos[project.path])
  const kind = info?.kinds.find((k) => k !== 'git')
  const color = (kind && KIND_COLORS[kind]) || hashColor(project.name)
  const letter = (project.name.match(/[A-Za-z0-9]/)?.[0] ?? '?').toUpperCase()
  return (
    <span
      className="project-glyph"
      style={{ width: size, height: size, fontSize: size * 0.5, color, background: `color-mix(in srgb, ${color} 16%, transparent)`, borderColor: `color-mix(in srgb, ${color} 30%, transparent)` }}
    >
      {letter}
    </span>
  )
}
