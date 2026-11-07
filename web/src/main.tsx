import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initAnalytics } from './lib/webAnalytics'

// Once per document load, outside React so StrictMode cannot double-register.
initAnalytics(import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN, location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
