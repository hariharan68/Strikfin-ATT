import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Stub the panels so this unit test only exercises tab → panel routing,
// not the panels' own network/router dependencies.
vi.mock('../panels/MyPlansPanel', () => ({ MyPlansPanel: () => <div>PLANS_PANEL</div> }))
vi.mock('../panels/GlobalSettingsPanel', () => ({
  GlobalSettingsPanel: () => <div>SETTINGS_PANEL</div>,
}))
vi.mock('../panels/BrokerConnectPanel', () => ({
  BrokerConnectPanel: () => <div>BROKER_PANEL</div>,
}))
vi.mock('../panels/HelpSupportPanel', () => ({
  HelpSupportPanel: () => <div>HELP_PANEL</div>,
}))

import { SettingsTabs } from '../SettingsTabs'

describe('SettingsTabs', () => {
  it('renders the plans panel by default and switches panel per active tab', async () => {
    const user = userEvent.setup()
    render(<SettingsTabs />)

    // Default active key = plans.
    expect(screen.getByText('PLANS_PANEL')).toBeInTheDocument()
    expect(screen.queryByText('BROKER_PANEL')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Broker Connect/i }))
    expect(screen.getByText('BROKER_PANEL')).toBeInTheDocument()
    expect(screen.queryByText('PLANS_PANEL')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Help & Support/i }))
    expect(screen.getByText('HELP_PANEL')).toBeInTheDocument()
  })
})
