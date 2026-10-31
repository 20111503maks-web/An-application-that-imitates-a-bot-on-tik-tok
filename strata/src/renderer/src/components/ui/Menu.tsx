import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

export interface MenuItem {
  label?: string
  icon?: ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  onSelect?: () => void
}

export function MenuList({ items, onClose }: { items: MenuItem[]; onClose(): void }): JSX.Element {
  return (
    <div className="menu" role="menu">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`menu-item ${it.danger ? 'is-danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onSelect?.()
            }}
          >
            <span className="menu-icon">{it.icon}</span>
            <span className="menu-label">{it.label}</span>
            {it.hint && <span className="menu-hint">{it.hint}</span>}
          </button>
        )
      )}
    </div>
  )
}

interface ContextMenuState {
  menu: { x: number; y: number; items: MenuItem[] } | null
  open(x: number, y: number, items: MenuItem[]): void
  close(): void
}

export const useContextMenu = create<ContextMenuState>((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: { x, y, items } }),
  close: () => set({ menu: null })
}))

export function openContextMenu(e: React.MouseEvent, items: MenuItem[]): void {
  e.preventDefault()
  e.stopPropagation()
  useContextMenu.getState().open(e.clientX, e.clientY, items)
}

export function ContextMenuHost(): JSX.Element | null {
  const { menu, close } = useContextMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!menu) return setPos(null)
    const el = ref.current
    const w = el?.offsetWidth ?? 220
    const h = el?.offsetHeight ?? 200
    setPos({ x: Math.min(menu.x, window.innerWidth - w - 8), y: Math.min(menu.y, window.innerHeight - h - 8) })
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu, close])

  if (!menu) return null
  return createPortal(
    <div ref={ref} className="popover context-menu" style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}>
      <MenuList items={menu.items} onClose={close} />
    </div>,
    document.body
  )
}
