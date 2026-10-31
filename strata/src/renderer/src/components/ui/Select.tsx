import { Check, ChevronDown } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Popover } from './Popover'

export interface SelectOption<T extends string> {
  value: T
  label: string
  description?: string
  icon?: ReactNode
}

interface SelectProps<T extends string> {
  value: T
  options: SelectOption<T>[]
  onChange(v: T): void
  className?: string
  compact?: boolean
  side?: 'top' | 'bottom'
  prefix?: ReactNode
  width?: number
}

export function Select<T extends string>({ value, options, onChange, className = '', compact, side = 'bottom', prefix, width }: SelectProps<T>): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <>
      <button ref={ref} className={`select ${compact ? 'select-compact' : ''} ${open ? 'is-open' : ''} ${className}`} onClick={() => setOpen((o) => !o)} style={width ? { width } : undefined}>
        {prefix}
        {current?.icon}
        <span className="select-value">{current?.label}</span>
        <ChevronDown size={13} className="select-chevron" />
      </button>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)} side={side} matchWidth={!compact}>
        <div className="menu">
          {options.map((o) => (
            <button
              key={o.value}
              className={`menu-item ${o.value === value ? 'is-selected' : ''}`}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span className="menu-icon">{o.icon}</span>
              <span className="menu-label">
                {o.label}
                {o.description && <span className="menu-desc">{o.description}</span>}
              </span>
              <span className="menu-check">{o.value === value && <Check size={13} />}</span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  )
}
