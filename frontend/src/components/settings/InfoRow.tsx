import { Pencil } from 'lucide-react'

interface InfoRowProps {
  label: string
  value: string
  editable?: boolean
  onEdit?: () => void
}

/** A single labelled field row: mono value + hover-revealed edit icon. */
export function InfoRow({ label, value, editable = false, onEdit }: InfoRowProps) {
  return (
    <div className="stk-field">
      <div style={{ minWidth: 0 }}>
        <div className="stk-field__label">{label}</div>
        <div className="stk-field__value">{value}</div>
      </div>
      {editable && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${label}`}
          className="stk-field__edit"
        >
          <Pencil size={15} />
        </button>
      )}
    </div>
  )
}
