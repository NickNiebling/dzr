'use client'

import React from 'react'
import {
  Box,
  Button,
  Container,
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Input,
  Slider,
  SliderFilledTrack,
  SliderThumb,
  Spinner,
  SliderTrack,
  Stack,
  Text,
} from '@chakra-ui/react'
import { track } from '@vercel/analytics'
import { signIn } from 'next-auth/react'
import StepProgressHeader from '@/components/onboarding/StepProgressHeader'

type PaymentOption = { id: string; label?: string; coversYears?: number[] }
type SettingsResponse = { minAmountDkk: number; maxAmountDkk: number; paymentOptions: PaymentOption[] }
type OnboardingSessionResponse = { session: { steps?: { discordLinked?: boolean; paymentSucceeded?: boolean } } | null }
type OnboardingStatusResponse = { membershipAlreadyPaid?: boolean; coveredThroughYear?: number | null; zwiftId?: string | null }

export default function JoinPaymentPage() {
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [canPay, setCanPay] = React.useState(false)
  const [paymentDone, setPaymentDone] = React.useState(false)
  const [settings, setSettings] = React.useState<SettingsResponse | null>(null)
  const [amount, setAmount] = React.useState(50)
  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const [selectedOptionId, setSelectedOptionId] = React.useState('')
  const [message, setMessage] = React.useState<string>('')
  const [messageColor, setMessageColor] = React.useState<string>('orange.300')
  const [isPolling, setIsPolling] = React.useState(false)
  const [alreadyPaid, setAlreadyPaid] = React.useState(false)
  const [coveredThroughYear, setCoveredThroughYear] = React.useState<number | null>(null)
  async function refreshOnboardingStatus() {
    const statusRes = await fetch('/api/onboarding/status', { cache: 'no-store' })
    if (!statusRes.ok) return
    const statusData = (await statusRes.json()) as OnboardingStatusResponse
    const paid = Boolean(statusData?.membershipAlreadyPaid)
    setAlreadyPaid(paid)
    setCoveredThroughYear(typeof statusData?.coveredThroughYear === 'number' ? statusData.coveredThroughYear : null)
    if (paid) {
      setPaymentDone(true)
    }
  }
  const rangeText = React.useMemo(() => {
    const min = settings?.minAmountDkk
    const max = settings?.maxAmountDkk
    if (typeof min === 'number' && typeof max === 'number') {
      return `Kontingentet er valgfrit mellem ${min} og ${max} DKK.`
    }
    return ''
  }, [settings])

  React.useEffect(() => {
    if (selectedOptionId) return
    const firstOptionId = String(settings?.paymentOptions?.[0]?.id || '').trim()
    if (firstOptionId) {
      setSelectedOptionId(firstOptionId)
    }
  }, [settings, selectedOptionId])

  const pollTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    let ignore = false

    async function pollConfirmation(ref: string, attemptsLeft: number) {
      if (ignore) return
      if (attemptsLeft <= 0) {
        setIsPolling(false)
        setMessage('Betalingen er endnu ikke bekræftet. Prøv at genindlæse siden eller kontakt support.')
        setMessageColor('orange.300')
        return
      }
      pollTimerRef.current = setTimeout(async () => {
        if (ignore) return
        try {
          const res = await fetch(`/api/onboarding/payment/confirm?reference=${encodeURIComponent(ref)}`, { cache: 'no-store' })
          const data = await res.json().catch(() => ({}))
          if (ignore) return
          if (res.ok && data?.status === 'succeeded') {
            setIsPolling(false)
            track('onboarding_step2_payment_succeeded')
            await refreshOnboardingStatus()
            window.location.href = '/join/zwift-id'
          } else if (data?.status === 'pending') {
            pollConfirmation(ref, attemptsLeft - 1)
          } else if (data?.status === 'failed') {
            setIsPolling(false)
            setMessage('Betalingen mislykkedes. Prøv igen.')
            setMessageColor('red.300')
          } else {
            pollConfirmation(ref, attemptsLeft - 1)
          }
        } catch {
          if (!ignore) pollConfirmation(ref, attemptsLeft - 1)
        }
      }, 3000)
    }

    async function load() {
      const [sRes, sessionRes, statusRes] = await Promise.all([
        fetch('/api/membership/settings', { cache: 'no-store' }),
        fetch('/api/onboarding/session', { cache: 'no-store' }),
        fetch('/api/onboarding/status', { cache: 'no-store' }),
      ])
      const session = (await sessionRes.json()) as OnboardingSessionResponse
      if (ignore) return
      setCanPay(Boolean(session?.session?.steps?.discordLinked))
      setPaymentDone(Boolean(session?.session?.steps?.paymentSucceeded))
      let paidNow = false
      if (statusRes.ok) {
        const statusData = (await statusRes.json()) as OnboardingStatusResponse
        const paid = Boolean(statusData?.membershipAlreadyPaid)
        paidNow = paid
        setAlreadyPaid(paid)
        setCoveredThroughYear(typeof statusData?.coveredThroughYear === 'number' ? statusData.coveredThroughYear : null)
        if (paid) {
          setPaymentDone(true)
          setMessage(
            typeof statusData?.coveredThroughYear === 'number'
              ? `Kontingent er allerede betalt (dækket til og med ${statusData.coveredThroughYear}).`
              : 'Kontingent er allerede betalt.'
          )
          setMessageColor('green.300')
        }
      }

      if (sRes.ok) {
        const s = (await sRes.json()) as SettingsResponse
        if (ignore) return
        setSettings(s)
        const initial = Math.min(Math.max(50, Number(s.minAmountDkk || 10)), Number(s.maxAmountDkk || 100))
        setAmount(initial)
        if (!paidNow && (!Array.isArray(s.paymentOptions) || s.paymentOptions.length === 0)) {
          setMessage('Betalingsperiode kunne ikke indlæses. Genindlæs siden, eller skriv til DZR hvis det fortsætter.')
          setMessageColor('red.300')
        }
      } else if (!paidNow) {
        setMessage('Kunne ikke hente betalingsperiode. Genindlæs siden.')
        setMessageColor('red.300')
      }

      const ref = new URLSearchParams(window.location.search).get('checkoutReference')
      if (ref) {
        const confirmRes = await fetch(`/api/onboarding/payment/confirm?reference=${encodeURIComponent(ref)}`, { cache: 'no-store' })
        const confirmData = await confirmRes.json().catch(() => ({}))
        if (ignore) return
        if (confirmRes.ok && confirmData?.status === 'succeeded') {
          track('onboarding_step2_payment_succeeded')
          await refreshOnboardingStatus()
          window.location.href = '/join/zwift-id'
          return
        } else if (confirmData?.status === 'pending') {
          setMessage('Bekræfter betaling…')
          setMessageColor('orange.300')
          setIsPolling(true)
          setLoading(false)
          track('onboarding_step_view', { step: 'payment' })
          pollConfirmation(ref, 10)
          return
        } else if (confirmData?.status === 'failed') {
          setMessage('Betalingen mislykkedes. Prøv igen.')
          setMessageColor('red.300')
        } else if (!confirmRes.ok) {
          setMessage(confirmData?.error || 'Kunne ikke bekræfte betalingen. Prøv at genindlæse siden.')
          setMessageColor('red.300')
        }
      }

      setLoading(false)
      track('onboarding_step_view', { step: 'payment' })
    }
    load().catch(() => {
      if (ignore) return
      setMessage('Kunne ikke hente betalingsperiode. Genindlæs siden.')
      setMessageColor('red.300')
      setLoading(false)
    })
    return () => {
      ignore = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [])

  async function startPayment() {
    try {
      setSaving(true)
      setMessage('')
      const fullName = `${firstName} ${lastName}`.trim()
      if (!fullName) {
        setMessage('Indtast fornavn og efternavn')
        setMessageColor('orange.300')
        setSaving(false)
        return
      }
      if (!selectedOptionId) {
        setMessage(
          settings?.paymentOptions?.length
            ? 'Vælg betalingsperiode'
            : 'Betalingsperiode kunne ikke indlæses. Genindlæs siden, eller skriv til DZR hvis det fortsætter.'
        )
        setMessageColor('red.300')
        setSaving(false)
        return
      }

      track('onboarding_step2_payment_started')
      const res = await fetch('/api/onboarding/payment/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountDkk: amount, fullName, selectedOptionId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Kunne ikke starte betaling')
      window.location.href = String(data?.url || '')
    } catch (err: any) {
      setMessage(err?.message || 'Kunne ikke starte betaling')
      setMessageColor('red.300')
      setSaving(false)
      track('onboarding_step2_payment_failed')
    }
  }

  if (!canPay) {
    return (
      <Container maxW="4xl" py={10}>
        <Stack spacing={4}>
          <StepProgressHeader currentStep={2} />
          <Heading color="white">Bliv medlem af DZR - Trin 2 af 3</Heading>
          <Text color="gray.300">Gennemfør trin 1 ved at logge ind med Discord først.</Text>
          <Button as="a" href="/join/discord" colorScheme="red">
            Gå til trin 1
          </Button>
        </Stack>
      </Container>
    )
  }

  return (
    <Container maxW="4xl" py={10}>
      <Stack spacing={6}>
        <StepProgressHeader currentStep={2} />
        <Heading color="white">Bliv medlem af DZR - Trin 2 af 3</Heading>
        <Text color="gray.300">
          Her kan du se din medlemsstatus og betale kontingent for at fortsætte indmeldelsen.
          {rangeText ? ` ${rangeText}` : ''}
        </Text>
        {message ? (
          <HStack spacing={2}>
            {isPolling && <Spinner size="sm" color={messageColor} />}
            <Text color={messageColor}>{message}</Text>
          </HStack>
        ) : null}

        <Box borderWidth="1px" borderColor="gray.700" borderRadius="md" bg="gray.900" p={4}>
          <Stack spacing={1}>
            <Text color="white" fontWeight="bold">Nuværende status</Text>
            {alreadyPaid ? (
              <Text color="green.300">
                Klubmedlem - kontingent betalt
                {typeof coveredThroughYear === 'number' ? ` (dækket til og med ${coveredThroughYear})` : ''}
              </Text>
            ) : (
              <Text color="gray.300">Ikke registreret som betalt klubmedlem endnu</Text>
            )}
          </Stack>
        </Box>

        {paymentDone ? (
          <Stack spacing={3}>
            <Button as="a" href="/join/zwift-id" colorScheme="red" onClick={() => track('onboarding_step2_continue_to_step3')}>
              Fortsæt til trin 3
            </Button>
            {alreadyPaid ? (
              <Button variant="outline" color="white" borderColor="whiteAlpha.400" onClick={() => signIn('discord', { callbackUrl: '/members-zone' })}>
                Log ind på medlemsområdet
              </Button>
            ) : null}
          </Stack>
        ) : (
          <Box borderWidth="1px" borderColor="gray.700" borderRadius="md" bg="gray.900" p={5}>
            <Stack spacing={4}>
              <FormControl>
                <FormLabel color="white">Betalingsperiode</FormLabel>
                <HStack wrap="wrap" spacing={3}>
                  {(settings?.paymentOptions || []).map((opt) => (
                    <Button key={opt.id} variant={selectedOptionId === opt.id ? 'solid' : 'outline'} onClick={() => setSelectedOptionId(opt.id)} colorScheme="red">
                      {opt.label || opt.id}
                    </Button>
                  ))}
                </HStack>
              </FormControl>
              <FormControl>
                <FormLabel color="white">Fornavn</FormLabel>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} bg="white" color="black" />
              </FormControl>
              <FormControl>
                <FormLabel color="white">Efternavn</FormLabel>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} bg="white" color="black" />
              </FormControl>
              <FormControl>
                <FormLabel color="white">Beløb ({amount} DKK)</FormLabel>
                <Slider min={settings?.minAmountDkk ?? 10} max={settings?.maxAmountDkk ?? 100} value={amount} onChange={setAmount}>
                  <SliderTrack>
                    <SliderFilledTrack />
                  </SliderTrack>
                  <SliderThumb />
                </Slider>
              </FormControl>
              <Button
                onClick={startPayment}
                isLoading={saving}
                isDisabled={loading || !selectedOptionId}
                variant="unstyled"
                h="auto"
                p={0}
                _hover={{ opacity: 0.95 }}
                _active={{ transform: 'translateY(1px)' }}
                aria-label="Betal med MobilePay"
              >
                <Box
                  as="img"
                  src="/general/mobilepay-pay-primary-dk.svg"
                  alt="Betal med MobilePay"
                  w="100%"
                  maxW="340px"
                />
              </Button>
            </Stack>
          </Box>
        )}

        <Box borderWidth="1px" borderColor="gray.600" borderRadius="md" bg="gray.800">
          <Accordion allowToggle>
            <AccordionItem border="none">
              <h2>
                <AccordionButton _hover={{ bg: 'gray.700' }} py={3}>
                  <Text flex="1" textAlign="left" color="white" fontWeight="bold" fontSize="sm">
                    Vilkår for medlemskab
                  </Text>
                  <AccordionIcon color="white" />
                </AccordionButton>
              </h2>
              <AccordionPanel pb={4} color="gray.300" fontSize="sm" lineHeight="tall">
                <Text mb={2}>Ved betaling af kontingent accepterer du følgende vilkår:</Text>
                <Text mb={1}>• Medlemskabet gælder for den valgte periode og refunderes ikke ved opsigelse i perioden.</Text>
                <Text mb={1}>• Medlemskabet udløber automatisk ved periodens afslutning uden yderligere forpligtelser.</Text>
                <Text mb={1}>• Betalt kontingent refunderes ikke, jf. foreningens vedtægter §5.</Text>
                <Text>• Som klubmedlem har du stemmeret på generalforsamlinger.</Text>
              </AccordionPanel>
            </AccordionItem>
          </Accordion>
        </Box>
      </Stack>
    </Container>
  )
}
