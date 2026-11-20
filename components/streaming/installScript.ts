export const SCRIPT_FILENAME = 'dzr-stream.lua'

export type SaveFilePicker = (options: {
  suggestedName: string
  startIn: 'documents'
  types: { description: string; accept: { 'text/plain': string[] } }[]
  excludeAcceptAllOption: boolean
}) => Promise<{
  name: string
  createWritable(): Promise<{
    write(data: ArrayBuffer): Promise<void>
    close(): Promise<void>
    abort(): Promise<void>
  }>
}>

type SavePickerContext = {
  isSecureContext: boolean
  showSaveFilePicker?: SaveFilePicker
}

export function supportsSavePicker(context: SavePickerContext) {
  return context.isSecureContext && typeof context.showSaveFilePicker === 'function'
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

export async function installScript({ pickFile, fetchScript }: {
  pickFile: SaveFilePicker
  fetchScript: () => Promise<ArrayBuffer>
}): Promise<string> {
  // Open the native dialog during the click. It handles confirmation if a file already exists.
  const handle = await pickFile({
    suggestedName: SCRIPT_FILENAME,
    startIn: 'documents',
    types: [{ description: 'Lua-script', accept: { 'text/plain': ['.lua'] } }],
    excludeAcceptAllOption: true,
  })
  const bytes = await fetchScript()
  if (!bytes.byteLength) throw new Error('script_download_failed')

  const writer = await handle.createWritable()
  try {
    await writer.write(bytes)
    await writer.close()
  } catch (error) {
    try { await writer.abort() } catch { /* Keep the original write failure. */ }
    throw error
  }
  return handle.name
}

export function getInstallationErrorMessage(error: unknown) {
  switch (errorName(error)) {
    case 'AbortError': return 'Gem som blev annulleret. Klik på Gem DZR-script for at prøve igen.'
    case 'NotAllowedError': return 'Browseren fik ikke lov til at gemme filen. Prøv igen, og tillad adgang.'
    case 'SecurityError': return 'Åbn guiden i en almindelig browserfane med sikker forbindelse, og prøv igen.'
    case 'NotFoundError': return 'Mappen eller filen blev flyttet eller slettet. Vælg en placering igen.'
    case 'TimeoutError': return 'Det tog for lang tid at hente filen. Kontrollér forbindelsen, og prøv igen.'
    default: return error instanceof Error && error.message === 'script_download_failed'
      ? 'Filen kunne ikke hentes fra DZR. Prøv igen om lidt.'
      : 'Filen kunne ikke gemmes færdigt. Der kan ligge en tom fil i mappen. Kontrollér filen, eller vælg en anden placering, og prøv igen.'
  }
}
