import { useEffect, useState } from 'react'

const STORAGE_KEY = 'alphalytic-theme'

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
}

export function useTheme() {
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'dark'
  })

  useEffect(() => {
    applyTheme(isDark)
    localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light')
  }, [isDark])

  return { isDark, toggle: () => setIsDark((d) => !d) }
}
