import assert from 'node:assert/strict'
import test from 'node:test'
import { getStreamingSetupConfig, getStreamingScriptResponse } from './streamingSetup.ts'

const env = { STREAMING_PUBLIC_URL: 'https://bot.example.test/' }
const script = '-- DZR Streaming v2.\nlocal obs = obslua\n'

test('script downloads use the configured origin; malformed origins fail closed', () => {
  assert.deepEqual(getStreamingSetupConfig(env), {
    upstreamScriptUrl: 'https://bot.example.test/streaming/dzr-stream.lua',
    scriptUrl: '/api/streaming/script',
  })
  assert.equal(getStreamingSetupConfig({}).upstreamScriptUrl, 'https://bot-tdnm.onrender.com/streaming/dzr-stream.lua')
  for (const value of ['', 'http://bot.test', 'https://user:secret@bot.test',
    'https://bot.test/path', 'https://bot.test?key=secret', 'https://bot.test/#secret']) {
    assert.throws(() => getStreamingSetupConfig({ STREAMING_PUBLIC_URL: value }))
  }
})

test('proxy returns exactly the generic Lua bytes and sends no browser credentials', async () => {
  const response = await getStreamingScriptResponse(env, async (input, init) => {
    assert.equal(input, 'https://bot.example.test/streaming/dzr-stream.lua')
    assert.equal(init?.headers, undefined)
    assert.equal(init?.redirect, 'error')
    assert.ok(init?.signal)
    return new Response(script)
  })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), script)
  assert.match(response.headers.get('content-disposition') || '', /attachment.*dzr-stream\.lua/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
})

test('invalid config, unavailable, empty, HTML and oversized responses cannot become scripts', async () => {
  const cases = [
    async () => new Response('missing', { status: 404 }),
    async () => new Response(''),
    async () => new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } }),
    async () => new Response('-- DZR Streaming' + 'x'.repeat(256 * 1024)),
    async () => { throw new Error('timeout') },
  ]
  for (const fetchImpl of cases) {
    const response = await getStreamingScriptResponse(env, fetchImpl)
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('content-disposition'), null)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  assert.equal((await getStreamingScriptResponse({}, async (url) => {
    assert.equal(url, 'https://bot-tdnm.onrender.com/streaming/dzr-stream.lua')
    return new Response(script)
  })).status, 200)
  assert.equal((await getStreamingScriptResponse({ STREAMING_PUBLIC_URL: '' }, async () => {
    assert.fail('invalid configuration must not reach a server')
  })).status, 503)
})
