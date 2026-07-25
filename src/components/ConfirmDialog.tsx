import { useEffect, useRef, type KeyboardEvent } from 'react'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm(): void
  onCancel(): void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelButtonRef.current?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    if (event.shiftKey && document.activeElement === cancelButtonRef.current) {
      event.preventDefault()
      confirmButtonRef.current?.focus()
    } else if (!event.shiftKey && document.activeElement === confirmButtonRef.current) {
      event.preventDefault()
      cancelButtonRef.current?.focus()
    }
  }

  return (
    <div className="confirmation-backdrop" onKeyDown={handleKeyDown}>
      <section
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-message"
      >
        <h2 id="confirmation-title">{title}</h2>
        <p id="confirmation-message">{message}</p>
        <div className="confirmation-actions">
          <button ref={cancelButtonRef} type="button" className="command-button" aria-label={cancelLabel} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button ref={confirmButtonRef} type="button" className="command-button primary" aria-label={confirmLabel} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
