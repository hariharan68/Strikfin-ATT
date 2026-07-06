import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { EditableField } from './types'

/** Indian states + union territories for the State select. */
const INDIAN_STATES: readonly string[] = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]

interface EditFieldModalProps {
  open: boolean
  field: EditableField
  initialValue: string
  onCancel: () => void
  onSave: (value: string) => Promise<void>
}

/** Modal-based editor for the profile name / state (never inline).
 *  Self-contained overlay so it honours the settings design tokens. */
export function EditFieldModal({
  open,
  field,
  initialValue,
  onCancel,
  onSave,
}: EditFieldModalProps) {
  // Seeded from initialValue; the parent remounts (via `key`) per field.
  const [value, setValue] = useState(initialValue)
  const [saving, setSaving] = useState(false)

  // Close on Escape while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const isName = field === 'name'
  const label = isName ? 'Username' : 'State'
  const empty = value.trim().length === 0

  const handleSave = async () => {
    if (empty || saving) return
    setSaving(true)
    try {
      await onSave(value.trim())
      // Parent closes the modal on success.
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="stk-modal-overlay"
      role="presentation"
      onMouseDown={onCancel}
    >
      <div
        className="stk-modal"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="stk-modal__head">
          <span className="stk-modal__title">
            {isName ? 'Update Username' : 'Update State'}
          </span>
          <button
            type="button"
            className="stk-modal__close"
            aria-label="Close"
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        </div>

        <div className="stk-modal__body">
          <label className="stk-label">
            {label} <span className="stk-req">*</span>
          </label>
          {isName ? (
            <input
              type="text"
              className="stk-input"
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleSave()}
            />
          ) : (
            <select
              className="stk-select"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="" disabled>
                Select a state…
              </option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}

          <div className="stk-modal__actions">
            <button
              type="button"
              className="stk-btn stk-btn--primary"
              onClick={() => void handleSave()}
              disabled={empty || saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="stk-btn"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
