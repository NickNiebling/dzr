import { NextResponse } from 'next/server'
import { requireEventEditor } from '@/app/api/admin/_lib/auth'
import { listDictionaryWorldRoutes } from '@/app/lib/gameDictionary'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const auth = await requireEventEditor(req)
  if (auth.error) return auth.error
  try {
    return NextResponse.json({ worlds: await listDictionaryWorldRoutes() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Zwift game dictionary is unavailable right now.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
