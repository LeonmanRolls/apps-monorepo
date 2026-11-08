#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { openSync, readFileSync, existsSync } from 'node:fs'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import crypto from 'node:crypto'

const execFileAsync = promisify(execFile)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../../../..')
const runId = process.env.VERIFY_RUN_ID ?? 'current'
const runDir = path.join(
  process.env.VERIFY_HOME ?? '/tmp/verify-ens-apps',
  runId,
)
const evidenceDir = path.join(runDir, 'evidence')
const statePath = path.join(runDir, 'state.json')
const apiDevVars = path.join(repoRoot, 'workers/api-worker/.dev.vars')
const scaffoldStamp = '# verify-ens-apps scaffolding'

const apps = {
  manager: {
    filter: 'manager',
    port: Number(process.env.VERIFY_MANAGER_PORT ?? 3000),
    heading: /Find your/,
  },
  portal: {
    filter: 'portal',
    port: Number(process.env.VERIFY_PORTAL_PORT ?? 3001),
    heading: /Explore the source of truth/,
  },
  'api-worker': {
    filter: 'api-worker',
    port: Number(process.env.VERIFY_API_PORT ?? 2999),
    health: { status: 'ok', chain: 'sepolia' },
  },
}

const builds = ['portal', 'manager', 'api-worker']

const tests = [
  {
    name: 'manager-check-availability',
    cwd: path.join(repoRoot, 'apps/manager'),
    args: [
      'exec',
      'vitest',
      'run',
      '--maxWorkers=4',
      'src/features/landing/check-availability/useCheckAvailability.test.ts',
    ],
  },
  {
    name: 'portal-name-search',
    cwd: path.join(repoRoot, 'apps/portal'),
    args: [
      'exec',
      'vitest',
      'run',
      '--maxWorkers=4',
      'src/features/dashboard/components/SearchModalContent.test.tsx',
    ],
  },
  {
    name: 'api-worker-health',
    cwd: path.join(repoRoot, 'workers/api-worker'),
    args: ['exec', 'vitest', 'run', '--maxWorkers=4', 'src/app/health.test.ts'],
  },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const fail = (message) => {
  console.error(message)
  process.exitCode = 1
}

const readState = async () => {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { runId, apps: {}, apiScaffold: false }
    }
    throw error
  }
}

const writeState = async (state) => {
  await mkdir(runDir, { recursive: true })
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

const repoHead = async () => {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
  })
  return stdout.trim()
}

const fetchText = (url) =>
  new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 10000 }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    request.on('error', reject)
    request.on('timeout', () => {
      request.destroy()
      reject(new Error(`timed out fetching ${url}`))
    })
  })

const waitForHttp = async (url, accept, timeoutMs) => {
  const started = Date.now()
  let last = 'no response'
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetchText(url)
      last = `HTTP ${response.status}`
      if (accept(response)) return response
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await sleep(1000)
  }
  throw new Error(`timed out waiting for ${url}: ${last}`)
}

const listeners = async (port) => {
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-nP',
      `-iTCP:${port}`,
      '-sTCP:LISTEN',
      '-t',
    ])
    return stdout
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => Number(line))
  } catch (error) {
    if (error && error.code === 1) return []
    throw error
  }
}

const processGroup = (pid) => {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  return Number(rest[2])
}

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const parentPid = (pid) => {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    const match = status.match(/^PPid:\s+(\d+)/m)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

const ownedByUs = async (pid, port) => {
  const pids = await listeners(port)
  if (pids.length === 0) return false
  return pids.every((listener) => {
    if (listener === pid) return true
    try {
      if (processGroup(listener) === pid) return true
    } catch {
      return false
    }
    const seen = new Set()
    let current = listener
    while (current && current > 1 && !seen.has(current)) {
      if (current === pid) return true
      seen.add(current)
      current = parentPid(current)
    }
    return false
  })
}

const killGroup = async (pid) => {
  if (!Number.isInteger(pid) || pid < 2) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    return
  }
  await sleep(3000)
  try {
    process.kill(-pid, 0)
    process.kill(-pid, 'SIGKILL')
  } catch {
    return
  }
}

const chromium = async () => {
  const require = createRequire(path.join(repoRoot, 'e2e/package.json'))
  return require('@playwright/test').chromium
}

const runForeground = async (args, { cwd, logPath, env }) => {
  await mkdir(path.dirname(logPath), { recursive: true })
  const logFd = openSync(logPath, 'w')
  const code = await new Promise((resolve) => {
    const child = spawn('pnpm', args, {
      cwd,
      env,
      stdio: ['ignore', logFd, logFd],
    })
    child.on('exit', (status) => resolve(status ?? 1))
  })
  return code
}

const appUrl = (app) => `http://127.0.0.1:${app.port}`

const ensureScaffold = async (state) => {
  if (existsSync(apiDevVars)) return state
  const body = [
    scaffoldStamp,
    'DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres',
    'SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com',
    'JWT_SECRET=verify-ens-apps',
    '',
  ].join('\n')
  await writeFile(apiDevVars, body)
  return { ...state, apiScaffold: true }
}

const removeScaffold = async (state) => {
  if (!state.apiScaffold) return
  const text = existsSync(apiDevVars) ? readFileSync(apiDevVars, 'utf8') : ''
  if (!text.startsWith(scaffoldStamp)) return
  await rm(apiDevVars, { force: true })
}

const launch = async (name) => {
  const app = apps[name]
  if (!app) {
    fail(`unknown app ${name}`)
    return
  }
  await mkdir(evidenceDir, { recursive: true })
  const existing = await listeners(app.port)
  if (existing.length > 0) {
    fail(
      `port ${app.port} is already taken by pid ${existing.join(', ')}. Refusing to launch ${name}.`,
    )
    return
  }
  let state = await readState()
  if (name === 'api-worker') state = await ensureScaffold(state)
  const logPath = path.join(runDir, `${name}.log`)
  const args = [
    '--filter',
    app.filter,
    'exec',
    'vite',
    'dev',
    '--host',
    '127.0.0.1',
    '--port',
    String(app.port),
    '--strictPort',
  ]
  const logFd = openSync(logPath, 'w')
  const child = spawn('pnpm', args, {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  })
  child.unref()
  const record = {
    pid: child.pid,
    port: app.port,
    url: name === 'api-worker' ? `${appUrl(app)}/health` : appUrl(app),
    log: logPath,
    startedAt: new Date().toISOString(),
  }
  state.apps[name] = record
  state.repoHead = await repoHead()
  await writeState(state)
  console.log(`launched ${name} pid ${child.pid} on ${record.url}`)
  console.log(`log ${logPath}`)
  try {
    const readyUrl = name === 'api-worker' ? record.url : appUrl(app)
    const response = await waitForHttp(
      readyUrl,
      (result) => result.status === 200,
      300000,
    )
    if (name === 'api-worker') {
      const body = JSON.parse(response.body)
      if (body.status !== 'ok' || body.chain !== 'sepolia') {
        throw new Error(`unexpected health body ${response.body}`)
      }
    }
    console.log(`${name} answered HTTP 200`)
  } catch (error) {
    await killGroup(child.pid)
    delete state.apps[name]
    await writeState(state)
    fail(error instanceof Error ? error.message : String(error))
  }
}

const doctor = async (name) => {
  const app = apps[name]
  const state = await readState()
  const record = state.apps[name]
  if (!app || !record) {
    fail(`no ${name} instance in ${statePath}`)
    return
  }
  const report = {
    app: name,
    url: record.url,
    pid: record.pid,
    port: record.port,
    repoHead: state.repoHead ?? null,
    alive: alive(record.pid),
    ownsPort: false,
    httpStatus: 0,
    usable: false,
  }
  if (!report.alive) {
    await writeFile(
      path.join(evidenceDir, `doctor-${name}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    )
    fail(`${name} pid ${record.pid} is not running`)
    return
  }
  report.ownsPort = await ownedByUs(record.pid, record.port)
  if (!report.ownsPort) {
    await writeFile(
      path.join(evidenceDir, `doctor-${name}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    )
    fail(`${name} does not own port ${record.port}`)
    return
  }
  if (app.health) {
    const response = await fetchText(record.url)
    report.httpStatus = response.status
    report.body = response.body
    const body = JSON.parse(response.body)
    report.usable =
      response.status === 200 &&
      body.status === app.health.status &&
      body.chain === app.health.chain
  } else {
    const response = await fetchText(appUrl(app))
    report.httpStatus = response.status
    const browserType = await chromium()
    const browser = await browserType.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.goto(appUrl(app), { waitUntil: 'domcontentloaded' })
      const heading = page.getByRole('heading', { name: app.heading })
      await heading.waitFor({ timeout: 30000 })
      report.heading = await heading.innerText()
      report.usable = response.status === 200
    } finally {
      await browser.close()
    }
  }
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(
    path.join(evidenceDir, `doctor-${name}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  console.log(JSON.stringify(report))
  if (!report.usable) fail(`${name} doctor failed`)
}

const labelFor = async (state) => {
  if (typeof state.label === 'string' && state.label.length > 0) return state.label
  const label = `pstack${crypto.randomBytes(4).toString('hex')}`
  state.label = label
  await writeState(state)
  return label
}

const dismissOptional = async (page) => {
  const decline = page.getByRole('button', { name: 'No thanks' })
  if (await decline.isVisible().catch(() => false)) {
    await decline.click()
  }
}

const typeInto = async (locator, value) => {
  await locator.click()
  await locator.pressSequentially(value, { delay: 20 })
}

const driveManager = async (page, label, dir) => {
  const fullName = `${label}.eth`
  await page.goto(appUrl(apps.manager), {
    waitUntil: 'networkidle',
    timeout: 60000,
  })
  await page.getByRole('heading', { name: /Find your/ }).waitFor()
  const decline = page.getByRole('button', { name: 'No thanks' })
  await decline.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  await dismissOptional(page)
  await typeInto(page.getByPlaceholder('.eth'), label)
  const link = page.getByRole('link').filter({ hasText: fullName })
  await link.waitFor({ timeout: 60000 })
  const resultText = await link.innerText()
  await page.screenshot({
    path: path.join(dir, 'result.png'),
    fullPage: true,
  })
  await writeFile(path.join(dir, 'result.txt'), `${resultText}\n`)
  if (!/\bavailable\b/i.test(resultText)) {
    throw new Error(
      `expected an available result for ${fullName}, saw: ${resultText}`,
    )
  }
  await link.click()
  await page.waitForURL(new RegExp(`/register/${fullName}`), { timeout: 30000 })
  await page
    .getByRole('heading', { name: fullName, level: 1 })
    .waitFor({ timeout: 60000 })
  await page.screenshot({
    path: path.join(dir, 'register.png'),
    fullPage: true,
  })
  await writeFile(
    path.join(dir, 'register.aria.txt'),
    await page.locator('body').ariaSnapshot(),
  )
  return { label, fullName, url: page.url(), resultText }
}

const drivePortal = async (page, label, dir) => {
  const fullName = `${label}.eth`
  const namePattern = new RegExp(
    `${fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*Available to register`,
  )
  await page.goto(appUrl(apps.portal), { waitUntil: 'domcontentloaded' })
  const search = page.getByRole('combobox', {
    name: 'Search for a name, wallet, or contract',
  })
  await search.waitFor()
  await search.fill(label)
  const option = page.getByRole('option', { name: namePattern })
  await option.waitFor({ timeout: 60000 })
  await page.screenshot({ path: path.join(dir, 'result.png'), fullPage: true })
  await writeFile(path.join(dir, 'result.txt'), `${await option.innerText()}\n`)
  await option.click()
  await page.waitForURL(
    (url) =>
      url.pathname === '/register' && url.searchParams.get('name') === fullName,
    { timeout: 30000 },
  )
  await page.getByText(fullName, { exact: true }).first().waitFor({ timeout: 60000 })
  const blocked = page.getByText(
    /Could not check availability|is already registered/,
  )
  if (await blocked.isVisible().catch(() => false)) {
    throw new Error(`register page rejected ${fullName}`)
  }
  await page.screenshot({ path: path.join(dir, 'register.png'), fullPage: true })
  await writeFile(
    path.join(dir, 'register.aria.txt'),
    await page.locator('body').ariaSnapshot(),
  )
  return { label, fullName, url: page.url() }
}

const driveApi = async (dir) => {
  const response = await fetchText(apps['api-worker'].health ? `${appUrl(apps['api-worker'])}/health` : '')
  await writeFile(path.join(dir, 'health.json'), response.body)
  const body = JSON.parse(response.body)
  if (response.status !== 200 || body.status !== 'ok' || body.chain !== 'sepolia') {
    throw new Error(`unexpected health response HTTP ${response.status} ${response.body}`)
  }
  return body
}

const EXPIRY_ADDRESS = '0x1111111111111111111111111111111111111111'
const EXPIRY_SOONEST = [
  'soon.eth',
  'parent.eth',
  'sub.parent.eth',
  'later.eth',
  'dns.com',
  'sub.never.eth',
]
const EXPIRY_LATEST = [
  'later.eth',
  'parent.eth',
  'sub.parent.eth',
  'soon.eth',
  'dns.com',
  'sub.never.eth',
]

const expiryName = (name, expiresAt, authority) => ({
  name,
  display_name: name,
  namespace: 'ens',
  namehash: `0x${'ab'.repeat(32)}`,
  status: 'active',
  authority,
  relations: ['owner'],
  is_primary: false,
  ...(expiresAt
    ? {
        expires_at: expiresAt,
        ...(authority === 'ens_v1' ? { ens_v1: { expires_at: expiresAt } } : {}),
      }
    : {}),
})

// Returned in an order that is not soonest-first. The page must sort them.
const EXPIRY_NAMES = [
  expiryName('dns.com', null, 'ens_v1'),
  expiryName('later.eth', '1924992000', 'ens_v2'),
  expiryName('sub.never.eth', null, 'ens_v1'),
  expiryName('soon.eth', '1893456000', 'ens_v2'),
  expiryName('sub.parent.eth', null, 'ens_v1'),
  expiryName('parent.eth', '1909008000', 'ens_v1'),
]

const bignameEnvelope = (data) => ({
  data,
  page: {
    cursor: null,
    next_cursor: null,
    page_size: 200,
    total_count: data.length,
    has_more: false,
  },
  meta: { as_of: {} },
})

const mockAddressNames = async (page) => {
  await page.route('https://sepolia.api.bigname.sh/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/names')) {
      const relation = url.searchParams.get('relation')
      const include = url.searchParams.get('include') ?? ''
      const data =
        relation === 'former_owner' || include.includes('role_summary')
          ? []
          : EXPIRY_NAMES
      await route.fulfill({ json: bignameEnvelope(data) })
      return
    }
    if (url.pathname === '/v1/lookup') {
      await route.fulfill({
        json: bignameEnvelope([
          {
            input: { name: 'never.eth' },
            kind: 'name',
            status: 'ok',
            record: {
              name: 'never.eth',
              display_name: 'never.eth',
              namespace: 'ens',
              namehash: `0x${'cd'.repeat(32)}`,
              expires_at: null,
              read_status: 'ok',
            },
          },
        ]),
      })
      return
    }
    await route.fulfill({
      status: 404,
      json: {
        error: {
          code: 'not_found',
          message: 'unmocked bigname route',
          details: {},
        },
      },
    })
  })
}

const shownNames = async (page) => {
  const labels = [...EXPIRY_SOONEST].sort((a, b) => b.length - a.length)
  const rows = await page.getByRole('row').allTextContents()
  return rows.slice(1).map((text) => {
    const found = labels.find((name) => text.includes(name))
    if (!found) throw new Error(`row did not name a fixture name: ${text}`)
    return found
  })
}

const driveExpirySort = async (page, dir) => {
  const { expect } = createRequire(path.join(repoRoot, 'e2e/package.json'))(
    '@playwright/test',
  )
  await mockAddressNames(page)
  await page.goto(`${appUrl(apps.portal)}/addr/${EXPIRY_ADDRESS}/names`)
  await page.getByRole('heading', { name: /Names \(6\)/ }).waitFor({
    timeout: 60000,
  })
  await dismissOptional(page)
  const assertShown = async (label, expected) => {
    let actual = []
    try {
      await expect
        .poll(async () => (actual = await shownNames(page)).join('\n'), {
          timeout: 15000,
        })
        .toBe(expected.join('\n'))
    } finally {
      await page.screenshot({
        path: path.join(dir, `${label}.png`),
        fullPage: true,
      })
    }
    return actual
  }
  await page.getByRole('button', { name: 'Expiry' }).click()
  const soonest = await assertShown('soonest', EXPIRY_SOONEST)
  await page.getByRole('button', { name: 'Expiry' }).click()
  const latest = await assertShown('latest', EXPIRY_LATEST)
  return {
    address: EXPIRY_ADDRESS,
    mocked: 'https://sepolia.api.bigname.sh',
    soonest,
    latest,
  }
}

const drive = async (feature) => {
  await mkdir(evidenceDir, { recursive: true })
  const state = await readState()
  const dir = path.join(evidenceDir, feature)
  await mkdir(dir, { recursive: true })
  if (feature === 'api-worker-health') {
    await doctor('api-worker')
    if (process.exitCode) return
    const body = await driveApi(dir)
    console.log(JSON.stringify({ feature, body }))
    return
  }
  const appName = feature.startsWith('portal') ? 'portal' : 'manager'
  await doctor(appName)
  if (process.exitCode) return
  const label = await labelFor(state)
  const browserType = await chromium()
  const browser = await browserType.launch({ headless: true })
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    })
    const result =
      feature === 'portal-name-search'
        ? await drivePortal(page, label, dir)
        : feature === 'portal-address-expiry-sort'
          ? await driveExpirySort(page, dir)
          : await driveManager(page, label, dir)
    await writeFile(path.join(dir, 'proof.json'), `${JSON.stringify(result, null, 2)}\n`)
    console.log(JSON.stringify({ feature, ...result }))
  } finally {
    await browser.close()
  }
}

const build = async (names) => {
  await mkdir(evidenceDir, { recursive: true })
  for (const name of names) {
    const logPath = path.join(evidenceDir, `build-${name}.log`)
    console.log(`building ${name}, log ${logPath}`)
    const code = await runForeground(['--filter', name, 'build'], {
      cwd: repoRoot,
      logPath,
    })
    if (code !== 0) {
      fail(`${name} build exited ${code}. See ${logPath}`)
      return
    }
    console.log(`${name} build exited 0`)
  }
}

const test = async () => {
  await mkdir(path.join(evidenceDir, 'tests'), { recursive: true })
  for (const spec of tests) {
    const logPath = path.join(evidenceDir, 'tests', `${spec.name}.log`)
    console.log(`testing ${spec.name}, log ${logPath}`)
    const code = await runForeground(spec.args, { cwd: spec.cwd, logPath })
    if (code !== 0) {
      fail(`${spec.name} exited ${code}. See ${logPath}`)
      return
    }
    console.log(`${spec.name} exited 0`)
  }
}

const cleanup = async () => {
  const state = await readState()
  for (const name of Object.keys(state.apps)) {
    const record = state.apps[name]
    console.log(`stopping ${name} pid ${record.pid}`)
    await killGroup(record.pid)
    state.apps[name] = { ...record, stoppedAt: new Date().toISOString() }
  }
  await removeScaffold(state)
  state.apiScaffold = false
  await writeState(state)
  console.log(`evidence remains at ${evidenceDir}`)
}

const evidence = async () => {
  await access(evidenceDir)
  console.log(evidenceDir)
}

const usage = () => {
  console.log(`usage: node .cursor/skills/verify-ens-apps/scripts/verify.mjs <command>

commands:
  build [portal|manager|api-worker]
  launch <manager|portal|api-worker>
  doctor <manager|portal|api-worker>
  drive <manager-check-availability|portal-name-search|portal-address-expiry-sort|api-worker-health>
  test
  cleanup
  evidence`)
}

const main = async () => {
  const [command, arg] = process.argv.slice(2)
  if (command === 'build') {
    const names = arg ? [arg] : builds
    if (arg && !builds.includes(arg)) {
      fail(`unknown build ${arg}`)
      return
    }
    await build(names)
    return
  }
  if (command === 'launch') {
    await launch(arg)
    return
  }
  if (command === 'doctor') {
    await doctor(arg)
    return
  }
  if (command === 'drive') {
    if (
      arg !== 'manager-check-availability' &&
      arg !== 'portal-name-search' &&
      arg !== 'portal-address-expiry-sort' &&
      arg !== 'api-worker-health'
    ) {
      fail('drive needs a feature name from the feature map')
      return
    }
    await drive(arg)
    return
  }
  if (command === 'test') {
    await test()
    return
  }
  if (command === 'cleanup') {
    await cleanup()
    return
  }
  if (command === 'evidence') {
    await evidence()
    return
  }
  usage()
  process.exitCode = 1
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
}
