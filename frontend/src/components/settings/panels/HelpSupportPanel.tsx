import { BookOpen, Bug, ChevronRight, LifeBuoy, Users } from 'lucide-react'
import type { ReactNode } from 'react'

interface HelpItem {
  icon: ReactNode
  title: string
  desc: string
  href: string
}

const HELP_ITEMS: HelpItem[] = [
  {
    icon: <BookOpen size={17} />,
    title: 'Documentation',
    desc: 'Guides for options tools, indicators & the terminal',
    href: 'https://docs.strikfin.dev',
  },
  {
    icon: <LifeBuoy size={17} />,
    title: 'Contact support',
    desc: 'Reach the team — typically replies within a few hours',
    href: 'mailto:support@strikfin.dev',
  },
  {
    icon: <Bug size={17} />,
    title: 'Report a bug',
    desc: 'Something off with the data or charts? Let us know',
    href: 'mailto:bugs@strikfin.dev',
  },
  {
    icon: <Users size={17} />,
    title: 'Community',
    desc: 'Join other traders on the Strikfin channel',
    href: 'https://t.me/strikfin',
  },
]

export function HelpSupportPanel() {
  return (
    <div className="stk-card">
      <h3 className="stk-section-title">Help &amp; Support</h3>
      <div className="stk-list">
        {HELP_ITEMS.map((item) => (
          <a
            key={item.title}
            href={item.href}
            target="_blank"
            rel="noreferrer"
            className="stk-help-row"
          >
            <span className="stk-help-row__icon">{item.icon}</span>
            <span className="stk-help-row__meta">
              <span className="stk-help-row__title">{item.title}</span>
              <span className="stk-help-row__desc">{item.desc}</span>
            </span>
            <ChevronRight size={18} className="stk-help-row__arrow" />
          </a>
        ))}
      </div>
    </div>
  )
}
