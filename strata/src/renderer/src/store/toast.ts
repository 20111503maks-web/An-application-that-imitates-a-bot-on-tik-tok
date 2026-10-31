import { create } from 'zustand'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  title: string
  detail?: string
}

interface ToastState {
  toasts: Toast[]
  push(t: Omit<Toast, 'id'>): void
  dismiss(id: number): void
}

let seq = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push(t) {
    const id = seq++
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] })
    setTimeout(() => get().dismiss(id), t.kind === 'error' ? 7000 : 3500)
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  }
}))

export const toast = {
  info: (title: string, detail?: string) => useToasts.getState().push({ kind: 'info', title, detail }),
  success: (title: string, detail?: string) => useToasts.getState().push({ kind: 'success', title, detail }),
  error: (title: string, detail?: string) => useToasts.getState().push({ kind: 'error', title, detail })
}
