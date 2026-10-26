import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'
import { adminDb } from '@/app/utils/firebaseAdminConfig'
import { resolvePaymentOptions, usesPaymentOptionFallback } from '@/app/lib/membershipPaymentOptions'
import { getOnboardingSessionFromRequest } from '@/app/api/onboarding/_lib/session'
import { vippsCreateCheckoutSession } from '@/app/api/membership/vippsClient'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getBaseUrl(req: Request): string {
  const envUrl = String(process.env.NEXTAUTH_URL || '').trim()
  if (envUrl) return envUrl.replace(/\/+$/, '')
  const url = new URL(req.url)
  return `${url.protocol}//${url.host}`
}

export async function POST(req: Request) {
  try {
    const onboarding = await getOnboardingSessionFromRequest(req)
    if (!onboarding) return NextResponse.json({ error: 'Missing onboarding session' }, { status: 401 })
    if (!onboarding.session.steps?.discordLinked || !onboarding.session.discordId) {
      return NextResponse.json({ error: 'Discord profile is not linked yet' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({} as any))
    const amountDkk = Number(body?.amountDkk)
    const fullName = String(body?.fullName || '').trim()
    const selectedOptionId = String(body?.selectedOptionId || '').trim()
    if (!amountDkk || amountDkk <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
    if (!fullName) return NextResponse.json({ error: 'Full name required' }, { status: 400 })
    if (!selectedOptionId) return NextResponse.json({ error: 'Payment year selection required' }, { status: 400 })

    const settingsDoc = await adminDb.collection('system_settings').doc('global').get()
    const membership = (settingsDoc.exists ? (settingsDoc.data() as any)?.membership : null) || {}
    const minAmount = Number(membership?.minAmountDkk ?? 10)
    const maxAmount = Number(membership?.maxAmountDkk ?? 100)
    if (amountDkk < minAmount || amountDkk > maxAmount) {
      return NextResponse.json({ error: `Amount must be between ${minAmount} and ${maxAmount} DKK` }, { status: 400 })
    }
    if (usesPaymentOptionFallback(membership?.paymentOptions)) {
      console.error('[membership] paymentOptions missing; onboarding payment is using the current-year fallback')
    }
    const paymentOptions = resolvePaymentOptions(membership?.paymentOptions)
    const selected = paymentOptions.find((o) => String(o?.id || '') === selectedOptionId)
    if (!selected || !Array.isArray(selected.coversYears) || selected.coversYears.length === 0) {
      return NextResponse.json({ error: 'Invalid payment option' }, { status: 400 })
    }

    const userId = onboarding.session.discordId
    const userEmail = onboarding.session.discordEmail || undefined
    const optionLabel = selected.label || selected.id
    const referenceBase = `onb-${onboarding.sessionId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`
    const reference = `${referenceBase}-${Date.now()}`
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .slice(0, 64)
      .padEnd(8, '0')

    const siteUrl = getBaseUrl(req)
    const returnUrl = `${siteUrl}/join/payment?checkoutReference=${encodeURIComponent(reference)}`
    const isHttps = siteUrl.startsWith('https://')
    const callbackUrl = process.env.VIPPS_ONBOARDING_CALLBACK_URL || (
      isHttps ? `${siteUrl}/api/onboarding/payment/callback` : `https://webhook.site/${reference}`
    )

    await adminDb.collection('payments').doc(`checkout_${reference}`).set({
      onboardingSessionId: onboarding.sessionId,
      onboardingFlow: true,
      userId,
      discordId: userId,
      userEmail: String(userEmail || ''),
      fullName,
      amountDkk: Number(amountDkk),
      currency: 'DKK',
      paymentProvider: 'vipps-checkout',
      checkout: {
        reference,
        state: 'CREATED',
      },
      status: 'created',
      coversYears: selected.coversYears,
      coveredThroughYear: Math.max(...selected.coversYears),
      attribution: onboarding.session.utm || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true })

    const nameParts = fullName.split(/\s+/)
    const firstName = nameParts[0] || ''
    const lastName = nameParts.slice(1).join(' ') || ''

    const session = await vippsCreateCheckoutSession({
      type: 'PAYMENT',
      reference,
      transaction: {
        amount: { value: Math.round(amountDkk * 100), currency: 'DKK' },
        paymentDescription: `DZR Membership ${optionLabel}`,
      },
      merchantInfo: {
        returnUrl,
        callbackUrl,
        callbackAuthorizationToken: process.env.VIPPS_CALLBACK_TOKEN || 'dzr-callback-token',
      },
      prefillCustomer: {
        firstName,
        lastName,
        email: userEmail || undefined,
      },
      configuration: {
        customerInteraction: 'CUSTOMER_PRESENT',
        elements: 'PaymentOnly',
        countries: { supported: ['DK'] },
      },
    })

    const checkoutFrontendUrl = String(session?.checkoutFrontendUrl || '').trim()
    const sessionToken = String(session?.token || '').trim()
    if (!checkoutFrontendUrl || !sessionToken) {
      return NextResponse.json({ error: 'Vipps Checkout did not return checkout URL/token' }, { status: 502 })
    }
    const url = `${checkoutFrontendUrl}${checkoutFrontendUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(sessionToken)}`

    await adminDb.collection('payments').doc(`checkout_${reference}`).set({
      checkout: {
        reference,
        token: session.token || null,
        pollingUrl: session.pollingUrl || null,
        state: 'INITIATED',
      },
      status: 'initiated',
      updatedAt: new Date().toISOString(),
    }, { merge: true })

    return NextResponse.json({ reference, url }, { status: 200 })
  } catch (err: any) {
    Sentry.captureException(err)
    return NextResponse.json({ error: err?.message || 'Failed to create onboarding payment session' }, { status: 500 })
  }
}
