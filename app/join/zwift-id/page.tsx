'use client'

import React from 'react'
import { Box, Button, Container, FormControl, FormLabel, Heading, Input, Stack, Text } from '@chakra-ui/react'
import { track } from '@vercel/analytics'
import { signIn } from 'next-auth/react'
import StepProgressHeader from '@/components/onboarding/StepProgressHeader'

type SessionState = {
  session: {
    steps?: { paymentSucceeded?: boolean; zwiftLinked?: boolean }
    zwiftId?: string | null
  } | null
}
type OnboardingStatusResponse = { membershipAlreadyPaid?: boolean; coveredThroughYear?: number | null; zwiftId?: string | null }

export default function JoinZwiftIdPage() {
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [canEdit, setCanEdit] = React.useState(false)
  const [isComplete, setIsComplete] = React.useState(false)
  const [zwiftId, setZwiftId] = React.useState('')
  const [message, setMessage] = React.useState('')

  React.useEffect(() => {
    let ignore = false
    async function load() {
      const [res, statusRes] = await Promise.all([
        fetch('/api/onboarding/session', { cache: 'no-store' }),
        fetch('/api/onboarding/status', { cache: 'no-store' }),
      ])
      const data = (await res.json()) as SessionState
      if (ignore) return
      const paidInSession = Boolean(data?.session?.steps?.paymentSucceeded)
      const sessionZwiftId = data?.session?.zwiftId ? String(data.session.zwiftId) : ''
      const sessionZwiftLinked = Boolean(data?.session?.steps?.zwiftLinked)
      setCanEdit(paidInSession)
      if (sessionZwiftId) setZwiftId(sessionZwiftId)

      let paidByMembership = false
      let statusZwiftId = ''
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as OnboardingStatusResponse
        paidByMembership = Boolean(statusData?.membershipAlreadyPaid)
        if (paidByMembership) {
          setCanEdit(true)
        }
        if (statusData?.zwiftId) {
          statusZwiftId = String(statusData.zwiftId)
          setZwiftId(statusZwiftId)
        }
      }

      const paid = paidInSession || paidByMembership
      const hasZwiftId = Boolean(statusZwiftId || sessionZwiftId || sessionZwiftLinked)
      if (paid && hasZwiftId) {
        setIsComplete(true)
        if (statusZwiftId || sessionZwiftId) {
          setMessage(`Alt er i orden. Kontingent er betalt, og Zwift ID er allerede sat (${statusZwiftId || sessionZwiftId}).`)
        } else {
          setMessage('Alt er i orden. Kontingent er betalt, og Zwift ID er allerede sat.')
        }
      }

      setLoading(false)
      track('onboarding_step_view', { step: 'zwift_id' })
    }
    load().catch(() => setLoading(false))
    return () => {
      ignore = true
    }
  }, [])

  async function saveZwiftId() {
    try {
      setSaving(true)
      setMessage('')
      const res = await fetch('/api/onboarding/zwift-id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zwiftId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Kunne ikke gemme Zwift ID')
      track('onboarding_step3_zwift_saved')
      window.location.href = '/join/complete'
    } catch (err: any) {
      setMessage(err?.message || 'Kunne ikke gemme Zwift ID')
      setSaving(false)
    }
  }

  if (!canEdit && !loading) {
    return (
      <Container maxW="4xl" py={10}>
        <Stack spacing={4}>
          <StepProgressHeader currentStep={3} />
          <Heading color="white">Bliv medlem af DZR - Trin 3 af 3</Heading>
          <Text color="gray.300">Gennemfør betaling før du indtaster dit Zwift ID.</Text>
          <Button as="a" href="/join/payment" colorScheme="red">
            Gå til trin 2
          </Button>
        </Stack>
      </Container>
    )
  }

  if (isComplete && !loading) {
    return (
      <Container maxW="4xl" py={10}>
        <Stack spacing={6}>
          <StepProgressHeader currentStep={4} />
          <Heading color="white">Bliv medlem af DZR - indmeldelse gennemført</Heading>
          <Text color="gray.300">
            Alt er i orden. Dit kontingent er allerede betalt, og dit Zwift ID er allerede sat.
          </Text>
          {message ? <Text color="green.300">{message}</Text> : null}
          <Button colorScheme="red" onClick={() => signIn('discord', { callbackUrl: '/members-zone' })}>
            Log ind på medlemsområdet
          </Button>
          <Button as="a" href="/join/complete" variant="outline" color="white" borderColor="whiteAlpha.400">
            Fortsæt
          </Button>
        </Stack>
      </Container>
    )
  }

  return (
    <Container maxW="4xl" py={10}>
      <Stack spacing={6}>
        <StepProgressHeader currentStep={3} />
        <Heading color="white">Bliv medlem af DZR - Trin 3 af 3</Heading>
        <Text color="gray.300">Indtast dit Zwift ID for at færdiggøre indmeldelsen.</Text>
        {message ? <Text color="orange.300">{message}</Text> : null}
        <FormControl>
          <FormLabel color="white">Zwift ID</FormLabel>
          <Input value={zwiftId} onChange={(e) => setZwiftId(e.target.value)} bg="white" color="black" placeholder="fx 1234567" />
        </FormControl>
        <Button onClick={saveZwiftId} isLoading={saving || loading} colorScheme="red">
          Færdiggør indmeldelse
        </Button>

        <Box borderWidth="1px" borderColor="gray.700" borderRadius="md" bg="gray.900" p={4}>
          <Stack spacing={2}>
            <Text color="white" fontWeight="bold">Sådan finder du dit Zwift ID</Text>
            <Text color="gray.300">
              Se vejledning fra Zwift her: {' '}
              <Text
                as="a"
                href="https://support.zwift.com/locating-your-zwift-id-H1WiyxS_I"
                target="_blank"
                rel="noopener noreferrer"
                color="blue.300"
                textDecoration="underline"
              >
                Find dit Zwift ID hos Zwift
              </Text>
            </Text>
          </Stack>
        </Box>
      </Stack>
    </Container>
  )
}
