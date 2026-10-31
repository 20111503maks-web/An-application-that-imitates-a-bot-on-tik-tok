type Listener = (e: { root: string; paths: string[] }) => void

const listeners = new Set<Listener>()
let wired = false

/** Fan-out of filesystem watcher events to explorer, editors, git and changes panels. */
export function onFsChange(fn: Listener): () => void {
  if (!wired) {
    wired = true
    window.strata.fs.onChanged((e) => listeners.forEach((l) => l(e)))
  }
  listeners.add(fn)
  return () => listeners.delete(fn)
}
