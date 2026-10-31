import { DEFAULT_SETTINGS, type Settings } from '@shared/types'
import { JsonStore } from './store'

let store: JsonStore<Settings> | null = null

function s(): JsonStore<Settings> {
  if (!store) store = new JsonStore<Settings>('settings', DEFAULT_SETTINGS)
  return store
}

export function getSettings(): Settings {
  return s().get()
}

export function updateSettings(patch: Partial<Settings>): Settings {
  return s().set({ ...s().get(), ...patch })
}

export function flushSettings(): void {
  store?.flush()
}
