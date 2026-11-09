import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createConnection, createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../package.json', import.meta.url))
for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
  if (existsSync(join(root, name))) throw new Error(`Use a clean checkout without ${name}; this runner must not load production configuration`)
}
const port = 3100
// Fail before making any request if another website already owns the test port.
await new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(port, '127.0.0.1', () => probe.close(resolve))
})

// Reuse Firestore's installed transport dependencies. This fixture returns empty
// reads for the site layout and rejects every write; it is not a real database.
const firestoreRequire = createRequire(require.resolve('@google-cloud/firestore/package.json'))
const grpc = firestoreRequire('@grpc/grpc-js')
const loader = firestoreRequire('@grpc/proto-loader')
const protoDir = join(dirname(require.resolve('@google-cloud/firestore/package.json')), 'build/protos')
const proto = loader.loadSync(join(protoDir, 'google/firestore/v1/firestore.proto'), {
  includeDirs: [protoDir], longs: String, enums: String,
})
const fixture = new grpc.Server()
fixture.addService(grpc.loadPackageDefinition(proto).google.firestore.v1.Firestore.service, {
  runQuery(call) { call.end() },
  batchGetDocuments(call) {
    for (const name of call.request.documents || []) call.write({ missing: name })
    call.end()
  },
})

const children = []
function signalChild(child, signal) {
  if (!child.pid) return
  try {
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (error) { if (error.code !== 'ESRCH') throw error }
}
async function stopChildren() {
  for (const child of children.reverse()) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue
    const exited = new Promise(resolve => child.once('exit', resolve))
    signalChild(child, 'SIGTERM')
    const timer = setTimeout(() => signalChild(child, 'SIGKILL'), 5000)
    await exited
    clearTimeout(timer)
  }
}
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = true
  for (const child of children) signalChild(child, 'SIGTERM')
})

try {
  const fixturePort = await new Promise((resolve, reject) => fixture.bindAsync(
    '127.0.0.1:0', grpc.ServerCredentials.createInsecure(),
    (error, port) => error ? reject(error) : resolve(port),
  ))
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const siteUrl = `http://127.0.0.1:${port}`
  // Do not inherit Firebase, Discord, provider, Sentry or cloud credentials.
  const allowed = ['PATH', 'SystemRoot', 'COMSPEC', 'TMPDIR', 'TMP', 'TEMP',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
    'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'NODE_EXTRA_CA_CERTS']
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.includes(key))),
    NODE_ENV: 'development', NODE_OPTIONS: '--max-old-space-size=6144', NEXT_TELEMETRY_DISABLED: '1',
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${fixturePort}`,
    FIREBASE_PROJECT_ID: 'demo-dzr-streaming',
    FIREBASE_CLIENT_EMAIL: 'local-test@demo-dzr-streaming.iam.gserviceaccount.com',
    FIREBASE_PRIVATE_KEY: privateKey,
    FIREBASE_STORAGE_BUCKET: 'demo-dzr-streaming.appspot.com',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-dzr-streaming',
    NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaSy' + '0'.repeat(33),
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-dzr-streaming.firebaseapp.com',
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-dzr-streaming.appspot.com',
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
    NEXT_PUBLIC_FIREBASE_APP_ID: '1:1234567890:web:demo-streaming',
    NEXTAUTH_SECRET: randomBytes(32).toString('hex'), NEXTAUTH_URL: siteUrl,
    // The browser test intercepts script downloads and uses the repository Lua.
    STREAMING_PUBLIC_URL: 'https://streaming-test.invalid',
  }
  function start(args, childEnv) {
    const child = spawn(process.execPath, args, { cwd: root, env: childEnv, stdio: 'inherit', detached: process.platform !== 'win32' })
    const done = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
    // Attach immediately, including while waiting for Next to listen.
    done.catch(() => {})
    children.push(child)
    return { child, done }
  }
  const site = start(['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], env)
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (interrupted || site.child.exitCode !== null || site.child.signalCode !== null) throw new Error('Test website stopped before it was ready')
    ready = await new Promise(resolve => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
    if (ready) break
    await delay(500)
  }
  if (!ready) throw new Error('Test website did not listen within 30 seconds')
  const browserVariables = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TMPDIR', 'TMP', 'TEMP', 'CHROME_BIN', 'PLAYWRIGHT_BROWSERS_PATH', 'XDG_CACHE_HOME']
  const test = start(['scripts/test-streaming-setup-browser.mjs'], {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => browserVariables.includes(key))),
    STREAMING_TEST_SITE_URL: siteUrl,
  })
  const result = await Promise.race([
    test.done,
    site.done.then(() => { throw new Error('Test website stopped during browser regression') }),
  ])
  if (interrupted || result.code !== 0) throw new Error(`Browser regression failed (${result.signal || result.code})`)
} finally {
  await stopChildren()
  fixture.forceShutdown()
}
