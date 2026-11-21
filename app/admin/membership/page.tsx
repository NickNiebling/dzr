'use client'

import { useEffect, useState } from 'react'
import AdminShell from '@/components/admin/AdminShell'
import { Box, Button, Checkbox, Heading, Input, Table, Tbody, Td, Text, Th, Thead, Tr, useToast, HStack, Stack } from '@chakra-ui/react'

type PaymentOption = { id: string; label?: string; coversYears?: number[] }
type PeriodFlags = { current: boolean; next: boolean; both: boolean }

function sameYears(option: PaymentOption, years: number[]) {
  const got = [...(option.coversYears || [])].map(Number).filter(Number.isFinite).sort((a, b) => a - b)
  return got.length === years.length && got.every((year, index) => year === years[index])
}

function periodFlags(options: PaymentOption[], year: number): PeriodFlags {
  return {
    current: options.some((option) => sameYears(option, [year])),
    next: options.some((option) => sameYears(option, [year + 1])),
    both: options.some((option) => sameYears(option, [year, year + 1])),
  }
}

function customPeriods(options: PaymentOption[], year: number): PaymentOption[] {
  return options.filter((option) =>
    !sameYears(option, [year]) &&
    !sameYears(option, [year + 1]) &&
    !sameYears(option, [year, year + 1])
  )
}

function periodsToOptions(flags: PeriodFlags, year: number, custom: PaymentOption[]): PaymentOption[] {
  const options: PaymentOption[] = []
  if (flags.current) options.push({ id: 'current', label: String(year), coversYears: [year] })
  if (flags.next) options.push({ id: 'next', label: String(year + 1), coversYears: [year + 1] })
  if (flags.both) options.push({ id: 'current-next', label: `${year}/${year + 1}`, coversYears: [year, year + 1] })
  return [...options, ...custom]
}

export default function MembershipAdminPage() {
  const toast = useToast()
  const year = new Date().getUTCFullYear()
  const [settings, setSettings] = useState({ minAmountDkk: 10, maxAmountDkk: 100, clubMemberRoleId: '' })
  const [periods, setPeriods] = useState<PeriodFlags>({ current: false, next: false, both: false })
  const [customOptions, setCustomOptions] = useState<PaymentOption[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [totals, setTotals] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')

  async function load() {
    const [settingsRes, paymentsRes, totalsRes] = await Promise.all([
      fetch('/api/admin/membership/settings'),
      fetch('/api/admin/membership/payments'),
      fetch('/api/admin/membership/totals'),
    ])
    const s = await settingsRes.json()
    const p = await paymentsRes.json()
    const t = await totalsRes.json()
    if (!settingsRes.ok || typeof s?.minAmountDkk !== 'number') {
      throw new Error(s?.error || 'Could not load settings')
    }
    const paymentOptions = Array.isArray(s.paymentOptions) ? s.paymentOptions as PaymentOption[] : []
    setSettings({
      minAmountDkk: s.minAmountDkk,
      maxAmountDkk: s.maxAmountDkk,
      clubMemberRoleId: s.clubMemberRoleId || '',
    })
    setPeriods(periodFlags(paymentOptions, year))
    setCustomOptions(customPeriods(paymentOptions, year))
    setPayments(p.payments || [])
    setTotals(t.totals || [])
    setLoadError('')
    setReady(true)
  }

  useEffect(() => {
    load().catch((err: unknown) => {
      setReady(false)
      setLoadError(err instanceof Error ? err.message : 'Could not load settings')
    })
  }, [])

  async function save() {
    if (!ready) return
    setBusy(true)
    const res = await fetch('/api/admin/membership/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...settings,
        paymentOptions: periodsToOptions(periods, year, customOptions),
      }),
    })
    setBusy(false)
    toast({ title: res.ok ? 'Settings saved' : 'Save failed', status: res.ok ? 'success' : 'error' })
  }

  async function reconcile() {
    setBusy(true)
    const res = await fetch('/api/admin/membership/reconcile', { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    toast({
      title: res.ok ? `Reconciled ${body.total_users || 0} users` : (body.error || 'Failed'),
      status: res.ok ? 'success' : 'error',
    })
  }

  return (
    <AdminShell title="Membership">
      <Box borderWidth="1px" borderColor="gray.700" rounded="md" p={5} mb={6}>
        <Heading size="sm" mb={3}>Settings</Heading>
        {loadError ? <Text mb={3} color="red.300">{loadError}. Save is disabled so payment periods are not wiped.</Text> : null}
        <HStack mb={3} align="end">
          <Box>
            <Text fontSize="sm">Min DKK</Text>
            <Input type="number" value={settings.minAmountDkk} onChange={(e) => setSettings({ ...settings, minAmountDkk: Number(e.target.value) })} bg="gray.900" />
          </Box>
          <Box>
            <Text fontSize="sm">Max DKK</Text>
            <Input type="number" value={settings.maxAmountDkk} onChange={(e) => setSettings({ ...settings, maxAmountDkk: Number(e.target.value) })} bg="gray.900" />
          </Box>
          <Box flex="1">
            <Text fontSize="sm">Club member Discord role ID</Text>
            <Input value={settings.clubMemberRoleId} onChange={(e) => setSettings({ ...settings, clubMemberRoleId: e.target.value })} bg="gray.900" />
          </Box>
        </HStack>
        <Stack spacing={2} mb={4}>
          <Text fontSize="sm">Payment periods</Text>
          <Checkbox isChecked={periods.current} onChange={(e) => setPeriods({ ...periods, current: e.target.checked })}>
            Current year ({year})
          </Checkbox>
          <Checkbox isChecked={periods.next} onChange={(e) => setPeriods({ ...periods, next: e.target.checked })}>
            Next year ({year + 1})
          </Checkbox>
          <Checkbox isChecked={periods.both} onChange={(e) => setPeriods({ ...periods, both: e.target.checked })}>
            Current + next year ({year}/{year + 1})
          </Checkbox>
          {!periods.current && !periods.next && !periods.both && customOptions.length === 0 ? (
            <Text fontSize="sm" color="orange.300">
              No period is saved. New members can still pay for {year}, so signup does not stop.
            </Text>
          ) : null}
        </Stack>
        <HStack>
          <Button onClick={save} isLoading={busy} isDisabled={!ready} colorScheme="red">Save settings</Button>
          <Button onClick={reconcile} isLoading={busy} variant="outline">Reconcile roles</Button>
          <Button as="a" href="/api/admin/membership/payments.csv" variant="outline">Download CSV</Button>
        </HStack>
      </Box>

      <Heading size="sm" mb={3}>Totals per year</Heading>
      <Table size="sm" mb={8}>
        <Thead><Tr><Th color="gray.400">Year</Th><Th color="gray.400">Amount DKK</Th><Th color="gray.400">Count</Th></Tr></Thead>
        <Tbody>
          {totals.map((t) => (
            <Tr key={t.year}><Td>{t.year}</Td><Td>{t.totalAmountDkk}</Td><Td>{t.count}</Td></Tr>
          ))}
        </Tbody>
      </Table>

      <Heading size="sm" mb={3}>Payments ({payments.length})</Heading>
      <Box overflowX="auto">
        <Table size="sm">
          <Thead>
            <Tr>
              <Th color="gray.400">When</Th>
              <Th color="gray.400">Name</Th>
              <Th color="gray.400">Amount</Th>
              <Th color="gray.400">Status</Th>
              <Th color="gray.400">Zwift ID</Th>
            </Tr>
          </Thead>
          <Tbody>
            {payments.slice(0, 200).map((p) => (
              <Tr key={p.id}>
                <Td>{String(p.createdAt || p.paidAt || '').slice(0, 19)}</Td>
                <Td>{p.fullName || p.discordId}</Td>
                <Td>{p.amountDkk}</Td>
                <Td>{p.status}</Td>
                <Td>{p.zwiftId}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
    </AdminShell>
  )
}
