/** Server-side configuration shared by the guide and its Lua download route. */
export function getStreamingSetupConfig(env: { STREAMING_PUBLIC_URL?: string } = { STREAMING_PUBLIC_URL: process.env.STREAMING_PUBLIC_URL }) {
  const value = env.STREAMING_PUBLIC_URL
  if (!value) throw new Error('STREAMING_PUBLIC_URL is required')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('STREAMING_PUBLIC_URL must be an HTTPS origin')
  }
  return {
    callbackUrl: `${url.origin}/streaming/obs`,
    upstreamScriptUrl: `${url.origin}/streaming/dzr-stream.lua`,
    scriptUrl: '/api/streaming/script',
  }
}

/** Never proxy request headers, cookies, credentials or a user-supplied destination. */
export async function getStreamingScriptResponse(
  env: { STREAMING_PUBLIC_URL?: string } = { STREAMING_PUBLIC_URL: process.env.STREAMING_PUBLIC_URL },
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  try {
    const { upstreamScriptUrl } = getStreamingSetupConfig(env)
    const response = await fetchImpl(upstreamScriptUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    if (!response.ok || response.headers.get('content-type')?.includes('text/html')) throw new Error('download_failed')
    // The generic script is small. Bound both streaming and buffered responses.
    const reader = response.body?.getReader()
    if (!reader) throw new Error('empty_download')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        length += chunk.value.length
        if (length > 256 * 1024) throw new Error('download_too_large')
        chunks.push(chunk.value)
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    if (!new TextDecoder().decode(bytes).startsWith('-- DZR Streaming')) throw new Error('invalid_script')
    return new Response(bytes, { headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="dzr-stream.lua"',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch {
    return new Response('DZR-scriptet kunne ikke hentes. Gå tilbage til guiden, og prøv igen om lidt.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
}
