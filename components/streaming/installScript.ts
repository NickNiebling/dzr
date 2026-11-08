export const SCRIPT_FILENAME = 'dzr-stream.lua'

export type ScriptFileHandle = {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>
  createWritable(): Promise<{
    write(data: ArrayBuffer): Promise<void>
    close(): Promise<void>
    abort?(): Promise<void>
  }>
}

export type ScriptDirectoryHandle = {
  name: string
  removeEntry?(name: string): Promise<void>
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<ScriptDirectoryHandle>
  getFileHandle(name: string, options: { create: boolean }): Promise<ScriptFileHandle>
}

export type DirectoryPicker = (options: {
  mode: 'readwrite'
  startIn: 'documents'
}) => Promise<ScriptDirectoryHandle>

export type InstallationResult = {
  status: 'saved' | 'identical' | 'conflict'
  directoryName: string
}

function sameBytes(first: ArrayBuffer, second: ArrayBuffer) {
  if (first.byteLength !== second.byteLength) return false
  const left = new Uint8Array(first)
  const right = new Uint8Array(second)
  return left.every((value, index) => value === right[index])
}

function errorName(error: unknown) {
  return error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
}

export async function fetchScriptFile(url: string, fetcher: typeof fetch = fetch): Promise<ArrayBuffer> {
  try {
    // Same-origin cookies allow protected Vercel previews; the server never forwards them to the bot.
    const response = await fetcher(url, { credentials: 'same-origin', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('script_download_failed')
    const bytes = await response.arrayBuffer()
    if (!bytes.byteLength) throw new Error('script_download_failed')
    return bytes
  } catch (error) {
    if (errorName(error) === 'TimeoutError') throw error
    throw new Error('script_download_failed')
  }
}

export async function installScript({ pickDirectory, fetchScript }: {
  pickDirectory: DirectoryPicker
  fetchScript: () => Promise<ArrayBuffer>
}): Promise<InstallationResult> {
  // The picker must be the first async action: browsers require the original click.
  const selected = await pickDirectory({ mode: 'readwrite', startIn: 'documents' })
  const bytes = await fetchScript()
  if (!bytes.byteLength) throw new Error('script_download_failed')
  const directory = selected.name === 'DZR' ? selected : await selected.getDirectoryHandle('DZR', { create: true })
  const directoryName = selected.name === 'DZR' ? 'DZR' : `${selected.name}/DZR`

  let existing: ScriptFileHandle | undefined
  try {
    existing = await directory.getFileHandle(SCRIPT_FILENAME, { create: false })
  } catch (error) {
    if (errorName(error) !== 'NotFoundError') throw error
  }
  if (existing) {
    const previous = await (await existing.getFile()).arrayBuffer()
    return { status: sameBytes(previous, bytes) ? 'identical' : 'conflict', directoryName }
  }

  const handle = await directory.getFileHandle(SCRIPT_FILENAME, { create: true })
  // Recheck after creation in case another installation created the file meanwhile.
  const current = await (await handle.getFile()).arrayBuffer()
  if (current.byteLength) {
    return { status: sameBytes(current, bytes) ? 'identical' : 'conflict', directoryName }
  }
  let writer: Awaited<ReturnType<ScriptFileHandle['createWritable']>> | undefined
  try {
    writer = await handle.createWritable()
    await writer.write(bytes)
    await writer.close()
  } catch (error) {
    try { await writer?.abort?.() } catch { /* Keep the original write failure. */ }
    // Only the newly created, still-empty artifact can be removed. Existing files
    // returned above, or any file another writer filled meanwhile, stay untouched.
    try {
      const latest = await directory.getFileHandle(SCRIPT_FILENAME, { create: false })
      if (!(await (await latest.getFile()).arrayBuffer()).byteLength) {
        await directory.removeEntry?.(SCRIPT_FILENAME)
      }
    } catch { /* If permission was revoked, the UI offers another folder/download. */ }
    throw error
  }
  return { status: 'saved', directoryName }
}

export function getInstallationErrorMessage(error: unknown) {
  switch (errorName(error)) {
    case 'AbortError': return 'Mappevalget blev ikke gennemført. Prøv igen, eller hent filen i stedet.'
    case 'NotAllowedError': return 'Browseren fik ikke lov til at gemme filen. Vælg mappen igen og tillad adgang, eller hent filen i stedet.'
    case 'SecurityError': return 'Åbn guiden i en almindelig browserfane med sikker forbindelse, eller hent filen i stedet.'
    case 'NotFoundError': return 'Mappen eller filen blev flyttet eller slettet. Vælg mappen igen.'
    case 'TimeoutError': return 'Det tog for lang tid at hente filen. Kontrollér forbindelsen, og prøv igen.'
    default: return error instanceof Error && error.message === 'script_download_failed'
      ? 'Filen kunne ikke hentes fra DZR. Prøv igen om lidt.'
      : 'Filen kunne ikke gemmes færdigt. Der kan ligge en tom fil i mappen. Vælg en anden mappe, eller kontrollér filen, før du prøver igen. Du kan også hente filen i stedet.'
  }
}
