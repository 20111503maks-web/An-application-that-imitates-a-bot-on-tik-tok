import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, type Project, type SendMessageOptions, type Settings, type TerminalCreateOptions } from '@shared/types'
import { ClaudeManager } from './claude'
import { findOnPath, launchDetached } from './exec'
import * as fsm from './filesystem'
import * as git from './git'
import { assertAllowed } from './paths'
import { listMcpServers } from './mcp'
import * as projects from './projects'
import { listSessions, loadHistory } from './sessions'
import { getSettings, updateSettings } from './settings'
import { createTerminal, killTerminal, resizeTerminal, setTerminalSinks, writeTerminal } from './terminal'
import { blenderPath, claudePath, detectTools, robloxStudioPath } from './tools'

const SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS))

/** Wraps a handler so errors reach the renderer as a plain message instead of an IPC stack dump. */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await fn(...(args as A))
    } catch (err) {
      throw new Error((err as Error)?.message ?? String(err))
    }
  })
}

export function registerIpc(getWindow: () => BrowserWindow | null): ClaudeManager {
  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }

  // ---------------------------------------------------------------- window
  ipcMain.on('window:minimize', () => getWindow()?.minimize())
  ipcMain.on('window:toggleMaximize', () => {
    const w = getWindow()
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on('window:close', () => getWindow()?.close())
  handle('window:isMaximized', () => !!getWindow()?.isMaximized())

  // ---------------------------------------------------------------- settings
  handle('settings:get', () => getSettings())
  handle('settings:set', (patch: Partial<Settings>) => {
    const clean: Partial<Settings> = {}
    for (const [k, v] of Object.entries(patch ?? {})) if (SETTINGS_KEYS.has(k) || k === 'lastProjectId') (clean as any)[k] = v
    const next = updateSettings(clean)
    if ('streamPartialMessages' in clean) claude.setPartialMessages(!!clean.streamPartialMessages)
    return next
  })

  // ---------------------------------------------------------------- projects
  handle('projects:list', () => projects.listProjects())
  handle('projects:pickFolder', async (multi?: boolean) => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      title: multi ? 'Add folders to Strata' : 'Open project folder',
      properties: multi ? ['openDirectory', 'multiSelections', 'createDirectory'] : ['openDirectory', 'createDirectory']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  })
  handle('projects:pickParentFolder', async () => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = { title: 'Choose where to create the workspace', properties: ['openDirectory', 'createDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  handle('projects:add', (path: string) => projects.addProject(path))
  handle('projects:create', (parent: string, name: string) => projects.createProject(parent, name))
  handle('projects:remove', (id: string) => {
    claude.stop(id)
    return projects.removeProject(id)
  })
  handle('projects:update', (id: string, patch: Partial<Project>) => projects.updateProject(id, patch))
  handle('projects:touch', (id: string) => {
    projects.touchProject(id)
    updateSettings({ lastProjectId: id })
  })
  handle('projects:info', (path: string) => projects.detectProject(assertAllowed(path)))
  handle('projects:mcpServers', (path: string) => listMcpServers(assertAllowed(path)))

  // ---------------------------------------------------------------- tools
  handle('tools:detect', (force?: boolean) => detectTools(!!force))
  handle('tools:openBlender', (file?: string) => {
    const exe = blenderPath()
    if (!exe) return { ok: false, error: 'Blender was not found. Set its path in Settings → Blender.' }
    const args = file ? [assertAllowed(file)] : []
    launchDetached(exe, args, file ? dirname(file) : undefined)
    return { ok: true }
  })
  handle('tools:openRobloxStudio', (file?: string) => {
    const exe = robloxStudioPath()
    if (!exe) return { ok: false, error: 'Roblox Studio was not found. Set its path in Settings → Roblox.' }
    const args = file ? [assertAllowed(file)] : []
    launchDetached(exe, args, file ? dirname(file) : undefined)
    return { ok: true }
  })
  handle('tools:openFolder', async (path: string) => {
    const p = assertAllowed(path)
    const err = await shell.openPath(p)
    if (err) throw new Error(err)
  })
  handle('tools:openExternal', async (url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) links can be opened')
    await shell.openExternal(url)
  })
  handle('tools:openClaudeExternal', (cwd: string) => {
    const dir = assertAllowed(cwd)
    const exe = claudePath()
    if (!exe) return { ok: false, error: 'Claude Code CLI was not found.' }
    if (process.platform === 'win32') {
      const wt = findOnPath('wt')
      if (wt) launchDetached(wt, ['-d', dir, exe], dir)
      else spawn('cmd.exe', ['/c', 'start', '"Claude Code"', 'cmd.exe', '/k', `"${exe}"`], { cwd: dir, detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref()
    } else if (process.platform === 'darwin') {
      spawn('osascript', ['-e', `tell application "Terminal" to do script "cd ${JSON.stringify(dir)} && ${JSON.stringify(exe)}"`], { detached: true, stdio: 'ignore' }).unref()
    } else {
      const term = findOnPath('x-terminal-emulator') ?? findOnPath('gnome-terminal') ?? findOnPath('konsole')
      if (!term) return { ok: false, error: 'No terminal emulator found — use the built-in terminal instead.' }
      launchDetached(term, ['-e', exe], dir)
    }
    return { ok: true }
  })
  handle('tools:pickExecutable', async () => {
    const win = getWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Select executable',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'Programs', extensions: ['exe', 'cmd', 'bat'] }, { name: 'All files', extensions: ['*'] }] : []
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  // ---------------------------------------------------------------- filesystem
  handle('fs:readDir', (p: string) => fsm.readDirectory(p))
  handle('fs:readFile', (p: string) => fsm.readTextFile(p))
  handle('fs:writeFile', (p: string, c: string) => fsm.writeTextFile(p, c))
  handle('fs:createFile', (p: string) => fsm.createFile(p))
  handle('fs:createDir', (p: string) => fsm.createDir(p))
  handle('fs:rename', (a: string, b: string) => fsm.renamePath(a, b))
  handle('fs:trash', (p: string) => fsm.trashPath(p))
  handle('fs:move', (a: string, dir: string) => fsm.movePath(a, dir))
  handle('fs:copyInto', (sources: string[], dir: string) => fsm.copyInto((sources ?? []).filter((s) => typeof s === 'string' && existsSync(s)), dir))
  handle('fs:exists', (p: string) => fsm.pathExists(p))
  handle('fs:watch', (root: string) => fsm.watchRoot(root, (r, paths) => send('fs:changed', { root: r, paths })))
  handle('fs:unwatch', (root: string) => fsm.unwatchRoot(root))

  // ---------------------------------------------------------------- git
  handle('git:status', (cwd: string) => git.status(cwd))
  handle('git:stage', (cwd: string, paths: string[]) => git.stage(cwd, paths ?? []))
  handle('git:unstage', (cwd: string, paths: string[]) => git.unstage(cwd, paths ?? []))
  handle('git:discard', (cwd: string, paths: string[]) => git.discard(cwd, paths ?? []))
  handle('git:commit', (cwd: string, msg: string) => git.commit(cwd, msg))
  handle('git:push', (cwd: string) => git.push(cwd))
  handle('git:pull', (cwd: string) => git.pull(cwd))
  handle('git:fileAtHead', (cwd: string, p: string) => git.fileAtHead(cwd, p))
  handle('git:init', (cwd: string) => git.init(cwd))

  // ---------------------------------------------------------------- claude
  const claude = new ClaudeManager({
    emit: (projectId, event) => send('claude:event', { projectId, event }),
    log: (line) => send('claude:log', line),
    onSessionId: (projectId, sessionId) => projects.updateProject(projectId, { sessionId }),
    onAlwaysAllow: (projectId, rule) => {
      const p = projects.getProject(projectId)
      if (!p) return
      const rules = new Set(p.allowedTools ?? [])
      rules.add(rule)
      projects.updateProject(projectId, { allowedTools: [...rules] })
    }
  })
  claude.setPartialMessages(getSettings().streamPartialMessages)

  handle('claude:send', (opts: SendMessageOptions) => claude.send(opts))
  handle('claude:interrupt', (id: string) => claude.interrupt(id))
  handle('claude:stop', (id: string) => {
    claude.stop(id)
    projects.updateProject(id, { sessionId: undefined })
  })
  handle('claude:respondPermission', (projectId: string, requestId: string, allow: boolean, opts?: { always?: boolean; message?: string }) =>
    claude.respondPermission(projectId, requestId, !!allow, opts?.always, opts?.message)
  )
  handle('claude:sessions', (cwd: string) => listSessions(assertAllowed(cwd)))
  handle('claude:history', (cwd: string, id: string) => loadHistory(assertAllowed(cwd), id))
  handle('claude:changes', (id: string) => claude.changes(id))
  handle('claude:acceptChanges', (id: string, paths?: string[]) => claude.accept(id, paths))
  handle('claude:rejectChanges', (id: string, paths?: string[]) => claude.reject(id, paths))
  handle('claude:isRunning', (id: string) => claude.isRunning(id))
  handle('claude:log', (id: string) => claude.log(id))

  // ---------------------------------------------------------------- terminal
  setTerminalSinks(
    (id, data) => send('terminal:data', { id, data }),
    (id, code) => send('terminal:exit', { id, code })
  )
  handle('terminal:create', (opts: TerminalCreateOptions) => createTerminal(opts))
  ipcMain.on('terminal:write', (_e, id: string, data: string) => writeTerminal(id, data))
  ipcMain.on('terminal:resize', (_e, id: string, cols: number, rows: number) => resizeTerminal(id, cols, rows))
  ipcMain.on('terminal:kill', (_e, id: string) => killTerminal(id))

  return claude
}
