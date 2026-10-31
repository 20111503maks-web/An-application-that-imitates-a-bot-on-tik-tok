import { shell } from 'electron'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { copyFile, cp, mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, sep } from 'node:path'
import type { DirEntry, FileContent } from '@shared/types'
import { assertAllowed, isInside } from './paths'

const MAX_TEXT_BYTES = 8 * 1024 * 1024
const HIDDEN = new Set(['.git', '.DS_Store', 'Thumbs.db', 'desktop.ini'])

export async function readDirectory(path: string): Promise<DirEntry[]> {
  const dir = assertAllowed(path)
  const entries = await readdir(dir, { withFileTypes: true })
  const out: DirEntry[] = []
  for (const e of entries) {
    if (HIDDEN.has(e.name)) continue
    const full = join(dir, e.name)
    let isDir = e.isDirectory()
    const isSymlink = e.isSymbolicLink()
    if (isSymlink) {
      try {
        isDir = (await stat(full)).isDirectory()
      } catch {
        /* broken link */
      }
    }
    out.push({ name: e.name, path: full, isDir, isSymlink })
  }
  out.sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })))
  return out
}

const BINARY_EXT = new Set(
  '.png .jpg .jpeg .gif .bmp .ico .webp .tga .psd .blend .blend1 .rbxl .rbxm .fbx .obj .glb .gltf .exe .dll .so .dylib .zip .7z .rar .gz .tar .pdf .mp3 .wav .ogg .mp4 .mov .avi .ttf .otf .woff .woff2 .pyc .class .jar .bin .dat .db .sqlite .exr .hdr .dds .ktx .mesh .rbxmx_bin'.split(' ')
)

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export async function readTextFile(path: string): Promise<FileContent> {
  const file = assertAllowed(path)
  const st = await stat(file)
  const base: FileContent = { path: file, content: '', binary: false, tooLarge: false, size: st.size, mtime: st.mtimeMs }
  if (BINARY_EXT.has(extname(file).toLowerCase())) return { ...base, binary: true }
  if (st.size > MAX_TEXT_BYTES) return { ...base, tooLarge: true }
  const buf = await readFile(file)
  if (looksBinary(buf)) return { ...base, binary: true }
  return { ...base, content: buf.toString('utf8') }
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  const file = assertAllowed(path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

export async function createFile(path: string): Promise<void> {
  const file = assertAllowed(path)
  if (existsSync(file)) throw new Error(`${basename(file)} already exists`)
  await mkdir(dirname(file), { recursive: true })
  const fh = await open(file, 'wx')
  await fh.close()
}

export async function createDir(path: string): Promise<void> {
  const dir = assertAllowed(path)
  if (existsSync(dir)) throw new Error(`${basename(dir)} already exists`)
  await mkdir(dir, { recursive: true })
}

export async function renamePath(from: string, to: string): Promise<void> {
  const a = assertAllowed(from)
  const b = assertAllowed(to)
  if (a === b) return
  // Allow case-only renames on case-insensitive filesystems.
  if (existsSync(b) && a.toLowerCase() !== b.toLowerCase()) throw new Error(`${basename(b)} already exists`)
  await rename(a, b)
}

/** Moves to the OS recycle bin — never a hard delete. */
export async function trashPath(path: string): Promise<void> {
  const p = assertAllowed(path)
  await shell.trashItem(p)
}

function uniqueTarget(dir: string, name: string): string {
  let target = join(dir, name)
  if (!existsSync(target)) return target
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 1; i < 1000; i++) {
    target = join(dir, `${stem} copy${i > 1 ? ' ' + i : ''}${ext}`)
    if (!existsSync(target)) return target
  }
  throw new Error('Could not find a free file name')
}

export async function movePath(from: string, toDir: string): Promise<string> {
  const src = assertAllowed(from)
  const dir = assertAllowed(toDir)
  if (isInside(src, dir)) throw new Error('Cannot move a folder into itself')
  if (dirname(src) === dir) return src
  const target = join(dir, basename(src))
  if (existsSync(target)) throw new Error(`${basename(src)} already exists in the target folder`)
  await rename(src, target)
  return target
}

/** Copies external files/folders (e.g. dropped from Windows Explorer) into a project folder. */
export async function copyInto(sources: string[], toDir: string): Promise<string[]> {
  const dir = assertAllowed(toDir)
  const out: string[] = []
  for (const src of sources) {
    if (!src || !existsSync(src)) continue
    if (isInside(src, dir)) continue
    const target = uniqueTarget(dir, basename(src))
    const st = await stat(src)
    if (st.isDirectory()) await cp(src, target, { recursive: true, errorOnExist: true })
    else await copyFile(src, target)
    out.push(target)
  }
  return out
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    return existsSync(assertAllowed(path))
  } catch {
    return false
  }
}

// ------------------------------------------------------------- watching

const IGNORED_SEGMENTS = ['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build', 'out', '.next', 'target']

function ignored(rel: string): boolean {
  const parts = rel.split(/[\\/]/)
  // Let .git/HEAD and .git/index through so the Git panel refreshes after commits/checkouts.
  if (parts[0] === '.git') return !(parts.length === 2 && (parts[1] === 'HEAD' || parts[1] === 'index'))
  return parts.some((p) => IGNORED_SEGMENTS.includes(p))
}

interface WatchEntry {
  watcher: FSWatcher
  refs: number
  pending: Set<string>
  timer: NodeJS.Timeout | null
}

const watchers = new Map<string, WatchEntry>()

export function watchRoot(root: string, emit: (root: string, paths: string[]) => void): void {
  const dir = assertAllowed(root)
  const existing = watchers.get(dir)
  if (existing) {
    existing.refs++
    return
  }
  let watcher: FSWatcher
  try {
    // Recursive watching is native on Windows/macOS and supported on Linux by Node 20+.
    watcher = watch(dir, { recursive: true, persistent: false })
  } catch (err) {
    console.warn('[fs] watch failed for', dir, err)
    return
  }
  const entry: WatchEntry = { watcher, refs: 1, pending: new Set(), timer: null }
  watcher.on('change', (_type, filename) => {
    if (!filename) return
    const rel = String(filename)
    if (ignored(rel)) return
    entry.pending.add(join(dir, rel.split('/').join(sep)))
    if (entry.timer) return
    entry.timer = setTimeout(() => {
      entry.timer = null
      const paths = [...entry.pending]
      entry.pending.clear()
      emit(dir, paths.slice(0, 500))
    }, 200)
  })
  watcher.on('error', (err) => console.warn('[fs] watcher error', dir, err))
  watchers.set(dir, entry)
}

export function unwatchRoot(root: string): void {
  for (const [dir, entry] of watchers) {
    if (dir !== root && dir !== assertAllowedSafe(root)) continue
    entry.refs--
    if (entry.refs <= 0) {
      entry.watcher.close()
      if (entry.timer) clearTimeout(entry.timer)
      watchers.delete(dir)
    }
  }
}

function assertAllowedSafe(p: string): string {
  try {
    return assertAllowed(p)
  } catch {
    return p
  }
}

export function closeAllWatchers(): void {
  for (const entry of watchers.values()) entry.watcher.close()
  watchers.clear()
}
