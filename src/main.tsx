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
import './styles/hazard.css'
import './styles/cook.css'
import './styles/ledger.css'
import './styles/history.css'
import './styles/records.css'
import './styles/orders.css'
import './styles/money.css'
import './styles/facility.css'
import './styles/climate.css'
import { AppProvider } from './settings/AppContext'
import { RoleProvider } from './settings/RoleContext'
import './styles/shell.css'
import { PowerProvider } from './power/PowerContext'
import { StoreProvider } from './store/StoreContext'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <RoleProvider>
        <PowerProvider>
          <StoreProvider>
            <App />
          </StoreProvider>
        </PowerProvider>
      </RoleProvider>
    </AppProvider>
  </StrictMode>,
)
