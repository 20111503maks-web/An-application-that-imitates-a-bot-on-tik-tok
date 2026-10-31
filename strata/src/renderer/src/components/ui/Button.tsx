import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: ReactNode
  kbd?: string
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, kbd, loading, children, className = '', disabled, ...rest },
  ref
) {
  return (
    <button ref={ref} className={`btn btn-${variant} btn-${size} ${loading ? 'is-loading' : ''} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" /> : icon}
      {children && <span className="btn-label">{children}</span>}
      {kbd && <kbd className="kbd">{kbd}</kbd>}
    </button>
  )
})

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tip?: string
  active?: boolean
  size?: 'xs' | 'sm' | 'md'
  tipSide?: 'bottom' | 'top' | 'left' | 'right'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { tip, active, size = 'sm', tipSide = 'bottom', className = '', children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={`icon-btn icon-btn-${size} ${active ? 'is-active' : ''} ${className}`}
      data-tip={tip}
      data-tip-side={tipSide}
      aria-label={tip}
      {...rest}
    >
      {children}
    </button>
  )
})
