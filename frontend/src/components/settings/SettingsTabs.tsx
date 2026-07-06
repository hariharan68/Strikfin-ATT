import { useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/format'
import { MyPlansPanel } from './panels/MyPlansPanel'
import { GlobalSettingsPanel } from './panels/GlobalSettingsPanel'
import { BrokerConnectPanel } from './panels/BrokerConnectPanel'
import { HelpSupportPanel } from './panels/HelpSupportPanel'

type TabKey = 'plans' | 'settings' | 'broker' | 'help'

interface TabDef {
  key: TabKey
  label: string
  render: () => ReactNode
}

const TABS: TabDef[] = [
  { key: 'plans', label: 'My Plans', render: () => <MyPlansPanel /> },
  { key: 'settings', label: 'Global Settings', render: () => <GlobalSettingsPanel /> },
  { key: 'broker', label: 'Broker Connect', render: () => <BrokerConnectPanel /> },
  { key: 'help', label: 'Help & Support', render: () => <HelpSupportPanel /> },
]

export function SettingsTabs() {
  const [activeKey, setActiveKey] = useState<TabKey>('plans')
  const active = TABS.find((t) => t.key === activeKey) ?? TABS[0]

  return (
    <div>
      <div role="tablist" className="stk-tabs">
        {TABS.map((tab) => {
          const isActive = tab.key === activeKey
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveKey(tab.key)}
              className={cn('stk-tab', isActive && 'is-active')}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Panel — mounted lazily on first activation via keyed render */}
      <div role="tabpanel" className="stk-panel">
        {active.render()}
      </div>
    </div>
  )
}
