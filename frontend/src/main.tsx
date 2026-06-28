import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Theme is applied before first paint by the inline bootstrap in index.html
// (the single source of truth, covering classic/warm/dark/terminal).

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
