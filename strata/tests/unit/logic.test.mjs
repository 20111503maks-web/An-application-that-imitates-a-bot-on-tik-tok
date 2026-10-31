// Unit tests for main-process logic. Bundles the TypeScript sources with esbuild
// (shipped with Vite) and stubs the `electron` module.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../..')
const tmp = mkdtempSync(join(tmpdir(), 'strata-unit-'))

async function load(entry) {
  // Output inside node_modules so bundled imports (cross-spawn, ...) resolve.
  const out = join(root, 'node_modules', '.strata-test', entry.replace(/\W/g, '_') + '.mjs')
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    alias: { '@shared': join(root, 'src/shared') },
    external: ['cross-spawn', 'node-pty'],
    banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
    plugins: [
      {
        name: 'electron-stub',
        setup(b) {
          b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: `export const app = { getPath: () => ${JSON.stringify(tmp)} }; export const shell = { trashItem: async (p) => (await import('node:fs')).rmSync(p, { force: true }) };`,
            loader: 'js'
          }))
        }
      }
    ]
  })
  return import(pathToFileURL(out).href)
}

test('git status parser handles branches, renames and untracked files', async () => {
  const { parseStatus } = await load('src/main/git.ts')
  const out = ['## main...origin/main [ahead 2, behind 1]', ' M src/a.lua', 'A  src/b.lua', 'R  new.lua', 'old.lua', '?? notes.txt', ''].join('\0')
  const s = parseStatus(out)
  assert.equal(s.branch, 'main')
  assert.equal(s.upstream, 'origin/main')
  assert.equal(s.ahead, 2)
  assert.equal(s.behind, 1)
  assert.deepEqual(
    s.files.map((f) => [f.path, f.index, f.work]),
    [
      ['src/a.lua', ' ', 'M'],
      ['src/b.lua', 'A', ' '],
      ['new.lua', 'R', ' '],
      ['notes.txt', '?', '?']
    ]
  )
  assert.equal(s.files[2].origPath, 'old.lua')
  assert.equal(parseStatus('## No commits yet on master\0').branch, 'master')
})

test('project type detection recognises Roblox, Rojo, Blender, Node, Python and Git', async () => {
  const { detectProject } = await load('src/main/projects.ts')
  const p = join(tmp, 'Game')
  mkdirSync(join(p, 'src', 'ServerScriptService'), { recursive: true })
  mkdirSync(join(p, 'models'), { recursive: true })
  mkdirSync(join(p, '.git'), { recursive: true })
  writeFileSync(join(p, 'default.project.json'), '{}')
  writeFileSync(join(p, 'models', 'Sword.blend'), 'BLENDER')
  writeFileSync(join(p, 'package.json'), '{}')
  writeFileSync(join(p, 'requirements.txt'), '')
  const info = await detectProject(p)
  for (const k of ['roblox', 'rojo', 'blender', 'node', 'python', 'git']) assert.ok(info.kinds.includes(k), k)
  assert.match(info.label, /^Roblox \+ Rojo/)
  assert.equal(info.blendFiles.length, 1)
  assert.equal(info.rojoProjects.length, 1)

  const place = join(tmp, 'Place')
  mkdirSync(place)
  writeFileSync(join(place, 'game.rbxlx'), '<roblox/>')
  const placeInfo = await detectProject(place)
  assert.deepEqual(placeInfo.kinds, ['roblox'])
  assert.equal(placeInfo.placeFiles.length, 1)

  const empty = join(tmp, 'Empty')
  mkdirSync(empty)
  assert.equal((await detectProject(empty)).label, 'Folder')
})

test('change tracker snapshots, counts, accepts and rejects edits', async () => {
  const { ChangeTracker, lineStats } = await load('src/main/changes.ts')
  assert.deepEqual(lineStats('a\nb\nc', 'a\nB\nc\nd'), { additions: 2, deletions: 1 })
  assert.deepEqual(lineStats(null, 'x\ny'), { additions: 2, deletions: 0 })

  const dir = join(tmp, 'Tracked')
  mkdirSync(dir)
  const file = join(dir, 'Shop.lua')
  writeFileSync(file, 'price = 100\n')
  const t = new ChangeTracker(dir)

  // Edit snapshot before the tool runs.
  t.snapshot('Edit', { file_path: file, old_string: '100', new_string: '250' })
  writeFileSync(file, 'price = 250\n')
  t.settle(file)
  // New file via Write.
  const created = join(dir, 'Config.lua')
  t.snapshot('Write', { file_path: created, content: 'return {}\n' })
  writeFileSync(created, 'return {}\n')
  t.settle(created)
  // Paths outside the project are ignored.
  assert.equal(t.snapshot('Write', { file_path: join(tmp, 'outside.txt') }), null)

  let list = t.list()
  assert.equal(list.length, 2)
  assert.equal(list.find((c) => c.path === created).original, null)

  await t.reject([file])
  assert.equal(readFileSync(file, 'utf8'), 'price = 100\n')
  await t.reject([created])
  assert.equal(existsSync(created), false)
  assert.equal(t.list().length, 0)

  // A late snapshot (edit already applied) is reconstructed from old/new strings.
  writeFileSync(file, 'price = 300\n')
  const late = new ChangeTracker(dir)
  late.snapshot('Edit', { file_path: file, old_string: 'price = 100', new_string: 'price = 300' })
  late.settle(file)
  assert.equal(late.list()[0].original, 'price = 100\n')
  late.accept()
  assert.equal(late.list().length, 0)
  assert.equal(readFileSync(file, 'utf8'), 'price = 300\n')
})

test('permission rules and session folder encoding match Claude Code', async () => {
  const { ruleFor } = await load('src/main/claude.ts')
  assert.equal(ruleFor('Bash', { command: 'npm test' }), 'Bash(npm test)')
  assert.equal(ruleFor('Edit', { file_path: 'x' }), 'Edit')
  const { encodeProjectPath } = await load('src/main/sessions.ts')
  assert.equal(encodeProjectPath('/home/user/My Game'), '-home-user-My-Game')
})

test('paths: access is limited to project roots', async () => {
  const { isInside, assertAllowed, setAllowedRootsProvider } = await load('src/main/paths.ts')
  setAllowedRootsProvider(() => ['/projects/game'])
  assert.ok(isInside('/projects/game', '/projects/game/src/a.lua'))
  assert.ok(!isInside('/projects/game', '/projects/game2/a.lua'))
  assert.equal(assertAllowed('/projects/game/src'), '/projects/game/src')
  assert.throws(() => assertAllowed('/etc/passwd'), /outside of your projects/)
  assert.throws(() => assertAllowed('/projects/game/../secret'), /outside/)
})
