import axios from 'axios'
import { CalenderTemplate, apsInfo, zfInfo } from '@/app/api/google/calendarTemplate'
import { AfterPartyRacesData } from '@/app/dzr-after-party/AfterPartyRaces'
import { ZwiftyFiftyRacesData } from '@/app/the-zwifty-fifty/ZwiftyFiftyRaces'
import { catalogRouteByName } from '@/app/lib/seriesCatalog'
import { displayDate } from '@/packages/shared/seriesRotation'
import {
  SeriesError,
  ensureSeries,
  latestPublished,
  seriesDiscordHeader,
  type SeriesId,
} from '@/app/lib/seriesSchedule'

function raceRow(date: string, route: string, raceID: string) {
  const row = new CalenderTemplate()
  row.date = displayDate(date)
  row.route = route
  row.raceID = raceID
  return row
}

async function messageFor(seriesId: SeriesId, date: string, route: string, raceID: string) {
  const row = raceRow(date, route, raceID)
  const saved = await catalogRouteByName(seriesId, route)
  if (seriesId === 'after-party') {
    const fileRoute = AfterPartyRacesData.find((race) => race.route === route)
    const details = saved
      ? { ...fileRoute, ...saved }
      : fileRoute
    if (!details) throw new SeriesError(`${route} is not an After Party route`)
    const race = apsInfo(row, details)
    const message = `**Race Details for ${race.date}** \n **World:** ${race.world} \n **Route:** [${race.route}](${race.linkRoute}) \n **Laps:** ${race.laps} \n **Distance:** ${race.distance} km \n **Elevation:** ${race.elevation} hm \n **Race Pass:** [Zwift](https://www.zwift.com/events/view/${race.raceID}) \n **More information on:** [www.dzrracingseries.com/dzr-after-party](https://www.dzrracingseries.com/${race.raceSeries.toLowerCase().replace(/\s+/g, '-')}/)`
    return {
      message,
      imageUrl: `https://www.dzrracingseries.com/dzr-after-party/${route.toLowerCase().replace(/\s+/g, '-')}/${route.split(' ').join('-')}-profile.png`,
      webhookUrl: process.env.DISCORD_WEB_HOOK_DZR_AFTER_PARTY || process.env.WEBHOOK_URL,
      webhookEnvName: 'DISCORD_WEB_HOOK_DZR_AFTER_PARTY',
    }
  }
  const fileRoute = ZwiftyFiftyRacesData.find((race) => race.route === route)
  const details = saved
    ? { ...fileRoute, ...saved, length: saved.distance, hm: saved.elevation }
    : fileRoute
  if (!details) throw new SeriesError(`${route} is not a Zwifty Fifty route`)
  const race = zfInfo(row, details)
  const message = `**Race Details for ${race.date}** \n **World:** ${race.world} \n **Route:** [${race.route}](${race.linkRoute}) \n **Laps:** ${race.laps} \n **Distance:** ${race.distance} km \n **Elevation:** ${race.elevation} hm \n **Sprints:** ${race.sprints.join(', ')} \n **Bonus Seconds:** ${race.bonus.join('s, ')}s\n **Race Pass:** [Zwift](https://www.zwift.com/events/view/${race.raceID}) \n **More information on:** [www.dzrracingseries.com/the-zwifty-fifty](https://www.dzrracingseries.com/${race.raceSeries.toLowerCase().replace(/\s+/g, '-')}/)`
  return {
    message,
    imageUrl: `https://www.dzrracingseries.com/the-zwifty-fifty/${route.toLowerCase().replace(/\s+/g, '-')}/${route.split(' ').join('-')}-profile.png`,
    webhookUrl: process.env.DISCORD_WEB_HOOK_THE_ZWIFTY_FIFTY || process.env.WEBHOOK_URL,
    webhookEnvName: 'DISCORD_WEB_HOOK_THE_ZWIFTY_FIFTY',
  }
}

export async function postSeriesDiscord(seriesId: SeriesId, date: string, route: string, raceID: string) {
  const built = await messageFor(seriesId, date, route, raceID)
  if (!built.webhookUrl) throw new SeriesError(`Missing webhook env var: ${built.webhookEnvName}`, 500)
  await axios.post(built.webhookUrl, {
    content: built.message,
    embeds: [
      {
        image: { url: built.imageUrl },
        fields: [{ name: 'Route Profile', value: '' }],
      },
    ],
  })
}

export async function postLatestSeriesDiscord(seriesId: SeriesId) {
  const stored = await ensureSeries(seriesId)
  const published = latestPublished(seriesId, stored)
  if (!published) throw new SeriesError(`No ${seriesDiscordHeader(seriesId)} event has been published`, 404)
  await postSeriesDiscord(seriesId, published.date, published.route, published.raceID)
}
