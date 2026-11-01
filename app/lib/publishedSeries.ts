import { cache } from 'react'
import { connection } from 'next/server'
import { listPublishedSeries } from '@/app/lib/eventSeries'
import type { PublishedSeriesLink } from '@/app/lib/publishedSeriesLink'

/** Published event series for the menu and the homepage cards. Loaded with the page. */
export const getPublishedSeries = cache(async (): Promise<PublishedSeriesLink[]> => {
  await connection()
  try {
    return await listPublishedSeries()
  } catch {
    return []
  }
})
