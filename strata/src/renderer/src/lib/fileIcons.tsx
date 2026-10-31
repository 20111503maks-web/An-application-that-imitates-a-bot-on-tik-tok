import {
  Box,
  Braces,
  Database,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  Gamepad2,
  GitBranch,
  Lock,
  Package,
  Palette,
  ScrollText,
  Settings2,
  Terminal
} from 'lucide-react'
import type { ReactNode } from 'react'
import { extname } from './path'

interface IconSpec {
  icon: (size: number) => ReactNode
  color: string
}

const spec = (Icon: typeof File, color: string): IconSpec => ({ icon: (size) => <Icon size={size} strokeWidth={1.75} />, color })

const BY_NAME: Record<string, IconSpec> = {
  'package.json': spec(Package, '#e5534b'),
  'package-lock.json': spec(Lock, '#8b8d98'),
  'pnpm-lock.yaml': spec(Lock, '#8b8d98'),
  'yarn.lock': spec(Lock, '#8b8d98'),
  'default.project.json': spec(Gamepad2, '#e5534b'),
  'aftman.toml': spec(Settings2, '#9aa0ab'),
  'rokit.toml': spec(Settings2, '#9aa0ab'),
  'wally.toml': spec(Package, '#d29922'),
  '.gitignore': spec(GitBranch, '#f0883e'),
  '.gitattributes': spec(GitBranch, '#f0883e'),
  'readme.md': spec(ScrollText, '#6aa8ff'),
  'claude.md': spec(ScrollText, 'var(--accent)'),
  dockerfile: spec(Box, '#2496ed'),
  '.env': spec(Lock, '#e5b454'),
  'requirements.txt': spec(Package, '#3572a5'),
  'pyproject.toml': spec(Package, '#3572a5')
}

const BY_EXT: Record<string, IconSpec> = {
  '.ts': spec(FileCode2, '#3178c6'),
  '.tsx': spec(FileCode2, '#3178c6'),
  '.js': spec(FileCode2, '#e5c84f'),
  '.jsx': spec(FileCode2, '#e5c84f'),
  '.mjs': spec(FileCode2, '#e5c84f'),
  '.cjs': spec(FileCode2, '#e5c84f'),
  '.lua': spec(FileCode2, '#4f7cff'),
  '.luau': spec(FileCode2, '#00a2ff'),
  '.py': spec(FileCode2, '#4b8bbe'),
  '.cs': spec(FileCode2, '#9b4f96'),
  '.rs': spec(FileCode2, '#dea584'),
  '.go': spec(FileCode2, '#00add8'),
  '.java': spec(FileCode2, '#b07219'),
  '.cpp': spec(FileCode2, '#f34b7d'),
  '.c': spec(FileCode2, '#8b8d98'),
  '.h': spec(FileCode2, '#8b8d98'),
  '.html': spec(FileCode2, '#e34c26'),
  '.css': spec(Palette, '#563d7c'),
  '.scss': spec(Palette, '#c6538c'),
  '.json': spec(FileJson, '#e5b454'),
  '.jsonc': spec(FileJson, '#e5b454'),
  '.toml': spec(Settings2, '#9aa0ab'),
  '.yaml': spec(Settings2, '#cb171e'),
  '.yml': spec(Settings2, '#cb171e'),
  '.xml': spec(Braces, '#8b8d98'),
  '.md': spec(ScrollText, '#6aa8ff'),
  '.mdx': spec(ScrollText, '#6aa8ff'),
  '.txt': spec(FileText, '#8b8d98'),
  '.sh': spec(Terminal, '#89e051'),
  '.ps1': spec(Terminal, '#5391fe'),
  '.bat': spec(Terminal, '#c1f12e'),
  '.cmd': spec(Terminal, '#c1f12e'),
  '.blend': spec(Box, '#ea7600'),
  '.blend1': spec(Box, '#8b5a2b'),
  '.fbx': spec(Box, '#8b8d98'),
  '.obj': spec(Box, '#8b8d98'),
  '.glb': spec(Box, '#8b8d98'),
  '.gltf': spec(Box, '#8b8d98'),
  '.rbxl': spec(Gamepad2, '#e5534b'),
  '.rbxlx': spec(Gamepad2, '#e5534b'),
  '.rbxm': spec(Gamepad2, '#e5534b'),
  '.rbxmx': spec(Gamepad2, '#e5534b'),
  '.png': spec(FileImage, '#a074c4'),
  '.jpg': spec(FileImage, '#a074c4'),
  '.jpeg': spec(FileImage, '#a074c4'),
  '.gif': spec(FileImage, '#a074c4'),
  '.svg': spec(FileImage, '#ffb13b'),
  '.webp': spec(FileImage, '#a074c4'),
  '.tga': spec(FileImage, '#a074c4'),
  '.ico': spec(FileImage, '#a074c4'),
  '.mp3': spec(FileAudio, '#3ecf8e'),
  '.wav': spec(FileAudio, '#3ecf8e'),
  '.ogg': spec(FileAudio, '#3ecf8e'),
  '.mp4': spec(FileVideo, '#f0616d'),
  '.mov': spec(FileVideo, '#f0616d'),
  '.zip': spec(FileArchive, '#9aa0ab'),
  '.7z': spec(FileArchive, '#9aa0ab'),
  '.rar': spec(FileArchive, '#9aa0ab'),
  '.db': spec(Database, '#9aa0ab'),
  '.sqlite': spec(Database, '#9aa0ab'),
  '.sql': spec(Database, '#e38c00')
}

const DEFAULT = spec(File, '#8b8d98')

export function FileIcon({ name, size = 15 }: { name: string; size?: number }): JSX.Element {
  const s = BY_NAME[name.toLowerCase()] ?? BY_EXT[extname(name)] ?? DEFAULT
  return (
    <span className="file-icon" style={{ color: s.color }}>
      {s.icon(size)}
    </span>
  )
}

const SPECIAL_DIRS: Record<string, string> = {
  src: '#6aa8ff',
  scripts: '#3ecf8e',
  assets: '#e5b454',
  models: '#ea7600',
  textures: '#a074c4',
  references: '#9aa0ab',
  replicatedstorage: '#00a2ff',
  serverscriptservice: '#3ecf8e',
  starterplayer: '#e5b454',
  startergui: '#b18cff',
  test: '#f0616d',
  tests: '#f0616d',
  docs: '#6aa8ff',
  '.claude': 'var(--accent)',
  '.github': '#9aa0ab',
  node_modules: '#5b5c64'
}

export function FolderIcon({ name, open, size = 15 }: { name: string; open?: boolean; size?: number }): JSX.Element {
  const color = SPECIAL_DIRS[name.toLowerCase()] ?? '#8a8f9c'
  const Icon = open ? FolderOpen : Folder
  return (
    <span className="file-icon" style={{ color }}>
      <Icon size={size} strokeWidth={1.75} />
    </span>
  )
}

export function languageFor(path: string): string {
  const ext = extname(path)
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.lua': 'luau',
    '.luau': 'luau',
    '.py': 'python',
    '.pyw': 'python',
    '.cs': 'csharp',
    '.csx': 'csharp',
    '.json': 'json',
    '.jsonc': 'json',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.xml': 'xml',
    '.rbxlx': 'xml',
    '.rbxmx': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'ini',
    '.ini': 'ini',
    '.cfg': 'ini',
    '.sh': 'shell',
    '.bash': 'shell',
    '.ps1': 'powershell',
    '.psm1': 'powershell',
    '.bat': 'bat',
    '.cmd': 'bat',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java',
    '.kt': 'kotlin',
    '.c': 'c',
    '.h': 'cpp',
    '.cpp': 'cpp',
    '.hpp': 'cpp',
    '.cc': 'cpp',
    '.sql': 'sql',
    '.php': 'php',
    '.rb': 'ruby',
    '.swift': 'swift',
    '.dart': 'dart',
    '.glsl': 'cpp',
    '.hlsl': 'cpp',
    '.shader': 'cpp',
    '.vue': 'html',
    '.svelte': 'html',
    '.svg': 'xml',
    '.dockerfile': 'dockerfile'
  }
  if (/dockerfile$/i.test(path)) return 'dockerfile'
  return map[ext] ?? 'plaintext'
}
