// Optional smoke test against the REAL Claude Code CLI installed on this machine.
// Sends one tiny prompt (Haiku) through the app and checks the full loop:
// spawn in project cwd → streaming → host permission prompt for Write → file on disk → result.
// Usage: npm run build && xvfb-run -a node tests/e2e/real-claude.cjs
const { _electron: electron } = require('playwright')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-real-'))
const userData = path.join(tmp, 'userdata')
const project = path.join(tmp, 'HelloProject')
fs.mkdirSync(userData, { recursive: true })
fs.mkdirSync(project, { recursive: true })
fs.writeFileSync(path.join(project, 'README.md'), '# Hello\n')
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ model: 'haiku', onboarded: true, restoreLastProject: true, lastProjectId: 'p1', permissionMode: 'ask' }))
fs.writeFileSync(path.join(userData, 'projects.json'), JSON.stringify([{ id: 'p1', name: 'HelloProject', path: project, addedAt: 1, lastOpenedAt: 1 }]))

;(async () => {
  const app = await electron.launch({
    executablePath: require(path.join(root, 'node_modules/electron')),
    args: [path.join(root, 'out/main/index.js'), '--no-sandbox'],
    env: { ...process.env, STRATA_USER_DATA: userData }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.composer textarea', { timeout: 30000 })
  await page.fill('.composer textarea', 'Use the Write tool to create hello.txt containing exactly: hi from strata. Then answer with one short sentence.')
  await page.keyboard.press('Enter')
  // "Ask first" mode: the Write tool must come back to Strata as a permission prompt.
  await page.waitForSelector('.perm-card', { timeout: 120000 })
  console.log('✓ permission prompt received from real CLI:', (await page.textContent('.perm-what')).trim())
  await page.click('.perm-card .btn-primary')
  await page.waitForSelector('.result-meta', { timeout: 180000 })
  const ok = fs.existsSync(path.join(project, 'hello.txt'))
  console.log(ok ? '✓' : '✗', 'hello.txt created in project folder:', ok && fs.readFileSync(path.join(project, 'hello.txt'), 'utf8').trim())
  console.log('result:', (await page.textContent('.result-meta')).trim())
  console.log('session:', await page.textContent('.chat-session').catch(() => '?'))
  await page.screenshot({ path: path.join(__dirname, 'screenshots', 'real-claude.png') })
  const log = await page.evaluate(() => window.strata.claude.log('p1'))
  console.log(log.filter((l) => l.dir === 'info').map((l) => l.line).join('\n'))
  await app.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(ok ? 0 : 1)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
