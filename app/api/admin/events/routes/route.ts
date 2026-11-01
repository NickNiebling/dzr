import { NextResponse } from 'next/server'
import { requireEventEditor } from '@/app/api/admin/_lib/auth'
import { searchDictionaryRoutes } from '@/app/lib/gameDictionary'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const auth = await requireEventEditor(req)
  if (auth.error) return auth.error
  const q = new URL(req.url).searchParams.get('q') || ''
  if (!q.trim()) return NextResponse.json([])
  try {
    return NextResponse.json(await searchDictionaryRoutes(q))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Zwift game dictionary is unavailable right now.'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
