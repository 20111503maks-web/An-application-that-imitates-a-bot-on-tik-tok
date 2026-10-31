import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useToasts } from '@/store/toast'

export function Toasts(): JSX.Element {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span className="toast-icon">
            {t.kind === 'success' ? <CheckCircle2 size={15} /> : t.kind === 'error' ? <AlertCircle size={15} /> : <Info size={15} />}
          </span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.detail && <div className="toast-detail">{t.detail}</div>}
          </div>
          <button className="toast-close" onClick={() => dismiss(t.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
