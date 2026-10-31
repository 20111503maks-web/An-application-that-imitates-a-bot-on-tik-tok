import { AlertTriangle, Check } from 'lucide-react'
import { useApp } from '@/store/app'
import { Logo } from './Logo'

export function SetupOverlay(): JSX.Element | null {
  const setup = useApp((s) => s.setup)
  if (!setup) return null
  return (
    <div className="setup-backdrop">
      <div className="setup-card">
        <div className="setup-head">
          <Logo size={22} />
          <div>
            <div className="setup-title">Opening {setup.projectName}</div>
            <div className="setup-sub">Preparing your workspace</div>
          </div>
        </div>
        <ol className="setup-steps">
          {setup.steps.map((s, i) => (
            <li key={i} className={`setup-step is-${s.state}`}>
              <span className="setup-icon">
                {s.state === 'done' ? <Check size={12} strokeWidth={3} /> : s.state === 'warn' ? <AlertTriangle size={12} /> : s.state === 'running' ? <span className="spinner" /> : null}
              </span>
              <span className="setup-label">{s.label}</span>
              {s.detail && <span className="setup-detail">{s.detail}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
