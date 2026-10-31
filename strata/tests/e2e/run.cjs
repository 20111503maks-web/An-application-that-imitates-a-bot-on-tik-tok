// End-to-end test: launches the built Strata app in Electron, drives the UI with Playwright
// against a mock Claude Code CLI, and saves screenshots to tests/e2e/screenshots.
// Usage: npm run build && xvfb-run -a node tests/e2e/run.cjs
let electron
try {
  electron = require('playwright-core')._electron
} catch {
  electron = require('playwright')._electron
}
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')

const root = path.resolve(__dirname, '../..')
const shots = path.join(__dirname, 'screenshots')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-e2e-'))
const userData = path.join(tmp, 'userdata')
const project = path.join(tmp, 'BoxBreakers')
fs.mkdirSync(shots, { recursive: true })
fs.mkdirSync(userData, { recursive: true })

// ---- fixture: a small Roblox + Rojo + Blender project under git
const w = (rel, content) => {
  const p = path.join(project, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
}
w('default.project.json', JSON.stringify({ name: 'BoxBreakers', tree: { $className: 'DataModel', ReplicatedStorage: { $path: 'src/ReplicatedStorage' } } }, null, 2))
w('src/ReplicatedStorage/Shop.lua', 'local Shop = {}\n\nShop.Sword = {\n\tname = "Iron Sword",\n\tprice = 100,\n}\n\nfunction Shop.buy(player, item)\n\treturn item.price\nend\n\nreturn Shop\n')
w('src/ServerScriptService/Main.server.lua', 'local Shop = require(game.ReplicatedStorage.Shop)\nprint("Box Breakers server started")\n')
w('src/StarterGui/ShopUI.client.lua', '-- Shop UI\nlocal Players = game:GetService("Players")\n')
w('models/Sword.blend', Buffer.from([0x42, 0x4c, 0x45, 0x4e, 0x44, 0x45, 0x52, 0, 1, 2, 3]))
w('.mcp.json', JSON.stringify({ mcpServers: { blender: { command: 'node', args: ['-e', ''] }, 'roblox-studio': { command: 'node', args: ['-e', ''] } } }))
w('README.md', '# Box Breakers\n\nA Roblox game.\n')
w('aftman.toml', '[tools]\nrojo = "rojo-rbx/rojo@7.4.0"\n')
execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init', { cwd: project })

// On Windows a .js file is not directly executable: point Strata at a .cmd shim, like npm does.
let mock = path.join(__dirname, 'mock-claude.js')
if (process.platform === 'win32') {
  const shim = path.join(tmp, 'claude.cmd')
  fs.writeFileSync(shim, `@node "${mock}" %*\r\n`)
  mock = shim
}
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ claudePath: mock, onboarded: false, restoreLastProject: true }))
fs.writeFileSync(
  path.join(userData, 'projects.json'),
  JSON.stringify([{ id: 'p1', name: 'BoxBreakers', path: project, addedAt: Date.now(), lastOpenedAt: Date.now() }])
)

const failures = []
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) failures.push(msg)
}

;(async () => {
  // STRATA_EXE runs the packaged app (e.g. release/win-unpacked/Strata.exe) instead of the dev build.
  const packaged = process.env.STRATA_EXE ? path.resolve(process.env.STRATA_EXE) : null
  const app = await electron.launch({
    executablePath: packaged ?? require(path.join(root, 'node_modules/electron')),
    args: packaged ? [] : [path.join(root, 'out/main/index.js'), '--no-sandbox'],
    env: { ...process.env, STRATA_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '1' }
  })
  app.process().stdout.on('data', (d) => process.env.DEBUG && process.stdout.write('[main] ' + d))
  app.process().stderr.on('data', (d) => process.env.DEBUG && process.stdout.write('[main:err] ' + d))
  const page = await app.firstWindow()
  global.__page = page
  global.__app = app
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  const shot = async (name) => {
    await page.waitForTimeout(350)
    await page.screenshot({ path: path.join(shots, name + '.png') })
  }

  // 1. Welcome
  await page.waitForSelector('.welcome-title', { timeout: 20000 })
  await page.waitForSelector('.tool-chip.is-found', { timeout: 20000 })
  await shot('01-welcome')
  check(true, 'welcome screen renders')

  // 2. Open project (setup flow → workspace)
  await page.click('.recent-row')
  await page.waitForSelector('.setup-card', { timeout: 5000 })
  await page.waitForTimeout(500)
  await shot('02-setup')
  await page.waitForSelector('.setup-card', { state: 'detached', timeout: 15000 })
  await page.waitForSelector('.chat-empty', { timeout: 10000 })
  await page.waitForSelector('.tree-row')
  const typeLabel = await page.textContent('.project-row-meta')
  check(/Roblox \+ Rojo/.test(typeLabel) && /Blender/.test(typeLabel), `project type detected: ${typeLabel}`)
  const claudePill = await page.textContent('.status-pill')
  check(/Connected/.test(claudePill), `claude status pill: ${claudePill}`)
  // expand src
  await page.click('.tree-row:has-text("src")')
  await page.waitForSelector('.tree-row:has-text("ReplicatedStorage")')
  await page.click('.tree-row:has-text("ReplicatedStorage")')
  await page.waitForSelector('.tree-row:has-text("Shop.lua")')
  await shot('03-workspace')

  // 3. Chat with Claude: edits get auto-accepted for review, the command asks for permission
  await page.click('.composer textarea')
  await page.keyboard.type('Improve the sword shop UI.')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('Keep it simple.')
  const val = await page.inputValue('.composer textarea')
  check(val.includes('\n'), 'Shift+Enter inserts a newline')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.perm-card', { timeout: 20000 })
  check((await page.textContent('.perm-card')).includes('echo tests passed'), 'permission card shows the command')
  check(fs.readFileSync(path.join(project, 'src/ReplicatedStorage/Shop.lua'), 'utf8').includes('price = 250'), 'Claude edit was applied in the project folder')
  await shot('04-permission')
  await page.click('.perm-card .btn-primary')
  await page.waitForSelector('.result-meta', { timeout: 20000 })
  await page.waitForTimeout(400)
  await shot('05-result')
  const changed = await page.textContent('.changed-card')
  check(/Shop\.lua/.test(changed) && /ShopConfig\.lua/.test(changed), 'result lists changed files')
  check((await page.locator('.tool-row').count()) >= 4, 'tool steps rendered')
  check((await page.textContent('.segment:has-text("Changes")')).includes('2'), 'changes badge shows 2')

  // Context meter + long-chat banner (the mock reports ~71K of a 200K window per message)
  await page.waitForSelector('.ctx-meter', { timeout: 5000 })
  const meter = await page.textContent('.ctx-meter')
  check(/\d+(\.\d+)?K · \d+%/.test(meter), `context meter shows usage: ${meter}`)
  await page.click('.composer textarea')
  await page.keyboard.type('/cl')
  check((await page.textContent('.mention-pop')).includes('/clear'), 'typing "/" suggests the /clear command')
  await page.fill('.composer textarea', '')

  // 4. Review diff, reject one change, accept the other
  await page.click('.changed-file:has-text("Shop.lua") >> nth=0')
  await page.waitForSelector('.monaco-diff-editor', { timeout: 20000 })
  await page.waitForTimeout(1200)
  await shot('06-diff')
  await page.click('.editor-toolbar-actions .btn:has-text("Reject")')
  await page.waitForTimeout(500)
  check(fs.readFileSync(path.join(project, 'src/ReplicatedStorage/Shop.lua'), 'utf8').includes('price = 100,'), 'Reject restored the original file')
  await page.click('.segment:has-text("Changes")')
  await page.waitForSelector('.changes .file-item')
  await shot('07-changes')
  await page.click('.changes .btn-primary:has-text("Accept all")')
  await page.waitForSelector('.changes .panel-empty')
  check(fs.existsSync(path.join(project, 'src/ReplicatedStorage/ShopConfig.lua')), 'Accept kept the new file')

  // 5. Code editor with Lua highlighting + save
  await page.click('.segment:has-text("Files")')
  await page.dblclick('.tree-row:has-text("Shop.lua")')
  await page.waitForSelector('.monaco-editor .view-lines', { timeout: 20000 })
  await page.waitForTimeout(800)
  await page.click('.monaco-editor .view-lines')
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n-- edited in Strata')
  await page.waitForSelector('.tab-close.is-dirty')
  await shot('08-editor')
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(500)
  check(fs.readFileSync(path.join(project, 'src/ReplicatedStorage/Shop.lua'), 'utf8').includes('-- edited in Strata'), 'Ctrl+S saves the file')

  // 6. Git panel
  await page.click('.segment:has-text("Git")')
  await page.waitForSelector('.git .file-item', { timeout: 10000 })
  await shot('09-git')
  check((await page.locator('.git .file-item').count()) >= 2, 'git panel lists changed files')

  // 7. Terminal in the project folder
  await page.keyboard.press('Control+`')
  await page.waitForSelector('.term-host .xterm-rows', { timeout: 10000 })
  await page.waitForTimeout(1200)
  await page.click('.term-host')
  await page.keyboard.type('echo STRATA_TERMINAL_OK')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('.term-host .xterm-rows')?.textContent.includes('STRATA_TERMINAL_OK'), null, { timeout: 20000 })
  const termText = await page.textContent('.term-host .xterm-rows')
  // The prompt (bash or "PS C:\...\BoxBreakers>") shows the working directory.
  check(termText.includes('BoxBreakers'), 'terminal starts in the project folder')
  await page.click('.tab-claude')
  await shot('10-terminal')

  // 8. Tools panel
  await page.click('.segment:has-text("Tools")')
  await page.waitForSelector('.tools-panel .tool-card')
  await shot('11-tools')
  // MCP servers: switch one off for this project
  await page.waitForSelector('.mcp-row')
  check((await page.locator('.mcp-row').count()) === 2, 'MCP card lists the 2 servers from .mcp.json')
  await page.click('.mcp-row:has-text("roblox-studio") .toggle')
  await page.waitForTimeout(400)
  check((await page.locator('.mcp-row.is-off').count()) === 1, 'roblox-studio switched off')

  // 9. Explorer: create a file via context menu
  await page.click('.segment:has-text("Files")')
  await page.click('.tree-row:has-text("README.md")', { button: 'right' })
  await page.click('.menu-item:has-text("New file")')
  await page.keyboard.type('notes.txt')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check(fs.existsSync(path.join(project, 'notes.txt')), 'explorer creates files')

  // 10. Settings
  await page.keyboard.press('Control+,')
  await page.waitForSelector('.settings')
  await page.click('.settings-nav-item:has-text("Claude Code")')
  await shot('12-settings')
  await page.click('.settings-nav-item:has-text("Appearance")')
  await page.click('.theme-swatch.theme-light')
  await page.keyboard.press('Escape')
  await page.click('.tab-claude')
  await page.keyboard.press('Control+`')
  await shot('13-light')
  await page.keyboard.press('Control+,')
  await page.click('.settings-nav-item:has-text("Appearance")')
  await page.click('.theme-swatch.theme-dark')
  await page.keyboard.press('Escape')

  // 11. Auth error path
  await page.click('.composer textarea')
  await page.keyboard.type('login-fail please')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.auth-card', { timeout: 15000 })
  check(true, 'auth-required card appears when Claude Code is not logged in')
  const claudeLog = await page.evaluate(() => window.strata.claude.log('p1'))
  check(claudeLog.some((l) => l.dir === 'info' && l.line.includes('--strict-mcp-config')), 'CLI restarted with --strict-mcp-config after switching a server off')
  const mcpFile = JSON.parse(fs.readFileSync(path.join(userData, 'mcp', 'p1.json'), 'utf8'))
  check(JSON.stringify(Object.keys(mcpFile.mcpServers)) === '["blender"]', 'generated MCP config contains only the enabled server')
  // /clear starts a fresh chat
  await page.fill('.composer textarea', '/clear')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.chat-empty', { timeout: 5000 })
  check((await page.locator('.ctx-meter').count()) === 0, '/clear starts a new chat and resets the context meter')
  await shot('14-auth')

  // 12. Remove project from list (files must stay)
  await page.click('.project-row-remove')
  await page.click('.dialog .btn-danger')
  await page.waitForSelector('.welcome-title')
  check(fs.existsSync(project), 'removing a project keeps its files')

  const realErrors = errors.filter((e) => !/Autofocus|DevTools|Electron Security Warning/i.test(e))
  check(realErrors.length === 0, `no renderer errors${realErrors.length ? ': ' + realErrors.join(' | ') : ''}`)
  await app.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll e2e checks passed')
  process.exit(failures.length ? 1 : 0)
})().catch(async (err) => {
  console.error(err)
  try {
    await global.__page.screenshot({ path: path.join(shots, 'failure.png') })
    console.error('--- chat ---\n' + (await global.__page.textContent('.chat-inner').catch(() => '')))
    const log = await global.__page.evaluate(() => window.strata.claude.log('p1'))
    console.error('--- claude log ---\n' + log.map((l) => l.dir + ' ' + l.line.slice(0, 300)).join('\n'))
    await global.__app.close()
  } catch {}
  process.exit(1)
})
