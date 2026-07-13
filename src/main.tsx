import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './Root.tsx'
// Ensure the composition registry is populated (via Vite's import.meta.glob)
// even on the #scene route, which doesn't mount App.
import './compositions'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
