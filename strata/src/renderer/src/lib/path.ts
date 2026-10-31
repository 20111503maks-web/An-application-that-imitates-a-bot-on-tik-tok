// Path helpers that work with both Windows (\) and POSIX (/) separators.

export const sepOf = (p: string): string => (p.includes('\\') && !p.includes('/') ? '\\' : p.includes('\\') ? '\\' : '/')

export function basename(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  if (idx <= 0) return p
  const d = p.slice(0, idx)
  return /^[a-zA-Z]:$/.test(d) ? d + '\\' : d
}

export function join(...parts: string[]): string {
  const sep = sepOf(parts[0] ?? '')
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join(sep)
    .replace(/[\\/]/g, sep)
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
const ci = (): boolean => window.strata?.platform !== 'linux'

export function samePath(a: string, b: string): boolean {
  return ci() ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

export function isInside(root: string, p: string): boolean {
  const r = norm(root)
  const c = norm(p)
  if (ci()) return c.toLowerCase() === r.toLowerCase() || c.toLowerCase().startsWith(r.toLowerCase() + '/')
  return c === r || c.startsWith(r + '/')
}

/** Path relative to root using forward slashes (for display and @mentions). */
export function relative(root: string, p: string): string {
  if (!isInside(root, p)) return p
  return norm(p).slice(norm(root).length).replace(/^\//, '')
}

export function extname(p: string): string {
  const b = basename(p)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i).toLowerCase() : ''
}

export function tildify(p: string): string {
  const home = window.strata?.homeDir
  if (home && isInside(home, p)) return '~' + (sepOf(p)) + relative(home, p).replace(/\//g, sepOf(p))
  return p
}
