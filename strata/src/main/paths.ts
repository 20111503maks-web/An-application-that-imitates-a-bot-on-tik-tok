import { relative, resolve, isAbsolute } from 'node:path'

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'

export function normalizeForCompare(p: string): string {
  const r = resolve(p)
  return caseInsensitive ? r.toLowerCase() : r
}

/** True if `child` is `root` itself or lives somewhere below it. */
export function isInside(root: string, child: string): boolean {
  const rel = relative(normalizeForCompare(root), normalizeForCompare(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

let rootsProvider: () => string[] = () => []

export function setAllowedRootsProvider(fn: () => string[]): void {
  rootsProvider = fn
}

/**
 * Every filesystem/git/terminal operation requested by the renderer must stay
 * inside one of the folders the user explicitly added as a project.
 */
export function assertAllowed(p: string): string {
  if (typeof p !== 'string' || !p) throw new Error('Invalid path')
  const abs = resolve(p)
  if (!rootsProvider().some((root) => isInside(root, abs))) {
    throw new Error(`Access denied: ${abs} is outside of your projects`)
  }
  return abs
}
