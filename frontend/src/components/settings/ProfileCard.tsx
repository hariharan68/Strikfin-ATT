import { useState } from 'react'
import { Crown } from 'lucide-react'
import { InfoRow } from './InfoRow'
import { EditFieldModal } from './EditFieldModal'
import type { EditableField, ProfileUser } from './types'

interface ProfileCardProps {
  user: ProfileUser
  onSave: (field: EditableField, value: string) => Promise<void>
}

/** Sticky sidebar profile card: avatar + plan badge, name, provider tag,
 *  and stacked field rows. Name & State edit via modal; email/phone read-only. */
export function ProfileCard({ user, onSave }: ProfileCardProps) {
  const [editingField, setEditingField] = useState<EditableField | null>(null)

  const initial = user.name.trim().charAt(0).toUpperCase() || '?'

  const handleSave = async (value: string) => {
    if (!editingField) return
    await onSave(editingField, value)
    setEditingField(null)
  }

  return (
    <div className="stk-card stk-profile">
      <div className="stk-profile__head">
        <div className="stk-avatar-wrap">
          <div className="stk-avatar">{initial}</div>
          <span className="stk-avatar-badge" title="Premium">
            <Crown size={12} fill="currentColor" />
          </span>
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 className="stk-profile__name">{user.name}</h2>
          <span className="stk-tag">{user.provider} Account</span>
        </div>
      </div>

      <div className="stk-fields">
        <InfoRow label="Name" value={user.name} editable onEdit={() => setEditingField('name')} />
        <InfoRow label="Email" value={user.email} />
        <InfoRow label="Phone" value={user.phone} />
        <InfoRow label="State" value={user.state} editable onEdit={() => setEditingField('state')} />
      </div>

      {editingField && (
        <EditFieldModal
          key={editingField}
          open
          field={editingField}
          initialValue={editingField === 'name' ? user.name : user.state}
          onCancel={() => setEditingField(null)}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
