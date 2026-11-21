'use client'

import { useEffect, useMemo, useState } from 'react'
import AdminShell from '@/components/admin/AdminShell'
import { Box, Button, Input, Select, SimpleGrid, Stat, StatLabel, StatNumber, Table, Tbody, Td, Th, Thead, Tr, useToast, HStack } from '@chakra-ui/react'

export default function MembersAdminPage() {
  const toast = useToast()
  const [type, setType] = useState('all')
  const [members, setMembers] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [zwiftDraft, setZwiftDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  async function load(nextType = type) {
    setLoading(true)
    const res = await fetch(`/api/admin/members?type=${nextType}`)
    const body = await res.json()
    setMembers(body.members || [])
    setLoading(false)
  }

  useEffect(() => { load().catch(() => {}) }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return members
    return members.filter((m) =>
      [m.username, m.displayName, m.discordID, m.zwiftId].some((v) => String(v || '').toLowerCase().includes(s))
    )
  }, [members, q])

  const counts = useMemo(() => ({
    members: filtered.length,
    community: filtered.filter((m) => m.has_member_role).length,
    companion: filtered.filter((m) => m.in_companion).length,
    zwiftpower: filtered.filter((m) => m.in_zwiftpower).length,
  }), [filtered])

  async function assign(discordId: string) {
    const zwiftId = (zwiftDraft[discordId] || '').trim()
    if (!zwiftId) return
    const res = await fetch('/api/admin/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discordId, zwiftId }),
    })
    toast({ title: res.ok ? 'Linked' : 'Failed', status: res.ok ? 'success' : 'error' })
    if (res.ok) load()
  }

  return (
    <AdminShell title="Members">
      <HStack mb={4}>
        <Select w="200px" value={type} onChange={(e) => { setType(e.target.value); load(e.target.value) }} bg="gray.900" color="white">
          <option value="all">All</option>
          <option value="linked">Linked</option>
          <option value="unlinked">Unlinked</option>
        </Select>
        <Input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} bg="gray.900" />
        <Button onClick={() => load()} isLoading={loading}>Refresh</Button>
      </HStack>
      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4} mb={6}>
        <Stat><StatLabel>Members</StatLabel><StatNumber>{counts.members}</StatNumber></Stat>
        <Stat><StatLabel>Community</StatLabel><StatNumber>{counts.community}</StatNumber></Stat>
        <Stat><StatLabel>Companion</StatLabel><StatNumber>{counts.companion}</StatNumber></Stat>
        <Stat><StatLabel>ZP roster</StatLabel><StatNumber>{counts.zwiftpower}</StatNumber></Stat>
      </SimpleGrid>
      <Box overflowX="auto">
        <Table size="sm">
          <Thead>
            <Tr>
              <Th color="gray.400">Discord</Th>
              <Th color="gray.400" w="220px" minW="220px">Zwift ID</Th>
              <Th color="gray.400">Community</Th>
              <Th color="gray.400">Companion</Th>
              <Th color="gray.400">ZP roster</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {filtered.slice(0, 400).map((m) => (
              <Tr key={m.discordID}>
                <Td>{m.displayName || m.username}<Box as="span" color="gray.500" ml={2}>{m.discordID}</Box></Td>
                <Td w="220px" minW="220px">
                  <Input
                    size="sm"
                    defaultValue={m.zwiftId}
                    onChange={(e) => setZwiftDraft({ ...zwiftDraft, [m.discordID]: e.target.value })}
                    bg="gray.900"
                  />
                </Td>
                <Td>{m.has_member_role ? 'yes' : ''}</Td>
                <Td>{m.in_companion ? 'yes' : ''}</Td>
                <Td>{m.in_zwiftpower ? 'yes' : ''}</Td>
                <Td><Button size="xs" onClick={() => assign(m.discordID)}>Save</Button></Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
    </AdminShell>
  )
}
