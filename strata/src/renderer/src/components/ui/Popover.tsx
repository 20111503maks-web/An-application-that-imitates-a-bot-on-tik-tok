import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface PopoverProps {
  anchor: HTMLElement | null
  open: boolean
  onClose(): void
  children: ReactNode
  align?: 'start' | 'end' | 'center'
  side?: 'bottom' | 'top'
  offset?: number
  className?: string
  matchWidth?: boolean
}

/** Floating layer anchored to an element; closes on outside click / Escape. */
export function Popover({ anchor, open, onClose, children, align = 'start', side = 'bottom', offset = 6, className = '', matchWidth }: PopoverProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; minWidth?: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor) return
    const place = (): void => {
      const r = anchor.getBoundingClientRect()
      const el = ref.current
      const w = el?.offsetWidth ?? 200
      const h = el?.offsetHeight ?? 100
      let left = align === 'start' ? r.left : align === 'end' ? r.right - w : r.left + r.width / 2 - w / 2
      let top = side === 'bottom' ? r.bottom + offset : r.top - h - offset
      if (side === 'bottom' && top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - offset)
      if (side === 'top' && top < 8) top = r.bottom + offset
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      setPos({ left, top, minWidth: matchWidth ? r.width : undefined })
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
    }
  }, [open, anchor, align, side, offset, matchWidth])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, anchor, onClose])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      className={`popover ${side === 'top' ? 'from-top' : ''} ${className}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, minWidth: pos?.minWidth, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body
  )
}
