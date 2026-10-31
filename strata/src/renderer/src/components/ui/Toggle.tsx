interface ToggleProps {
  checked: boolean
  onChange(v: boolean): void
  disabled?: boolean
}

export function Toggle({ checked, onChange, disabled }: ToggleProps): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`toggle ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  )
}
