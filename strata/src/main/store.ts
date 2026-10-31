import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Tiny JSON file store living in the app's userData folder.
 * Writes are debounced and atomic (write temp file + rename) so a crash
 * can never leave a half-written settings file behind.
 */
export class JsonStore<T extends object> {
  private data: T
  private timer: NodeJS.Timeout | null = null
  readonly file: string

  constructor(name: string, private defaults: T) {
    this.file = join(app.getPath('userData'), `${name}.json`)
    this.data = this.load()
  }

  private load(): T {
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
        if (Array.isArray(this.defaults)) return (Array.isArray(parsed) ? parsed : this.defaults) as T
        return { ...this.defaults, ...parsed }
      }
    } catch (err) {
      console.error(`[store] failed to read ${this.file}`, err)
    }
    return structuredClone(this.defaults)
  }

  get(): T {
    return this.data
  }

  set(next: T): T {
    this.data = next
    this.scheduleSave()
    return this.data
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 150)
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (err) {
      console.error(`[store] failed to write ${this.file}`, err)
    }
  }
}
