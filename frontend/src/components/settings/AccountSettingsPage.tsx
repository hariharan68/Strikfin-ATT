import { useCallback, useMemo } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { updateProfile } from '../../api/endpoints'
import { getErrorMessage } from '../../api/client'
import { useToast } from '../ui/Toast'
import { ProfileCard } from './ProfileCard'
import { SettingsTabs } from './SettingsTabs'
import type { EditableField, ProfileUser } from './types'
import './settings.css'

/** Placeholders shown when the real user has no value for a field yet. */
const PLACEHOLDER = { phone: 'Not set', state: 'Not set' }

/** Map a UI field to its backend column. */
const FIELD_COLUMN: Record<EditableField, 'display_name' | 'state'> = {
  name: 'display_name',
  state: 'state',
}

export function AccountSettingsPage() {
  const authUser = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const toast = useToast()

  // Profile is derived directly from the real (server) user in the auth store.
  const profile = useMemo<ProfileUser>(
    () => ({
      name: authUser?.display_name || authUser?.email?.split('@')[0] || 'Trader',
      email: authUser?.email || '—',
      phone: authUser?.phone || PLACEHOLDER.phone,
      state: authUser?.state || PLACEHOLDER.state,
      provider: (authUser?.auth_provider || 'email').replace(/^\w/, (c) => c.toUpperCase()),
    }),
    [authUser],
  )

  const handleSave = useCallback(
    async (field: EditableField, value: string) => {
      const updated = await updateProfile({ [FIELD_COLUMN[field]]: value })
      setUser(updated) // propagate to navbar + this card
      toast.success(field === 'name' ? 'Name updated' : 'State updated')
    },
    [setUser, toast],
  )

  // Surface save errors as a toast (ProfileCard awaits handleSave; rethrow so it
  // keeps the modal open on failure).
  const handleSaveGuarded = useCallback(
    async (field: EditableField, value: string) => {
      try {
        await handleSave(field, value)
      } catch (e) {
        toast.error(getErrorMessage(e, 'Could not save changes'))
        throw e
      }
    },
    [handleSave, toast],
  )

  return (
    <div className="stk-settings">
      <div className="stk-shell">
        <aside className="stk-aside">
          <ProfileCard user={profile} onSave={handleSaveGuarded} />
        </aside>
        <div className="stk-main">
          <SettingsTabs />
        </div>
      </div>
    </div>
  )
}
