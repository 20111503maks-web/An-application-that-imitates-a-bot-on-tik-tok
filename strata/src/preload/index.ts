import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'
import type { StrataAPI } from '@shared/api'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args)

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: StrataAPI = {
  platform: process.platform,
  homeDir: process.env?.USERPROFILE || process.env?.HOME || '',

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => invoke('window:isMaximized'),
    onMaximizedChange: (cb) => subscribe('window:maximized', cb),
    setZoom: (factor) => webFrame.setZoomFactor(Math.min(1.6, Math.max(0.7, factor || 1)))
  },

  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch)
  },

  projects: {
    list: () => invoke('projects:list'),
    pickFolder: (multi) => invoke('projects:pickFolder', multi),
    pickParentFolder: () => invoke('projects:pickParentFolder'),
    add: (path) => invoke('projects:add', path),
    create: (parent, name) => invoke('projects:create', parent, name),
    remove: (id) => invoke('projects:remove', id),
    update: (id, patch) => invoke('projects:update', id, patch),
    touch: (id) => invoke('projects:touch', id),
    info: (path) => invoke('projects:info', path)
  },

  tools: {
    detect: (force) => invoke('tools:detect', force),
    openBlender: (file) => invoke('tools:openBlender', file),
    openRobloxStudio: (file) => invoke('tools:openRobloxStudio', file),
    openFolder: (path) => invoke('tools:openFolder', path),
    openExternal: (url) => invoke('tools:openExternal', url),
    openClaudeExternal: (cwd) => invoke('tools:openClaudeExternal', cwd),
    pickExecutable: () => invoke('tools:pickExecutable')
  },

  fs: {
    readDir: (p) => invoke('fs:readDir', p),
    readFile: (p) => invoke('fs:readFile', p),
    writeFile: (p, c) => invoke('fs:writeFile', p, c),
    createFile: (p) => invoke('fs:createFile', p),
    createDir: (p) => invoke('fs:createDir', p),
    rename: (a, b) => invoke('fs:rename', a, b),
    trash: (p) => invoke('fs:trash', p),
    move: (a, dir) => invoke('fs:move', a, dir),
    copyInto: (sources, dir) => invoke('fs:copyInto', sources, dir),
    exists: (p) => invoke('fs:exists', p),
    watch: (root) => invoke('fs:watch', root),
    unwatch: (root) => invoke('fs:unwatch', root),
    onChanged: (cb) => subscribe('fs:changed', cb),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },

  git: {
    status: (cwd) => invoke('git:status', cwd),
    stage: (cwd, paths) => invoke('git:stage', cwd, paths),
    unstage: (cwd, paths) => invoke('git:unstage', cwd, paths),
    discard: (cwd, paths) => invoke('git:discard', cwd, paths),
    commit: (cwd, message) => invoke('git:commit', cwd, message),
    push: (cwd) => invoke('git:push', cwd),
    pull: (cwd) => invoke('git:pull', cwd),
    fileAtHead: (cwd, path) => invoke('git:fileAtHead', cwd, path),
    init: (cwd) => invoke('git:init', cwd)
  },

  claude: {
    send: (opts) => invoke('claude:send', opts),
    interrupt: (id) => invoke('claude:interrupt', id),
    stop: (id) => invoke('claude:stop', id),
    respondPermission: (projectId, requestId, allow, opts) => invoke('claude:respondPermission', projectId, requestId, allow, opts),
    sessions: (cwd) => invoke('claude:sessions', cwd),
    history: (cwd, id) => invoke('claude:history', cwd, id),
    changes: (id) => invoke('claude:changes', id),
    acceptChanges: (id, paths) => invoke('claude:acceptChanges', id, paths),
    rejectChanges: (id, paths) => invoke('claude:rejectChanges', id, paths),
    isRunning: (id) => invoke('claude:isRunning', id),
    log: (id) => invoke('claude:log', id),
    onEvent: (cb) => subscribe('claude:event', cb),
    onLog: (cb) => subscribe('claude:log', cb)
  },

  terminal: {
    create: (opts) => invoke('terminal:create', opts),
    write: (id, data) => ipcRenderer.send('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('terminal:kill', id),
    onData: (cb) => subscribe('terminal:data', cb),
    onExit: (cb) => subscribe('terminal:exit', cb)
  }
}

contextBridge.exposeInMainWorld('strata', api)
