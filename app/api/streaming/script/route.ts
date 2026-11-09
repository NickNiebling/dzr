import { getStreamingScriptResponse } from '@/app/lib/streamingSetup'

export const runtime = 'nodejs'

export async function GET() {
  return getStreamingScriptResponse()
}
