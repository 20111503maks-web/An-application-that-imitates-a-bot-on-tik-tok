// node-pty ships N-API prebuilds for Windows and macOS. N-API binaries are
// ABI-stable, so they work inside Electron without electron-rebuild.
// On Linux (dev / CI only) we compile it once against the local Node headers.
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ptyDir = join(root, 'node_modules', 'node-pty')
const prebuilt = join(ptyDir, 'prebuilds', `${process.platform}-${process.arch}`, 'pty.node')
const built = join(ptyDir, 'build', 'Release', 'pty.node')

if (!existsSync(ptyDir)) process.exit(0)
if (existsSync(prebuilt) || existsSync(built)) {
  console.log('[strata] node-pty native module ready')
  process.exit(0)
}
console.log('[strata] building node-pty from source for', process.platform, process.arch)
execSync('npx --yes node-gyp rebuild', { cwd: ptyDir, stdio: 'inherit' })
