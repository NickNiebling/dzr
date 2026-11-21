'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  HStack,
  Input,
  Text,
  useToast,
  VStack,
} from '@chakra-ui/react'

type Rider = { userId: string; displayName: string }
type Option = { value: string; label: string; emoji?: string; riders: Rider[]; userIds: string[] }
type Board = {
  id: string
  title: string
  channelName: string
  updatedAt: number
  total: number
  isLatest: boolean
  isLegacy: boolean
  options: Option[]
}

export default function LiveSignups() {
  const toast = useToast()
  const [boards, setBoards] = useState<Board[]>([])
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load(all = showAll) {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/signups${all ? '?all=1' : ''}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to load signups')
      const next: Board[] = body.boards || []
      setBoards(next)
      setSelectedId((prev) => {
        if (prev && next.some((b) => b.id === prev)) return prev
        return next[0]?.id || null
      })
    } catch (e: any) {
      toast({ title: e.message || 'Failed to load signups', status: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load().catch(() => {}) }, [])

  const selected = boards.find((b) => b.id === selectedId) || null
  const q = search.trim().toLowerCase()

  const filteredOptions = useMemo(() => {
    if (!selected) return []
    if (!q) return selected.options
    return selected.options.map((opt) => ({
      ...opt,
      riders: opt.riders.filter((r) =>
        r.displayName.toLowerCase().includes(q) || r.userId.includes(q)
      ),
    })).filter((opt) => opt.riders.length > 0)
  }, [selected, q])

  async function deleteBoard(board: Board) {
    const extra = board.isLegacy
      ? ' This is the legacy ZRL panel.'
      : board.isLatest
        ? ' This is the current panel in that channel.'
        : ' This is an old/reposted copy.'
    if (!window.confirm(`Delete "${board.title}" in #${board.channelName}?${extra}\n\nThe Discord message and signup list will be removed.`)) return
    setBusy(`delete:${board.id}`)
    try {
      const res = await fetch('/api/admin/signups/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId: board.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Delete failed')
      toast({
        title: body.message || 'Deleted',
        status: body.warning ? 'warning' : 'success',
      })
      await load()
    } catch (e: any) {
      toast({ title: e.message || 'Delete failed', status: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function removeRider(board: Board, rider: Rider, optionValue?: string) {
    const where = optionValue
      ? board.options.find((o) => o.value === optionValue)?.label || optionValue
      : board.title
    if (!window.confirm(`Remove ${rider.displayName} from ${where}?`)) return
    const key = `${board.id}:${optionValue || 'all'}:${rider.userId}`
    setBusy(key)
    try {
      const res = await fetch('/api/admin/signups/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          boardId: board.id,
          userId: rider.userId,
          optionValue: optionValue || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Remove failed')
      toast({
        title: body.message || 'Removed',
        status: body.discordUpdated ? 'success' : 'warning',
      })
      await load()
    } catch (e: any) {
      toast({ title: e.message || 'Remove failed', status: 'error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Box>
      <HStack mb={4} wrap="wrap">
        <Input
          placeholder="Search rider name or Discord ID"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          bg="gray.900"
          maxW="360px"
        />
        <Checkbox
          colorScheme="red"
          isChecked={showAll}
          onChange={(e) => {
            const next = e.target.checked
            setShowAll(next)
            load(next)
          }}
        >
          Include old / reposted boards
        </Checkbox>
        <Button onClick={() => load()} isLoading={loading} variant="outline" colorScheme="red">Refresh</Button>
      </HStack>

      {boards.length === 0 && !loading ? (
        <Text color="gray.400">No live signup boards found.</Text>
      ) : (
        <Flex gap={4} direction={{ base: 'column', md: 'row' }} align="flex-start">
          <Box
            w={{ base: '100%', md: '280px' }}
            flexShrink={0}
            bg="gray.900"
            border="1px solid"
            borderColor="whiteAlpha.200"
            rounded="md"
            p={4}
          >
            <Heading size="sm" mb={3}>Panels</Heading>
            <VStack align="stretch" spacing={2} maxH="70vh" overflowY="auto">
              {boards.map((b) => (
                <Box
                  key={b.id}
                  as="button"
                  textAlign="left"
                  p={2}
                  rounded="md"
                  bg={b.id === selectedId ? 'whiteAlpha.200' : 'transparent'}
                  _hover={{ bg: 'whiteAlpha.100' }}
                  onClick={() => setSelectedId(b.id)}
                >
                  <Text fontSize="sm" fontWeight="semibold">{b.title}</Text>
                  <Text fontSize="xs" color="gray.500">
                    #{b.channelName} · {b.total} signed up
                    {b.isLegacy ? ' · legacy' : ''}
                    {!b.isLatest ? ' · old' : ''}
                  </Text>
                </Box>
              ))}
            </VStack>
          </Box>

          <Box flex="1" minW={0}>
            {!selected ? (
              <Text color="gray.400">Select a panel.</Text>
            ) : (
              <>
                <HStack justify="space-between" align="flex-start" mb={4} wrap="wrap" gap={3}>
                  <Box>
                    <Heading size="sm" mb={1}>
                      {selected.title}
                      {selected.isLegacy ? ' (legacy)' : ''}
                    </Heading>
                    <Text fontSize="sm" color="gray.400">
                      #{selected.channelName} · {selected.total} riders
                      {selected.updatedAt ? ` · updated ${new Date(selected.updatedAt).toLocaleString()}` : ''}
                    </Text>
                  </Box>
                  <Button
                    size="sm"
                    colorScheme="red"
                    variant="outline"
                    isLoading={busy === `delete:${selected.id}`}
                    onClick={() => deleteBoard(selected)}
                  >
                    Delete panel
                  </Button>
                </HStack>
                {filteredOptions.length === 0 && (
                  <Text color="gray.500">No riders{q ? ' match the search' : ' on this panel'}.</Text>
                )}
                {filteredOptions.map((opt) => (
                  <Box
                    key={opt.value}
                    mb={4}
                    border="1px solid"
                    borderColor="whiteAlpha.200"
                    rounded="md"
                    bg="gray.900"
                    overflow="hidden"
                  >
                    <HStack px={4} py={3} justify="space-between" borderBottom="1px solid" borderColor="whiteAlpha.200">
                      <Text fontWeight="semibold">
                        {opt.emoji ? `${opt.emoji} ` : ''}{opt.label}
                      </Text>
                      <Text fontSize="sm" color="gray.400">{opt.riders.length}</Text>
                    </HStack>
                    <VStack align="stretch" spacing={0}>
                      {opt.riders.map((rider) => (
                        <Flex
                          key={`${opt.value}:${rider.userId}`}
                          px={4}
                          py={2}
                          justify="space-between"
                          align="center"
                          gap={3}
                          borderBottom="1px solid"
                          borderColor="whiteAlpha.100"
                        >
                          <Box>
                            <Text fontSize="sm">{rider.displayName}</Text>
                            <Text fontSize="xs" color="gray.500">{rider.userId}</Text>
                          </Box>
                          <HStack>
                            <Button
                              size="xs"
                              colorScheme="red"
                              variant="outline"
                              isLoading={busy === `${selected.id}:${opt.value}:${rider.userId}`}
                              onClick={() => removeRider(selected, rider, opt.value)}
                            >
                              Remove
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              colorScheme="red"
                              isLoading={busy === `${selected.id}:all:${rider.userId}`}
                              onClick={() => removeRider(selected, rider)}
                            >
                              Remove from board
                            </Button>
                          </HStack>
                        </Flex>
                      ))}
                    </VStack>
                  </Box>
                ))}
              </>
            )}
          </Box>
        </Flex>
      )}
    </Box>
  )
}
