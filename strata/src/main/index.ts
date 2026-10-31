import './bootstrap'
import { app, BrowserWindow, Menu, nativeTheme, screen, shell } from 'electron'
import { join } from 'node:path'
import { closeAllWatchers } from './filesystem'
import { registerIpc } from './ipc'
import { setAllowedRootsProvider } from './paths'
import { flushProjects, projectRoots } from './projects'
import { flushSettings, getSettings } from './settings'
import { killAllTerminals } from './terminal'
import { detectTools } from './tools'
import { JsonStore } from './store'
import type { ClaudeManager } from './claude'

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

let mainWindow: BrowserWindow | null = null
let claude: ClaudeManager | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.setAppUserModelId('dev.strata.ide')
setAllowedRootsProvider(projectRoots)

function visibleOnSomeDisplay(s: WindowState): boolean {
  if (s.x === undefined || s.y === undefined) return false
  return screen.getAllDisplays().some(({ workArea: a }) => s.x! < a.x + a.width - 100 && s.x! + s.width > a.x + 100 && s.y! >= a.y - 20 && s.y! < a.y + a.height - 100)
}

function createWindow(): void {
  const stateStore = new JsonStore<WindowState>('window', { width: 1440, height: 900, maximized: false })
  const state = stateStore.get()
  const theme = getSettings().theme
  nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark'

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(visibleOnSomeDisplay(state) ? { x: state.x, y: state.y } : {}),
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: theme === 'light' ? '#f7f7f8' : theme === 'midnight' ? '#07080b' : '#0e0f12',
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      webSecurity: true
    }
  })

  if (state.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow?.show())

  const saveState = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const maximized = mainWindow.isMaximized()
    const b = maximized ? stateStore.get() : { ...mainWindow.getBounds(), maximized }
    stateStore.set({ ...b, maximized })
  }
  mainWindow.on('resize', saveState)
  mainWindow.on('move', saveState)
  mainWindow.on('close', () => {
    saveState()
    stateStore.flush()
  })
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false))
  mainWindow.on('closed', () => (mainWindow = null))

  // The renderer is a local app: never navigate away, open links in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    }
  })

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app.whenReady().then(() => {
  // Keep the default menu out of the way (custom title bar) but keep accelerators like copy/paste.
  Menu.setApplicationMenu(
    process.platform === 'darwin'
      ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
      : null
  )
  claude = registerIpc(() => mainWindow)
  createWindow()
  // Warm the tool detection cache while the UI loads.
  detectTools().catch((err) => console.error('[tools] detection failed', err))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  claude?.shutdownAll()
  killAllTerminals()
  closeAllWatchers()
  flushSettings()
  flushProjects()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
