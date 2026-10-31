#!/usr/bin/env node
// A fake `claude` CLI that speaks Claude Code's stream-json protocol, for end-to-end tests.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const readline = require('readline')

const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log('9.9.9 (Claude Code)')
  process.exit(0)
}
if (args[0] === 'auth') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'mock', apiProvider: 'firstParty' }))
  process.exit(0)
}
if (!args.includes('-p')) {
  // Interactive mode (opened from the terminal button).
  console.log('Mock Claude Code interactive session. Type /exit to quit.')
  process.stdin.resume()
  process.stdin.on('data', (d) => String(d).includes('/exit') && process.exit(0))
  return
}

const resumeIdx = args.indexOf('--resume')
const sessionId = resumeIdx >= 0 ? args[resumeIdx + 1] : crypto.randomUUID()
const cwd = process.cwd()
// MCP servers: --strict-mcp-config limits them to the given file, otherwise the project's .mcp.json is used.
function mcpServers() {
  try {
    const i = args.indexOf('--mcp-config')
    const file = args.includes('--strict-mcp-config') && i >= 0 ? args[i + 1] : path.join(cwd, '.mcp.json')
    return Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers || {}).map((name) => ({ name, status: 'connected' }))
  } catch {
    return []
  }
}
// Pretend the conversation grows by 70K tokens per message (window: 200K).
let contextTokens = 0
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const pending = new Map()
let interrupted = false

function ask(toolName, input, toolUseId) {
  const request_id = crypto.randomUUID()
  out({ type: 'control_request', request_id, request: { subtype: 'can_use_tool', tool_name: toolName, input, tool_use_id: toolUseId } })
  return new Promise((resolve) => pending.set(request_id, resolve))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let msgN = 0
function say(text) {
  const id = `msg_${++msgN}`
  out({ type: 'stream_event', event: { type: 'message_start', message: { id } } })
  for (const chunk of text.match(/.{1,12}/gs)) out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } } })
  contextTokens += 70000
  out({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text }], usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: contextTokens, output_tokens: 5 } }, parent_tool_use_id: null, session_id: sessionId })
}
function toolUse(name, input) {
  const id = 'toolu_' + crypto.randomBytes(6).toString('hex')
  out({ type: 'assistant', message: { id: `msg_${++msgN}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }, parent_tool_use_id: null, session_id: sessionId })
  return id
}
function toolResult(id, content, isError = false) {
  out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] }, parent_tool_use_id: null, session_id: sessionId })
}

async function turn(text) {
  interrupted = false
  const started = Date.now()
  out({ type: 'system', subtype: 'init', session_id: sessionId, cwd, model: 'mock-model', tools: ['Read', 'Edit', 'Bash'], mcp_servers: mcpServers() })
  if (text.includes('login-fail')) {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', session_id: sessionId, permission_denials: [] })
    return
  }
  await sleep(300)
  say("I'll inspect the current shop implementation first.")
  const shop = path.join(cwd, 'src', 'ReplicatedStorage', 'Shop.lua')
  const readId = toolUse('Read', { file_path: shop })
  await sleep(250)
  toolResult(readId, fs.readFileSync(shop, 'utf8'))
  const grepId = toolUse('Grep', { pattern: 'price', path: path.join(cwd, 'src') })
  await sleep(200)
  toolResult(grepId, 'src/ReplicatedStorage/Shop.lua')
  out({ type: 'system', subtype: 'task_summary', detail: 'Improving sword prices' })

  const editInput = { file_path: shop, old_string: 'price = 100', new_string: 'price = 250 -- balanced' }
  const editId = toolUse('Edit', editInput)
  const editDecision = await ask('Edit', editInput, editId)
  if (editDecision.behavior === 'allow') {
    await sleep(150)
    const cur = fs.readFileSync(shop, 'utf8')
    fs.writeFileSync(shop, cur.replace('price = 100', 'price = 250 -- balanced'))
    toolResult(editId, 'The file has been updated.')
  } else toolResult(editId, 'Permission denied', true)

  const newFile = path.join(cwd, 'src', 'ReplicatedStorage', 'ShopConfig.lua')
  const writeInput = { file_path: newFile, content: 'return {\n\tCurrency = "Coins",\n\tDiscount = 0.1,\n}\n' }
  const writeId = toolUse('Write', writeInput)
  const writeDecision = await ask('Write', writeInput, writeId)
  if (writeDecision.behavior === 'allow') {
    fs.writeFileSync(newFile, writeInput.content)
    toolResult(writeId, 'File created successfully')
  } else toolResult(writeId, 'Permission denied', true)

  if (interrupted) return finish(started, false)
  const bashInput = { command: 'echo tests passed', description: 'Run the test suite' }
  const bashId = toolUse('Bash', bashInput)
  const d = await ask('Bash', bashInput, bashId)
  if (interrupted) return finish(started, false)
  if (d.behavior === 'allow') toolResult(bashId, 'tests passed')
  else toolResult(bashId, d.message || 'denied', true)
  await sleep(200)
  say('Done! I raised the **sword price** and added a config module:\n\n```lua\nreturn {\n\tCurrency = "Coins",\n}\n```\n\n- `Shop.lua` — new price\n- `ShopConfig.lua` — currency settings')
  finish(started, true)
}

function finish(started, ok) {
  out({
    type: 'result',
    subtype: ok ? 'success' : 'error_during_execution',
    is_error: !ok,
    result: ok ? 'Done' : 'Interrupted',
    duration_ms: Date.now() - started,
    num_turns: 4,
    total_cost_usd: 0.0123,
    modelUsage: { 'mock-model': { contextWindow: 200000 } },
    session_id: sessionId,
    permission_denials: []
  })
}

const rl = readline.createInterface({ input: process.stdin })
let queue = Promise.resolve()
rl.on('line', (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.type === 'control_response') {
    const r = pending.get(msg.response.request_id)
    pending.delete(msg.response.request_id)
    r?.(msg.response.response)
    return
  }
  if (msg.type === 'control_request' && msg.request.subtype === 'interrupt') {
    interrupted = true
    for (const [id, r] of pending) r({ behavior: 'deny', message: 'interrupted' })
    pending.clear()
    out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id } })
    return
  }
  if (msg.type === 'user') {
    const text = typeof msg.message.content === 'string' ? msg.message.content : ''
    queue = queue.then(() => turn(text))
  }
})
rl.on('close', () => queue.then(() => process.exit(0)))
