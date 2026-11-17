import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchScriptFile, getInstallationErrorMessage, installScript, SCRIPT_FILENAME,
  supportsSavePicker, type SaveFilePicker,
} from './installScript.ts'

const bytes = (value: string) => new TextEncoder().encode(value).buffer
const script = () => Promise.resolve(bytes('-- DZR Streaming v2\n'))

test('only a secure context with a callable save picker supports native saving', () => {
  const showSaveFilePicker: SaveFilePicker = async () => { throw new Error('Detection must not open a dialog') }
  assert.equal(supportsSavePicker({ isSecureContext: true, showSaveFilePicker }), true)
  assert.equal(supportsSavePicker({ isSecureContext: false, showSaveFilePicker }), false)
  assert.equal(supportsSavePicker({ isSecureContext: true }), false)
})

test('opens Save As during the click, writes the script, and returns the chosen filename after closing', async () => {
  const calls: string[] = []
  const pending = installScript({
    async pickFile(options) {
      calls.push('picker')
      assert.deepEqual(options, {
        suggestedName: SCRIPT_FILENAME,
        startIn: 'documents',
        types: [{ description: 'Lua-script', accept: { 'text/plain': ['.lua'] } }],
        excludeAcceptAllOption: true,
      })
      return {
        name: 'custom.lua',
        async createWritable() {
          calls.push('open')
          return {
            async write(data) {
              assert.deepEqual(data, await script())
              calls.push('write')
            },
            async close() { calls.push('close') },
            async abort() { assert.fail('successful write must not abort') },
          }
        },
      }
    },
    async fetchScript() { calls.push('fetch'); return script() },
  })
  assert.deepEqual(calls, ['picker'])
  assert.equal(await pending, 'custom.lua')
  assert.deepEqual(calls, ['picker', 'fetch', 'open', 'write', 'close'])
})

test('cancelling or denying Save As prevents the download', async () => {
  for (const name of ['AbortError', 'NotAllowedError']) {
    const error = new DOMException('Picker stopped', name)
    await assert.rejects(installScript({
      async pickFile() { throw error },
      async fetchScript() { assert.fail('must not fetch after picker failure') },
    }), error)
  }
})

test('a failed or empty fetch never opens the selected file for writing', async () => {
  for (const fetchScript of [async () => { throw new Error('script_download_failed') }, async () => new ArrayBuffer(0)]) {
    await assert.rejects(installScript({
      async pickFile() {
        return {
          name: SCRIPT_FILENAME,
          async createWritable() { assert.fail('must not write after fetch failure') },
        }
      },
      fetchScript,
    }), /script_download_failed/)
  }
})

test('write and close failures abort the stream and preserve the original error', async () => {
  for (const phase of ['write', 'close']) {
    const failure = new Error(phase)
    let aborted = false
    await assert.rejects(installScript({
      async pickFile() {
        return {
          name: SCRIPT_FILENAME,
          async createWritable() {
            return {
              async write() { if (phase === 'write') throw failure },
              async close() { throw failure },
              async abort() { aborted = true; throw new Error('abort failed') },
            }
          },
        }
      },
      fetchScript: script,
    }), failure)
    assert.equal(aborted, true)
  }
})

test('ordinary downloads preserve script bytes and restrict browser credentials to the same origin', async () => {
  let request: RequestInit | undefined
  const received = await fetchScriptFile('/api/streaming/script', async (url, options) => {
    assert.equal(url, '/api/streaming/script')
    request = options
    return new Response('-- DZR Streaming v2\n')
  })
  assert.equal(request?.credentials, 'same-origin')
  assert.ok(request?.signal instanceof AbortSignal)
  assert.equal(new TextDecoder().decode(received), '-- DZR Streaming v2\n')
})

test('failed and empty downloads are never offered as Lua files', async () => {
  await assert.rejects(fetchScriptFile('/api/streaming/script', async () => new Response('Unavailable', { status: 503 })), /script_download_failed/)
  await assert.rejects(fetchScriptFile('/api/streaming/script', async () => new Response('')), /script_download_failed/)
})

test('network errors explain download recovery instead of claiming a local write failed', async () => {
  let failure: unknown
  try {
    await fetchScriptFile('/api/streaming/script', async () => { throw new TypeError('Failed to fetch') })
  } catch (error) { failure = error }
  assert.match(getInstallationErrorMessage(failure), /kunne ikke hentes/)
  assert.ok(!getInstallationErrorMessage(failure).includes('tom fil'))
})
