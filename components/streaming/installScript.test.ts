import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fetchScriptFile, getInstallationErrorMessage, installScript, SCRIPT_FILENAME,
  type DirectoryPicker, type ScriptDirectoryHandle, type ScriptFileHandle,
} from './installScript.ts'

const bytes = (value: string) => new TextEncoder().encode(value).buffer
const script = () => Promise.resolve(bytes('-- DZR Streaming v2\n'))

function file(initial: string, options: { close?: () => Promise<void>; failWrite?: boolean } = {}) {
  let value = bytes(initial)
  const calls: string[] = []
  const handle: ScriptFileHandle = {
    async getFile() { return { async arrayBuffer() { return value } } },
    async createWritable() {
      calls.push('open')
      let pending = value
      return {
        async write(data) {
          calls.push('write')
          if (options.failWrite) throw new DOMException('No space', 'QuotaExceededError')
          pending = data
        },
        async close() { calls.push('close'); await options.close?.(); value = pending },
        async abort() { calls.push('abort') },
      }
    },
  }
  return { handle, calls, read: () => new TextDecoder().decode(value) }
}

function directory(name = 'Documents', options: { existing?: string; createdFile?: ReturnType<typeof file>; onRead?: () => void } = {}) {
  const target = options.createdFile || file(options.existing || '')
  let exists = options.existing !== undefined
  const calls: string[] = []
  const dzr: ScriptDirectoryHandle = {
    name: 'DZR',
    async getDirectoryHandle() { throw new Error('DZR must not be nested') },
    async getFileHandle(filename, { create }) {
      assert.equal(filename, SCRIPT_FILENAME)
      calls.push(create ? 'create-file' : 'find-file')
      options.onRead?.()
      if (!exists && !create) throw new DOMException('Missing', 'NotFoundError')
      exists = true
      return target.handle
    },
  }
  const selected: ScriptDirectoryHandle = name === 'DZR' ? dzr : {
    name,
    async getDirectoryHandle(child, options) {
      assert.equal(child, 'DZR')
      assert.deepEqual(options, { create: true })
      calls.push('create-directory')
      return dzr
    },
    async getFileHandle() { throw new Error('Must use the DZR directory') },
  }
  const pickDirectory: DirectoryPicker = async (options) => {
    calls.push('picker')
    assert.deepEqual(options, { mode: 'readwrite', startIn: 'documents' })
    return selected
  }
  return { pickDirectory, calls, target }
}

test('opens the user-selected picker before downloading and writes only DZR/dzr-stream.lua', async () => {
  const s = directory()
  const pending = installScript({ pickDirectory: s.pickDirectory, async fetchScript() {
    assert.equal(s.calls[0], 'picker')
    assert.ok(!s.calls.includes('create-directory'))
    return script()
  } })
  assert.equal(s.calls[0], 'picker')
  assert.deepEqual(await pending, { status: 'saved', directoryName: 'Documents/DZR' })
  assert.equal(s.target.read(), '-- DZR Streaming v2\n')
  assert.deepEqual(s.target.calls, ['open', 'write', 'close'])
})

test('using an already selected DZR folder does not create DZR/DZR', async () => {
  const s = directory('DZR')
  assert.deepEqual(await installScript({ pickDirectory: s.pickDirectory, fetchScript: script }), { status: 'saved', directoryName: 'DZR' })
  assert.ok(!s.calls.includes('create-directory'))
})

test('repeated installation of identical bytes reuses the existing file without opening it for writing', async () => {
  const s = directory('Documents', { existing: '-- DZR Streaming v2\n' })
  const result = await installScript({ pickDirectory: s.pickDirectory, fetchScript: script })
  assert.equal(result.status, 'identical')
  assert.deepEqual(s.target.calls, [])
  assert.ok(!s.calls.includes('create-file'))
})

test('a different existing script is preserved byte for byte without opening it for writing', async () => {
  const s = directory('Documents', { existing: '-- My customised script\n' })
  assert.equal((await installScript({ pickDirectory: s.pickDirectory, fetchScript: script })).status, 'conflict')
  assert.equal(s.target.read(), '-- My customised script\n')
  assert.deepEqual(s.target.calls, [])
})

test('an existing empty file is also protected from replacement', async () => {
  const s = directory('Documents', { existing: '' })
  assert.equal((await installScript({ pickDirectory: s.pickDirectory, fetchScript: script })).status, 'conflict')
  assert.deepEqual(s.target.calls, [])
})

test('a file appearing between the initial check and creation is not overwritten', async () => {
  const lateFile = file('-- Added by another installation')
  const s = directory('Documents', { createdFile: lateFile })
  assert.equal((await installScript({ pickDirectory: s.pickDirectory, fetchScript: script })).status, 'conflict')
  assert.equal(lateFile.read(), '-- Added by another installation')
  assert.deepEqual(lateFile.calls, [])
})

test('successful installation is not reported until close has committed the file', async () => {
  let finishClose = () => {}
  let enteredClose = () => {}
  const gate = new Promise<void>((resolve) => { finishClose = resolve })
  const started = new Promise<void>((resolve) => { enteredClose = resolve })
  const target = file('', { async close() { enteredClose(); await gate } })
  const s = directory('DZR', { createdFile: target })
  let completed = false
  const pending = installScript({ pickDirectory: s.pickDirectory, fetchScript: script }).then((value) => { completed = true; return value })
  await started
  assert.equal(completed, false)
  assert.equal(target.read(), '')
  finishClose()
  assert.equal((await pending).status, 'saved')
  assert.equal(target.read(), '-- DZR Streaming v2\n')
})

test('cancelled or denied directory selection never downloads or creates a file', async () => {
  for (const name of ['AbortError', 'NotAllowedError']) {
    const error = new DOMException('Picker stopped', name)
    await assert.rejects(installScript({
      async pickDirectory() { throw error },
      async fetchScript() { assert.fail('must not fetch after picker failure') },
    }), error)
    assert.ok(getInstallationErrorMessage(error).length > 20)
  }
})

test('download failure creates no folder or file and permits retry with the same picker', async () => {
  const s = directory()
  await assert.rejects(installScript({ pickDirectory: s.pickDirectory, async fetchScript() { throw new Error('script_download_failed') } }))
  assert.deepEqual(s.calls, ['picker'])
  assert.equal((await installScript({ pickDirectory: s.pickDirectory, fetchScript: script })).status, 'saved')
})

test('write failures abort the stream and do not claim success', async () => {
  const target = file('', { failWrite: true })
  const s = directory('DZR', { createdFile: target })
  await assert.rejects(installScript({ pickDirectory: s.pickDirectory, fetchScript: script }), { name: 'QuotaExceededError' })
  assert.deepEqual(target.calls, ['open', 'write', 'abort'])
  assert.equal(target.read(), '')
})

test('a deleted directory error is preserved and explained without raw filesystem details', async () => {
  const s = directory('DZR', { onRead() { throw new DOMException('private path', 'NotFoundError') } })
  await assert.rejects(installScript({ pickDirectory: s.pickDirectory, fetchScript: script }), { name: 'NotFoundError' })
  const message = getInstallationErrorMessage(new DOMException('private path', 'NotFoundError'))
  assert.match(message, /flyttet eller slettet/)
  assert.ok(!message.includes('private path'))
})

test('a failed new-file write is cleaned up and can be retried in the same folder', async () => {
  for (const phase of ['open', 'write', 'close']) {
    let exists = false
    let fail = true
    let value = new ArrayBuffer(0)
    const handle: ScriptFileHandle = {
      async getFile() { return { async arrayBuffer() { return value } } },
      async createWritable() {
        if (fail && phase === 'open') throw new Error('open failed')
        let pending = value
        return {
          async write(data) { if (fail && phase === 'write') throw new Error('write failed'); pending = data },
          async close() { if (fail && phase === 'close') throw new Error('close failed'); value = pending },
          async abort() {},
        }
      },
    }
    const target: ScriptDirectoryHandle = {
      name: 'DZR',
      async getDirectoryHandle() { return target },
      async getFileHandle(_name, options) {
        if (!exists && !options.create) throw new DOMException('missing', 'NotFoundError')
        exists = true
        return handle
      },
      async removeEntry(name) { assert.equal(name, SCRIPT_FILENAME); exists = false },
    }
    const options = { pickDirectory: async () => target, fetchScript: script }
    await assert.rejects(installScript(options))
    assert.equal(exists, false)
    fail = false
    assert.equal((await installScript(options)).status, 'saved')
    assert.equal(new TextDecoder().decode(value), '-- DZR Streaming v2\n')
  }
})

test('write failure never removes a file another writer filled meanwhile', async () => {
  let value = new ArrayBuffer(0)
  let removalAttempted = false
  const target = directory('DZR', { createdFile: {
    handle: {
      async getFile() { return { async arrayBuffer() { return value } } },
      async createWritable() {
        value = bytes('-- Another writer’s script')
        throw new Error('locked')
      },
    }, calls: [], read: () => new TextDecoder().decode(value),
  } })
  const selected = await target.pickDirectory({ mode: 'readwrite', startIn: 'documents' })
  selected.removeEntry = async () => { removalAttempted = true }
  await assert.rejects(installScript({ pickDirectory: target.pickDirectory, fetchScript: script }))
  assert.equal(removalAttempted, false)
  assert.equal(target.target.read(), '-- Another writer’s script')
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
