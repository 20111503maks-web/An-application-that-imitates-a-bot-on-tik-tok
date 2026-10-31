import { useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { Button } from './Button'

interface DialogRequest {
  kind: 'confirm' | 'prompt'
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
  defaultValue?: string
  placeholder?: string
  selectStem?: boolean
  resolve(value: string | boolean | null): void
}

const useDialog = create<{ req: DialogRequest | null; set(r: DialogRequest | null): void }>((set) => ({
  req: null,
  set: (req) => set({ req })
}))

export function confirmDialog(opts: Omit<DialogRequest, 'kind' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useDialog.getState().set({ ...opts, kind: 'confirm', resolve: (v) => resolve(v === true) }))
}

export function promptDialog(opts: Omit<DialogRequest, 'kind' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => useDialog.getState().set({ ...opts, kind: 'prompt', resolve: (v) => resolve(typeof v === 'string' ? v : null) }))
}

export function DialogHost(): JSX.Element | null {
  const { req, set } = useDialog()
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!req) return
    setValue(req.defaultValue ?? '')
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      const v = req.defaultValue ?? ''
      const dot = v.lastIndexOf('.')
      if (req.selectStem && dot > 0) el.setSelectionRange(0, dot)
      else el.select()
    })
  }, [req])

  if (!req) return null
  const close = (v: string | boolean | null): void => {
    req.resolve(v)
    set(null)
  }
  const submit = (): void => close(req.kind === 'prompt' ? (value.trim() ? value.trim() : null) : true)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
      <div
        className="dialog"
        onKeyDown={(e) => {
          if (e.key === 'Escape') close(null)
          if (e.key === 'Enter' && req.kind === 'confirm') submit()
        }}
        tabIndex={-1}
        ref={(el) => {
          if (el && req.kind === 'confirm') el.focus()
        }}
      >
        <div className="dialog-title">{req.title}</div>
        {req.message && <div className="dialog-message">{req.message}</div>}
        {req.kind === 'prompt' && (
          <input
            ref={inputRef}
            className="input"
            value={value}
            placeholder={req.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        )}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button variant={req.danger ? 'danger' : 'primary'} onClick={submit}>
            {req.confirmLabel ?? 'OK'}
          </Button>
        </div>
      </div>
    </div>
  )
}
