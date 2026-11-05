import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/michroma/400.css'
import '@fontsource/share-tech-mono/400.css'
import '@fontsource/vt323/400.css'
import '@fontsource/barlow-condensed/500.css'
import '@fontsource/barlow-condensed/600.css'
import './styles/crt.css'
import './styles/layout.css'
import './styles/power.css'
import './styles/specimen.css'
import './styles/cargo.css'
import './styles/manual.css'
import './styles/xeno.css'
import { AppProvider } from './settings/AppContext'
import { PowerProvider } from './power/PowerContext'
import { StoreProvider } from './store/StoreContext'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <PowerProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </PowerProvider>
    </AppProvider>
  </StrictMode>,
)
