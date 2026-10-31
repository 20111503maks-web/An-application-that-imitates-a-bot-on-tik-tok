import { useRef } from 'react'

interface ResizerProps {
  direction: 'x' | 'y'
  /** Called with the pointer delta since drag start. */
  onResize(delta: number): void
  onEnd?(): void
  onStart?(): void
  className?: string
}

export function Resizer({ direction, onResize, onEnd, onStart, className = '' }: ResizerProps): JSX.Element {
  const start = useRef(0)
  return (
    <div
      className={`resizer resizer-${direction} ${className}`}
      onPointerDown={(e) => {
        e.preventDefault()
        start.current = direction === 'x' ? e.clientX : e.clientY
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        document.body.classList.add(direction === 'x' ? 'is-resizing-x' : 'is-resizing-y')
        onStart?.()
      }}
      onPointerMove={(e) => {
        if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId)) return
        onResize((direction === 'x' ? e.clientX : e.clientY) - start.current)
      }}
      onPointerUp={(e) => {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
        document.body.classList.remove('is-resizing-x', 'is-resizing-y')
        onEnd?.()
      }}
    />
  )
}
