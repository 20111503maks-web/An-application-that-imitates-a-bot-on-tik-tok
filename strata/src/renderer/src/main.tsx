import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@xterm/xterm/css/xterm.css'
import './styles/tokens.css'
import './styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { wireChatEvents } from './store/chat'

wireChatEvents()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
