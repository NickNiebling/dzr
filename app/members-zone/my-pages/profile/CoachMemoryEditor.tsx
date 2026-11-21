'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Input,
  Radio,
  RadioGroup,
  Select,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
  useToast,
} from '@chakra-ui/react'
import type { CoachInjury, CoachProfile, CoachWeeklySlot } from '@/app/lib/coachProfile'
import type { CoachChatNote } from '@/app/lib/coachChatNotes'
import { activeGoalNotes } from '@/app/lib/coachGoals'

const SPORT_OPTIONS = ['cycling', 'running', 'swimming', 'strength']
const SPORT_LABELS: Record<string, string> = {
  cycling: 'Cykling',
  running: 'Løb',
  swimming: 'Svømning',
  strength: 'Styrke',
}

function sportLabel(sport: string) {
  return SPORT_LABELS[sport] || sport
}

const DAYS: Array<{ id: string; label: string }> = [
  { id: 'mon', label: 'Man' },
  { id: 'tue', label: 'Tir' },
  { id: 'wed', label: 'Ons' },
  { id: 'thu', label: 'Tor' },
  { id: 'fri', label: 'Fre' },
  { id: 'sat', label: 'Lør' },
  { id: 'sun', label: 'Søn' },
]

const secondaryButtonProps = {
  variant: 'outline' as const,
  color: 'gray.100',
  borderColor: 'gray.500',
  bg: 'gray.800',
  _hover: { bg: 'gray.700', borderColor: 'gray.400', color: 'white' },
}

const darkSelectProps = {
  bg: 'gray.800',
  borderColor: 'gray.600',
  color: 'white',
  size: 'sm' as const,
  sx: {
    option: {
      color: 'black',
      background: 'white',
    },
  },
}

type ClearConfirm =
  | { kind: 'settings' }
  | { kind: 'notes' }
  | { kind: 'all' }
  | { kind: 'disableNotes' }
  | { kind: 'note'; id: string }

const CLEAR_CONFIRM_COPY = {
  settings: {
    title: 'Nulstil indstillinger?',
    body: 'Coach-indstillingerne nulstilles til udgangspunktet. Chat-noter slettes ikke.',
    confirm: 'Nulstil indstillinger',
  },
  notes: {
    title: 'Slet noter?',
    body: 'Alle chat-noter slettes. Coach-profilen beholdes.',
    confirm: 'Slet noter',
  },
  all: {
    title: 'Nulstil alt?',
    body: 'Coach-profilen nulstilles, og alle chat-noter slettes. Det kan ikke fortrydes.',
    confirm: 'Nulstil alt',
  },
  disableNotes: {
    title: 'Slå chat-noter fra?',
    body: 'Alle gemte chat-noter slettes med det samme. Det kan ikke fortrydes.',
    confirm: 'Slå fra og slet noter',
  },
  note: {
    title: 'Slet note?',
    body: 'Denne chat-note slettes. Det kan ikke fortrydes.',
    confirm: 'Slet',
  },
} as const

function payloadFrom(profile: CoachProfile, minStr: string, maxStr: string): CoachProfile {
  const minRaw = minStr.trim() === '' ? null : Number(minStr)
  const maxRaw = maxStr.trim() === '' ? null : Number(maxStr)
  const min = minRaw != null && Number.isFinite(minRaw) ? minRaw : null
  const max = maxRaw != null && Number.isFinite(maxRaw) ? maxRaw : null
  return {
    ridesPerWeek: min == null && max == null ? null : {
      ...(min != null ? { min } : {}),
      ...(max != null ? { max } : {}),
    },
    sports: profile.sports || [],
    weekly: (profile.weekly || []).filter((row) => row.sport.trim() && row.days.length),
    injuries: (profile.injuries || []).filter((inj) => inj.text.trim()),
    goals: [],
    style: profile.style || { length: null, language: null, tone: null, notes: '' },
    notesOptIn: profile.notesOptIn === true,
    followUpEveryDays: profile.followUpEveryDays === 3 || profile.followUpEveryDays === 7 || profile.followUpEveryDays === 14
      ? profile.followUpEveryDays
      : null,
  }
}

function emptyForm(): CoachProfile {
  return {
    ridesPerWeek: null,
    sports: [],
    weekly: [],
    injuries: [],
    goals: [],
    style: { length: null, language: null, tone: null, notes: '' },
    notesOptIn: false,
    followUpEveryDays: null,
  }
}

export default function CoachMemoryEditor() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [eligible, setEligible] = useState<boolean | null>(null)
  const [form, setForm] = useState<CoachProfile>(emptyForm())
  const [savedNotesOptIn, setSavedNotesOptIn] = useState(false)
  const [chatNotes, setChatNotes] = useState<CoachChatNote[]>([])
  const [notesLoading, setNotesLoading] = useState(true)
  const [extraSport, setExtraSport] = useState('')
  const [ridesMin, setRidesMin] = useState('')
  const [ridesMax, setRidesMax] = useState('')
  const [clearConfirm, setClearConfirm] = useState<ClearConfirm | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const cancelClearRef = useRef<HTMLButtonElement>(null)
  const lastSaved = useRef('')
  const saveSeq = useRef(0)

  function applyProfile(profile: CoachProfile) {
    const next: CoachProfile = {
      ...emptyForm(),
      ...profile,
      sports: profile.sports || [],
      weekly: (profile.weekly || []).map((row) => ({
        sport: row.sport,
        days: Array.isArray(row.days) ? row.days : [],
      })),
      injuries: profile.injuries || [],
      goals: [],
      style: profile.style || { length: null, language: null, tone: null, notes: '' },
      notesOptIn: profile.notesOptIn === true,
      followUpEveryDays: profile.followUpEveryDays === 3 || profile.followUpEveryDays === 7 || profile.followUpEveryDays === 14
        ? profile.followUpEveryDays
        : null,
    }
    const min = profile.ridesPerWeek?.min != null ? String(profile.ridesPerWeek.min) : ''
    const max = profile.ridesPerWeek?.max != null ? String(profile.ridesPerWeek.max) : ''
    setForm(next)
    setSavedNotesOptIn(next.notesOptIn === true)
    setRidesMin(min)
    setRidesMax(max)
    lastSaved.current = JSON.stringify(payloadFrom(next, min, max))
  }

  useEffect(() => {
    let ignore = false
    async function load() {
      try {
        const [profileRes, notesRes] = await Promise.all([
          fetch('/api/coach/profile', { cache: 'no-store' }),
          fetch('/api/coach/notes', { cache: 'no-store' }),
        ])
        if (profileRes.status === 401) {
          if (!ignore) setEligible(false)
          return
        }
        const data = await profileRes.json()
        if (ignore) return
        setEligible(data?.eligible !== false)
        if (data?.profile) {
          applyProfile(data.profile)
          setHydrated(true)
        }
        if (notesRes.ok) {
          const notesData = await notesRes.json().catch(() => ({}))
          if (!ignore && Array.isArray(notesData?.notes)) setChatNotes(notesData.notes)
        }
      } catch {
        if (!ignore) setEligible(false)
      } finally {
        if (!ignore) {
          setLoading(false)
          setNotesLoading(false)
        }
      }
    }
    load()
    return () => { ignore = true }
  }, [])

  function toggleSport(sport: string) {
    setForm((prev) => ({
      ...prev,
      sports: prev.sports.includes(sport)
        ? prev.sports.filter((s) => s !== sport)
        : [...prev.sports, sport],
    }))
  }

  function addExtraSport() {
    const value = extraSport.trim().toLowerCase()
    if (!value) return
    setForm((prev) => ({
      ...prev,
      sports: prev.sports.includes(value) ? prev.sports : [...prev.sports, value],
    }))
    setExtraSport('')
  }

  function updateWeekly(index: number, next: CoachWeeklySlot) {
    setForm((prev) => ({
      ...prev,
      weekly: prev.weekly.map((row, i) => (i === index ? next : row)),
    }))
  }

  function addWeekly() {
    setForm((prev) => ({
      ...prev,
      weekly: [...prev.weekly, { sport: 'strength', days: [] }],
    }))
  }

  function addInjury() {
    setForm((prev) => ({
      ...prev,
      injuries: [
        ...prev.injuries,
        { id: `new_${Date.now()}`, text: '', started: '', status: 'active' },
      ],
    }))
  }

  function updateInjury(index: number, next: CoachInjury) {
    setForm((prev) => ({
      ...prev,
      injuries: prev.injuries.map((row, i) => (i === index ? next : row)),
    }))
  }

  async function persist(payload: CoachProfile, { clearNotesOnDisable = false } = {}) {
    const json = JSON.stringify(payload)
    const seq = ++saveSeq.current
    setSaving(true)
    setSaveState('saving')
    try {
      const res = await fetch('/api/coach/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (seq !== saveSeq.current) return false
      if (!res.ok) {
        setSaveState('error')
        toast({ title: data?.error || 'Kunne ikke gemme', status: 'error' })
        return false
      }
      // Delete the notes only after the profile save has succeeded. Deleting first meant a
      // failed PUT left the notes gone with notesOptIn still on — unrecoverable for the athlete.
      if (clearNotesOnDisable) {
        try {
          await deleteAllNotesRequest()
        } catch (noteErr: any) {
          if (seq !== saveSeq.current) return false
          if (data?.profile) applyProfile(data.profile)
          setSaveState('error')
          toast({
            title: 'Indstillinger gemt, men chat-noterne blev ikke slettet',
            description: noteErr?.message || 'Prøv at slette dem igen under Chat-noter.',
            status: 'warning',
          })
          return false
        }
      }
      if (seq !== saveSeq.current) return false
      lastSaved.current = json
      setSavedNotesOptIn(payload.notesOptIn === true)
      setSaveState(clearNotesOnDisable ? 'idle' : 'saved')
      if (clearNotesOnDisable) {
        setForm((prev) => ({ ...prev, notesOptIn: false }))
        toast({ title: 'Chat-noter er slået fra, og noterne er slettet', status: 'info' })
      }
      return true
    } catch (err: any) {
      if (seq !== saveSeq.current) return false
      setSaveState('error')
      toast({ title: err?.message || 'Kunne ikke gemme', status: 'error' })
      return false
    } finally {
      if (seq === saveSeq.current) setSaving(false)
    }
  }

  const persistRef = useRef(persist)
  useEffect(() => {
    persistRef.current = persist
  }, [persist])

  useEffect(() => {
    if (!hydrated) return
    const payload = payloadFrom(form, ridesMin, ridesMax)
    const json = JSON.stringify(payload)
    if (json === lastSaved.current) return
    const timer = window.setTimeout(() => { void persistRef.current(payload) }, 500)
    return () => window.clearTimeout(timer)
  }, [form, ridesMin, ridesMax, hydrated])

  async function resetSettingsRequest() {
    const res = await fetch('/api/coach/profile', { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.error || 'Kunne ikke nulstille indstillinger')
    }
    applyProfile(data?.profile || emptyForm())
  }

  async function deleteAllNotesRequest() {
    const res = await fetch('/api/coach/notes?all=1', { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.error || 'Kunne ikke slette noter')
    }
    setChatNotes([])
  }

  async function clearSettings() {
    setSaving(true)
    try {
      await resetSettingsRequest()
      toast({ title: 'Coach-indstillingerne er nulstillet', status: 'info' })
    } catch (err: any) {
      toast({ title: err?.message || 'Kunne ikke nulstille indstillinger', status: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function clearNotes() {
    setSaving(true)
    try {
      await deleteAllNotesRequest()
      toast({ title: 'Chat-noter slettet', status: 'info' })
    } catch (err: any) {
      toast({ title: err?.message || 'Kunne ikke slette noter', status: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function clearAll() {
    setSaving(true)
    try {
      const results = await Promise.allSettled([resetSettingsRequest(), deleteAllNotesRequest()])
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
      if (failed) {
        toast({
          title: failed.reason?.message || 'Kunne ikke nulstille alt',
          status: 'error',
        })
        return
      }
      toast({ title: 'Profil og chat-noter er nulstillet', status: 'info' })
    } finally {
      setSaving(false)
    }
  }

  function formatNoteAt(at: string | null) {
    if (!at) return ''
    const date = new Date(at)
    if (Number.isNaN(date.getTime())) return at.slice(0, 10)
    return date.toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' })
  }

  async function deleteChatNote(id: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/coach/notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: data?.error || 'Kunne ikke slette noten', status: 'error' })
        return
      }
      setChatNotes(Array.isArray(data?.notes) ? data.notes : [])
    } finally {
      setSaving(false)
    }
  }

  async function confirmClear() {
    const action = clearConfirm
    if (!action) return
    if (action.kind === 'settings') await clearSettings()
    else if (action.kind === 'notes') await clearNotes()
    else if (action.kind === 'all') await clearAll()
    else if (action.kind === 'disableNotes') {
      await persist(payloadFrom({ ...form, notesOptIn: false }, ridesMin, ridesMax), { clearNotesOnDisable: true })
    }
    else await deleteChatNote(action.id)
    setClearConfirm(null)
  }

  if (loading) {
    return (
      <Box borderWidth="1px" borderColor="gray.700" borderRadius="md" p={4} mb={6}>
        <Heading size="sm" mb={2}>DZR Coach-indstillinger</Heading>
        <Spinner size="sm" />
      </Box>
    )
  }

  if (eligible === false) {
    return (
      <Box borderWidth="1px" borderColor="gray.700" borderRadius="md" p={4} mb={6}>
        <Heading size="sm" mb={2}>DZR Coach-indstillinger</Heading>
        <Text color="gray.400" fontSize="sm">
          Coach-indstillinger er kun for betalende klubmedlemmer. Forny medlemskab under Medlemskab.
        </Text>
      </Box>
    )
  }

  return (
    <Box>
      <Box borderWidth="1px" borderColor="gray.700" borderRadius="md" p={4} mb={6}>
      <Flex justify="space-between" align="baseline" gap={3} mb={2}>
        <Heading size="sm" mb={0}>DZR Coach-indstillinger</Heading>
        <Text fontSize="sm" color={saveState === 'error' ? 'red.300' : 'gray.500'} flexShrink={0} aria-live="polite">
          {saveState === 'saving' ? 'Gemmer…' : saveState === 'saved' ? 'Gemt' : saveState === 'error' ? 'Kunne ikke gemme' : ''}
        </Text>
      </Flex>
      <Text color="gray.400" mb={2} fontSize="sm">
        Her sætter du dine faste rammer til DZR Coach: hvor ofte du kører, andre sportsgrene, skader og hvordan coachen skal svare. Du har fået et udgangspunkt, som du kan rette. Coachen ændrer ikke selv de rammer — det gør du her. Når chat-noter er slået til, kan du sætte datobundne mål, som coachen styrer træningen efter. Data bruges kun til din private coaching og sendes til OpenAI, når du chatter med coachen. Det gemmes krypteret.
      </Text>
      <Text color="gray.500" fontSize="sm" mb={4}>Ændringer gemmes automatisk.</Text>

      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} mb={4}>
        <FormControl>
          <FormLabel>Ture om ugen (min)</FormLabel>
          <Input
            type="number"
            min={0}
            max={14}
            value={ridesMin}
            onChange={(e) => setRidesMin(e.target.value)}
            bg="gray.800"
            borderColor="gray.600"
          />
        </FormControl>
        <FormControl>
          <FormLabel>Ture om ugen (maks)</FormLabel>
          <Input
            type="number"
            min={0}
            max={14}
            value={ridesMax}
            onChange={(e) => setRidesMax(e.target.value)}
            bg="gray.800"
            borderColor="gray.600"
          />
        </FormControl>
      </SimpleGrid>

      <FormControl mb={4}>
        <FormLabel>Sportsgrene</FormLabel>
        <HStack spacing={4} wrap="wrap">
          {SPORT_OPTIONS.map((sport) => (
            <Checkbox
              key={sport}
              isChecked={form.sports.includes(sport)}
              onChange={() => toggleSport(sport)}
              colorScheme="red"
            >
              {sportLabel(sport)}
            </Checkbox>
          ))}
        </HStack>
        <HStack mt={2} maxW="360px">
          <Input
            placeholder="Anden sportsgren"
            value={extraSport}
            onChange={(e) => setExtraSport(e.target.value)}
            bg="gray.800"
            borderColor="gray.600"
            size="sm"
          />
          <Button size="sm" onClick={addExtraSport} {...secondaryButtonProps}>Tilføj</Button>
        </HStack>
        {form.sports.filter((s) => !SPORT_OPTIONS.includes(s)).length > 0 && (
          <Text mt={2} fontSize="sm" color="gray.400">
            Ekstra: {form.sports.filter((s) => !SPORT_OPTIONS.includes(s)).join(', ')}
          </Text>
        )}
      </FormControl>

      <Box mb={4}>
        <Flex justify="space-between" align="center" mb={2}>
          <FormLabel mb={0}>Faste træningsdage</FormLabel>
          <Button size="xs" onClick={addWeekly} {...secondaryButtonProps}>Tilføj dag</Button>
        </Flex>
        <Text color="gray.500" fontSize="xs" mb={2}>
          Tid er valgfri for hver dag. Samme sport to gange på én dag? Tilføj to rækker.
        </Text>
        <Stack spacing={3}>
          {form.weekly.map((row, index) => (
            <Box key={`${row.sport}-${index}`} borderWidth="1px" borderColor="gray.700" borderRadius="md" p={3}>
              <HStack align="flex-start" spacing={3} wrap="wrap" mb={2}>
                <Select
                  value={row.sport}
                  onChange={(e) => updateWeekly(index, { ...row, sport: e.target.value })}
                  maxW="180px"
                  {...darkSelectProps}
                >
                  {SPORT_OPTIONS.map((sport) => (
                    <option key={sport} value={sport}>{sportLabel(sport)}</option>
                  ))}
                  {row.sport && !SPORT_OPTIONS.includes(row.sport) && (
                    <option value={row.sport}>{row.sport}</option>
                  )}
                </Select>
                <Button
                  size="xs"
                  variant="ghost"
                  color="red.300"
                  _hover={{ bg: 'whiteAlpha.100', color: 'red.200' }}
                  onClick={() => setForm((prev) => ({ ...prev, weekly: prev.weekly.filter((_, i) => i !== index) }))}
                >
                  Slet
                </Button>
              </HStack>
              <HStack wrap="wrap" spacing={2} align="flex-start">
                {DAYS.map((day) => {
                  const slot = row.days.find((d) => d.day === day.id)
                  return (
                    <Box key={day.id} minW="92px">
                      <Checkbox
                        isChecked={Boolean(slot)}
                        onChange={() => {
                          const days = slot
                            ? row.days.filter((d) => d.day !== day.id)
                            : [...row.days, { day: day.id, startTime: null }]
                          updateWeekly(index, { ...row, days })
                        }}
                        colorScheme="red"
                        size="sm"
                      >
                        {day.label}
                      </Checkbox>
                      {slot && (
                        <Input
                          type="time"
                          value={slot.startTime || ''}
                          onChange={(e) => {
                            const startTime = e.target.value || null
                            updateWeekly(index, {
                              ...row,
                              days: row.days.map((d) => (d.day === day.id ? { ...d, startTime } : d)),
                            })
                          }}
                          bg="gray.800"
                          borderColor="gray.600"
                          size="xs"
                          mt={1}
                          aria-label={`Tid ${day.label}`}
                        />
                      )}
                    </Box>
                  )
                })}
              </HStack>
            </Box>
          ))}
        </Stack>
      </Box>

      <Box mb={4}>
        <Flex justify="space-between" align="center" mb={2}>
          <FormLabel mb={0}>Skader / begrænsninger</FormLabel>
          <Button size="xs" onClick={addInjury} {...secondaryButtonProps}>Tilføj</Button>
        </Flex>
        <Stack spacing={3}>
          {form.injuries.map((inj, index) => (
            <SimpleGrid key={inj.id || index} columns={{ base: 1, md: 4 }} spacing={2} alignItems="end">
              <Input
                placeholder="fx knæ"
                value={inj.text}
                onChange={(e) => updateInjury(index, { ...inj, text: e.target.value })}
                bg="gray.800"
                borderColor="gray.600"
                size="sm"
              />
              <Input
                placeholder="Startet (valgfrit)"
                value={inj.started || ''}
                onChange={(e) => updateInjury(index, { ...inj, started: e.target.value })}
                bg="gray.800"
                borderColor="gray.600"
                size="sm"
              />
              <Select
                value={inj.status}
                onChange={(e) => updateInjury(index, { ...inj, status: e.target.value === 'recovered' ? 'recovered' : 'active' })}
                {...darkSelectProps}
              >
                <option value="active">Aktiv</option>
                <option value="recovered">Helbredt</option>
              </Select>
              <Button
                size="sm"
                variant="ghost"
                color="red.300"
                _hover={{ bg: 'whiteAlpha.100', color: 'red.200' }}
                onClick={() => setForm((prev) => ({ ...prev, injuries: prev.injuries.filter((_, i) => i !== index) }))}
              >
                Slet
              </Button>
            </SimpleGrid>
          ))}
        </Stack>
      </Box>

      <Heading size="xs" mb={3} color="gray.300">Coach-stil</Heading>
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} mb={4}>
        <FormControl>
          <FormLabel>Beskedlængde</FormLabel>
          <RadioGroup
            value={form.style.length || 'default'}
            onChange={(value) => setForm((prev) => ({
              ...prev,
              style: { ...prev.style, length: !value || value === 'default' ? null : value as CoachProfile['style']['length'] },
            }))}
          >
            <Stack>
              <Radio value="default" colorScheme="red">Standard</Radio>
              <Radio value="short" colorScheme="red">Korte beskeder</Radio>
              <Radio value="normal" colorScheme="red">Normal</Radio>
              <Radio value="detailed" colorScheme="red">Udførlig</Radio>
            </Stack>
          </RadioGroup>
        </FormControl>
        <FormControl>
          <FormLabel>Sprog</FormLabel>
          <RadioGroup
            value={form.style.language || 'default'}
            onChange={(value) => setForm((prev) => ({
              ...prev,
              style: { ...prev.style, language: !value || value === 'default' ? null : value as CoachProfile['style']['language'] },
            }))}
          >
            <Stack>
              <Radio value="default" colorScheme="red">Følg chatten</Radio>
              <Radio value="da" colorScheme="red">Dansk</Radio>
              <Radio value="en" colorScheme="red">Engelsk</Radio>
            </Stack>
          </RadioGroup>
        </FormControl>
        <FormControl>
          <FormLabel>Tone</FormLabel>
          <RadioGroup
            value={form.style.tone || 'default'}
            onChange={(value) => setForm((prev) => ({
              ...prev,
              style: { ...prev.style, tone: !value || value === 'default' ? null : value as CoachProfile['style']['tone'] },
            }))}
          >
            <Stack>
              <Radio value="default" colorScheme="red">Standard</Radio>
              <Radio value="direct" colorScheme="red">Direkte</Radio>
              <Radio value="encouraging" colorScheme="red">Opmuntrende</Radio>
              <Radio value="casual" colorScheme="red">Afslappet</Radio>
            </Stack>
          </RadioGroup>
        </FormControl>
      </SimpleGrid>
      <FormControl mb={4}>
        <FormLabel>Andre stilønsker</FormLabel>
        <Input
          placeholder="fx kun punktopstilling, ingen emojis"
          value={form.style.notes}
          onChange={(e) => setForm((prev) => ({ ...prev, style: { ...prev.style, notes: e.target.value } }))}
          bg="gray.800"
          borderColor="gray.600"
        />
      </FormControl>

      <Checkbox
        isChecked={form.notesOptIn === true}
        onChange={(e) => {
          if (!e.target.checked && savedNotesOptIn) {
            setClearConfirm({ kind: 'disableNotes' })
            return
          }
          setForm((prev) => ({ ...prev, notesOptIn: e.target.checked }))
        }}
        colorScheme="red"
        alignItems="flex-start"
        mb={2}
      >
        <Text color="gray.200" fontSize="sm">
          Gem korte, daterede notater fra mine coach-samtaler (fx at jeg var syg i går). Når det er slået til, gemmes nyttige notater automatisk — uden bekræftelse. Datobundne mål sætter du herunder, eller bekræfter i Discord. Coachen ændrer ikke dine indstillinger.
        </Text>
      </Checkbox>
      <FormControl mb={4}>
        <FormLabel>Check-in fra coachen</FormLabel>
        <Text color="gray.400" fontSize="sm" mb={2}>
          DZR Coach kan skrive først om morgenen (kl. 8), hvis du ikke har chattet i et stykke tid. Beskeden bruger dine seneste aktiviteter og sendes til OpenAI. Du kan slå det fra når som helst.
        </Text>
        <RadioGroup
          value={form.followUpEveryDays == null ? 'off' : String(form.followUpEveryDays)}
          onChange={(value) => setForm((prev) => ({
            ...prev,
            followUpEveryDays: value === '3' || value === '7' || value === '14'
              ? Number(value) as CoachProfile['followUpEveryDays']
              : null,
          }))}
        >
          <Stack>
            <Radio value="off" colorScheme="red">Fra</Radio>
            <Radio value="3" colorScheme="red">Hver 3. dag</Radio>
            <Radio value="7" colorScheme="red">Hver 7. dag</Radio>
            <Radio value="14" colorScheme="red">Hver 14. dag</Radio>
          </Stack>
        </RadioGroup>
      </FormControl>

      <Button onClick={() => setClearConfirm({ kind: 'settings' })} isLoading={saving} size="sm" variant="outline" colorScheme="red" color="red.300" borderColor="red.400" _hover={{ bg: 'whiteAlpha.100' }}>
        Nulstil indstillinger
      </Button>
    </Box>

      {savedNotesOptIn && (
        <Box borderWidth="1px" borderColor="gray.700" borderRadius="md" p={4} mb={6}>
          {/* Goal setting moved to the Kalender page: this tab is settings, and a goal is a
              dated thing that belongs among the member's other dated things. Storage is unchanged
              — goals are still coach notes — so only the form moved. */}
          <Heading size="sm" mb={2}>Mål</Heading>
          <Text color="gray.400" fontSize="sm" mb={6}>
            Mål sætter og sletter du nu i{' '}
            <Box as="a" href="/members-zone/calendar" textDecoration="underline">
              kalenderen
            </Box>
            , sammen med dine planlagte ture og løb.
          </Text>

          <Heading size="sm" mb={2}>Chat-noter</Heading>
          <Text color="gray.400" fontSize="sm" mb={3}>
            Noterne er ikke faste regler. De gemmes automatisk fra Discord, når chat-noter er slået til. Du kan se og slette dem her.
          </Text>
          {notesLoading ? (
            <Spinner size="sm" mb={4} />
          ) : chatNotes.filter((note) => note.kind !== 'goal').length === 0 ? (
            <Text color="gray.500" fontSize="sm" mb={4}>Ingen chat-noter endnu.</Text>
          ) : (
            <Stack spacing={3} mb={4}>
              {chatNotes.filter((note) => note.kind !== 'goal').map((note) => (
                <Flex
                  key={note.id}
                  gap={3}
                  align="flex-start"
                  justify="space-between"
                  bg="gray.800"
                  borderWidth="1px"
                  borderColor="gray.600"
                  borderRadius="md"
                  p={3}
                >
                  <Box>
                    <Text fontSize="xs" color="gray.500">{formatNoteAt(note.at)}</Text>
                    <Text fontSize="sm" color="gray.100">{note.text}</Text>
                  </Box>
                  <Button
                    size="xs"
                    variant="ghost"
                    color="red.300"
                    _hover={{ bg: 'whiteAlpha.100', color: 'red.200' }}
                    onClick={() => setClearConfirm({ kind: 'note', id: note.id })}
                    isDisabled={saving}
                  >
                    Slet
                  </Button>
                </Flex>
              ))}
            </Stack>
          )}
          {chatNotes.some((note) => note.kind === 'goal' && !activeGoalNotes(chatNotes).some((g) => g.id === note.id)) && (
            <Box mb={4}>
              <Text color="gray.400" fontSize="sm" mb={2}>Udløbne mål</Text>
              <Stack spacing={3}>
                {chatNotes
                  .filter((note) => note.kind === 'goal' && !activeGoalNotes(chatNotes).some((g) => g.id === note.id))
                  .map((note) => (
                    <Flex
                      key={note.id}
                      gap={3}
                      align="flex-start"
                      justify="space-between"
                      bg="gray.800"
                      borderWidth="1px"
                      borderColor="gray.600"
                      borderRadius="md"
                      p={3}
                    >
                      <Box>
                        <Text fontSize="xs" color="gray.500">Udløbet {note.eventDate || formatNoteAt(note.at)}</Text>
                        <Text fontSize="sm" color="gray.100">{note.text}</Text>
                      </Box>
                      <Button
                        size="xs"
                        variant="ghost"
                        color="red.300"
                        _hover={{ bg: 'whiteAlpha.100', color: 'red.200' }}
                        onClick={() => setClearConfirm({ kind: 'note', id: note.id })}
                        isDisabled={saving}
                      >
                        Slet
                      </Button>
                    </Flex>
                  ))}
              </Stack>
            </Box>
          )}
          <Button
            onClick={() => setClearConfirm({ kind: 'notes' })}
            isLoading={saving}
            isDisabled={chatNotes.length === 0}
            size="sm"
            variant="outline"
            colorScheme="red"
            color="red.300"
            borderColor="red.400"
            _hover={{ bg: 'whiteAlpha.100' }}
          >
            Slet noter
          </Button>
        </Box>
      )}

      <Button
        onClick={() => setClearConfirm({ kind: 'all' })}
        isLoading={saving}
        size="sm"
        variant="outline"
        colorScheme="red"
        color="red.300"
        borderColor="red.400"
        _hover={{ bg: 'whiteAlpha.100' }}
        mb={6}
      >
        Nulstil alt
      </Button>

      <AlertDialog
        isOpen={Boolean(clearConfirm)}
        leastDestructiveRef={cancelClearRef}
        onClose={() => {
          if (!saving) setClearConfirm(null)
        }}
      >
        <AlertDialogOverlay>
          <AlertDialogContent bg="gray.800" color="gray.100" borderWidth="1px" borderColor="gray.600">
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {clearConfirm ? CLEAR_CONFIRM_COPY[clearConfirm.kind].title : ''}
            </AlertDialogHeader>
            <AlertDialogBody>
              {clearConfirm ? CLEAR_CONFIRM_COPY[clearConfirm.kind].body : ''}
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button
                ref={cancelClearRef}
                onClick={() => setClearConfirm(null)}
                isDisabled={saving}
                {...secondaryButtonProps}
                size="sm"
              >
                Annuller
              </Button>
              <Button
                ml={3}
                size="sm"
                bg="#ad1a2d"
                color="white"
                _hover={{ bg: '#8c1524' }}
                onClick={confirmClear}
                isLoading={saving}
              >
                {clearConfirm ? CLEAR_CONFIRM_COPY[clearConfirm.kind].confirm : ''}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  )
}
