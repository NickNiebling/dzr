const path = require('path')
const { initializeApp, cert, getApps } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const admin = {
  get apps() {
    return getApps()
  },
  initializeApp,
  credential: { cert },
  firestore: getFirestore,
}
const dotenv = require('dotenv')

dotenv.config({ path: path.join(process.cwd(), '.env.local') })
dotenv.config({ path: path.join(process.cwd(), '.env.development.local') })

const CURRENT_YEAR = new Date().getUTCFullYear()

function initFirestore() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    })
  }
  return admin.firestore()
}

async function fetchAllGuildMembers(guildId, botToken) {
  const members = []
  let after = null
  for (;;) {
    const url = new URL(`https://discord.com/api/v10/guilds/${guildId}/members`)
    url.searchParams.set('limit', '1000')
    if (after) url.searchParams.set('after', after)
    const resp = await fetch(url, { headers: { Authorization: `Bot ${botToken}` } })
    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Discord members fetch failed: ${resp.status} ${text}`)
    }
    const batch = await resp.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    members.push(...batch)
    after = batch[batch.length - 1]?.user?.id
    if (batch.length < 1000) break
  }
  return members
}

function maxCovered(paymentsForUser) {
  let max = null
  for (const p of paymentsForUser) {
    const c = p.coveredThroughYear
    if (typeof c === 'number' && (max === null || c > max)) max = c
  }
  return max
}

async function main() {
  const db = initFirestore()
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim()
  const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim()
  if (!guildId || !botToken) throw new Error('Missing DISCORD_GUILD_ID or DISCORD_BOT_TOKEN')

  const settingsSnap = await db.collection('system_settings').doc('global').get()
  const membershipSettings = settingsSnap.exists ? (settingsSnap.data() || {}).membership || {} : {}
  const clubMemberRoleId = String(membershipSettings.clubMemberRoleId || '').trim()
  if (!clubMemberRoleId) throw new Error('clubMemberRoleId not configured in system_settings/global')

  const [paymentsSnap, membershipsSnap, roleUpdatesSnap] = await Promise.all([
    db.collection('payments').get(),
    db.collection('memberships').get(),
    db.collection('role_updates').get(),
  ])

  const succeeded = []
  paymentsSnap.forEach((doc) => {
    const d = doc.data() || {}
    if (String(d.status || '').toLowerCase() !== 'succeeded') return
    succeeded.push({ id: doc.id, ...d })
  })

  const byUser = new Map()
  for (const p of succeeded) {
    const uid = String(p.userId || p.discordId || '').trim()
    if (!uid || uid === 'unknown') continue
    if (!byUser.has(uid)) byUser.set(uid, [])
    byUser.get(uid).push(p)
  }

  const eligibleUsers = []
  const ineligibleSucceeded = []
  for (const [uid, payments] of byUser.entries()) {
    const covered = maxCovered(payments)
    const latest = [...payments].sort((a, b) => {
      const ta = Date.parse(a.paidAt || a.updatedAt || a.createdAt || 0) || 0
      const tb = Date.parse(b.paidAt || b.updatedAt || b.createdAt || 0) || 0
      return tb - ta
    })[0]
    const entry = {
      userId: uid,
      fullName: latest.fullName || '',
      userEmail: latest.userEmail || '',
      coveredThroughYear: covered,
      paymentCount: payments.length,
      paymentIds: payments.map((p) => p.id),
      roleSyncStatuses: payments.map((p) => p.roleSync?.status || '(none)'),
      roleSyncReasons: payments.map((p) => p.roleSync?.reason || null).filter(Boolean),
    }
    if (typeof covered === 'number' && covered >= CURRENT_YEAR) {
      eligibleUsers.push(entry)
    } else {
      ineligibleSucceeded.push(entry)
    }
  }

  const membershipByUser = new Map()
  membershipsSnap.forEach((doc) => {
    const d = doc.data() || {}
    membershipByUser.set(doc.id, d)
  })

  const queuedRoleUpdates = []
  roleUpdatesSnap.forEach((doc) => {
    const d = doc.data() || {}
    const add = Array.isArray(d.addRoleIds) ? d.addRoleIds : []
    if (add.includes(clubMemberRoleId)) {
      queuedRoleUpdates.push({ id: doc.id, userId: d.userId, source: d.source, createdAt: d.createdAt })
    }
  })

  console.log('Fetching Discord guild members...')
  const guildMembers = await fetchAllGuildMembers(guildId, botToken)
  const withRole = new Map()
  const inGuild = new Set()
  for (const m of guildMembers) {
    const id = String(m.user?.id || '')
    if (!id) continue
    inGuild.add(id)
    const roles = Array.isArray(m.roles) ? m.roles : []
    if (roles.includes(clubMemberRoleId)) {
      withRole.set(id, {
        userId: id,
        username: m.user?.username || '',
        globalName: m.user?.global_name || '',
        nick: m.nick || '',
      })
    }
  }

  const missingRole = eligibleUsers
    .filter((u) => !withRole.has(u.userId))
    .map((u) => ({
      ...u,
      inGuild: inGuild.has(u.userId),
      membershipStatus: membershipByUser.get(u.userId)?.currentStatus || '(no membership doc)',
      membershipCovered: membershipByUser.get(u.userId)?.coveredThroughYear ?? null,
    }))
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)))

  const hasRoleButNotEligible = [...withRole.values()]
    .filter((m) => !eligibleUsers.some((u) => u.userId === m.userId))
    .sort((a, b) => String(a.username).localeCompare(String(b.username)))

  const unknownPayments = succeeded.filter((p) => {
    const uid = String(p.userId || p.discordId || '').trim()
    return !uid || uid === 'unknown'
  })

  const result = {
    currentYear: CURRENT_YEAR,
    clubMemberRoleId,
    counts: {
      succeededPayments: succeeded.length,
      uniquePayers: byUser.size,
      eligibleForClubRoleNow: eligibleUsers.length,
      discordWithClubRole: withRole.size,
      missingClubRole: missingRole.length,
      succeededButNotEligibleThisYear: ineligibleSucceeded.length,
      unknownUserPayments: unknownPayments.length,
      queuedClubRoleUpdates: queuedRoleUpdates.length,
      discordGuildMembers: guildMembers.length,
    },
    missingRole,
    ineligibleSucceeded,
    unknownPayments: unknownPayments.map((p) => ({
      id: p.id,
      fullName: p.fullName || '',
      userEmail: p.userEmail || '',
      userId: p.userId || '',
      coveredThroughYear: p.coveredThroughYear ?? null,
      roleSync: p.roleSync || null,
    })),
    hasRoleButNotEligible,
    queuedRoleUpdates,
  }

  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
