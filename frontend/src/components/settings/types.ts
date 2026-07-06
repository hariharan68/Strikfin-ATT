/** Shared types for the Account Settings surface. */

/** Editable fields on the profile card (both go through the modal). */
export type EditableField = 'name' | 'state'

/** Profile shown in the sidebar card. Real email/name come from the auth
 *  store; phone/state/provider are mock defaults until a backend surfaces them. */
export interface ProfileUser {
  name: string
  email: string
  phone: string
  state: string
  provider: string
}

export type PlanStatus = 'active' | 'expired' | 'inactive'

export interface Plan {
  id: string
  name: string
  status: PlanStatus
  startDate: string
  endDate: string
  daysRemaining: number
}

/** A broker available to connect. `real` marks the one wired to live endpoints. */
export interface BrokerMeta {
  id: string
  name: string
  /** Emoji/text glyph used as a lightweight logo placeholder. */
  logo: string
  /** True for Fyers — its "+ Add" runs the real OAuth flow. */
  real?: boolean
}

export type CallPutColorScheme = 'classic' | 'inverted'
