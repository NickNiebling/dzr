'use client'

import { useEffect, useState } from 'react'
import {
  Box, Button, Heading, Input, Table, Tbody, Td, Text, Textarea, Th, Thead, Tr, useToast, HStack,
} from '@chakra-ui/react'

export default function CollectionManager({
  collection,
  fields,
  idField = 'id',
  initialDraft,
}: {
  collection: string
  fields: Array<{ key: string; label: string; multiline?: boolean }>
  idField?: string
  initialDraft?: Record<string, string>
}) {
  const toast = useToast()
  const [docs, setDocs] = useState<any[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  async function refresh() {
    const res = await fetch(`/api/admin/collection/${collection}`, { cache: 'no-store' })
    const body = await res.json()
    setDocs(body.docs || [])
  }

  useEffect(() => { refresh().catch(() => {}) }, [collection])

  // Prefill (e.g. a knowledge gap's topic); anything already typed wins.
  useEffect(() => {
    if (initialDraft) setDraft((current) => ({ ...initialDraft, ...current }))
  }, [initialDraft])

  async function save() {
    setLoading(true)
    try {
      const payload: Record<string, any> = { ...draft }
      const res = await fetch(`/api/admin/collection/${collection}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      toast({ title: 'Saved', status: 'success' })
      setDraft({})
      await refresh()
    } catch (e: any) {
      toast({ title: e.message || 'Save failed', status: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function remove(id: string) {
    if (!confirm(`Delete ${id}?`)) return
    const res = await fetch(`/api/admin/collection/${collection}/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast({ title: 'Delete failed', status: 'error' })
      return
    }
    await refresh()
  }

  return (
    <Box>
      <Heading size="md" mb={3}>New / upsert</Heading>
      {fields.map((f) => (
        <Box key={f.key} mb={3}>
          <Text fontSize="sm" mb={1}>{f.label}</Text>
          {f.multiline ? (
            <Textarea value={draft[f.key] || ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} bg="gray.900" />
          ) : (
            <Input value={draft[f.key] || ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} bg="gray.900" />
          )}
        </Box>
      ))}
      <Button onClick={save} isLoading={loading} colorScheme="red" mb={8}>Save</Button>

      <Heading size="md" mb={3}>Existing ({docs.length})</Heading>
      <Box overflowX="auto">
        <Table size="sm" variant="simple">
          <Thead>
            <Tr>
              <Th color="gray.400">id</Th>
              {fields.filter((f) => f.key !== idField).slice(0, 4).map((f) => (
                <Th key={f.key} color="gray.400">{f.label}</Th>
              ))}
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {docs.map((d) => (
              <Tr key={d.id}>
                <Td>{d.id}</Td>
                {fields.filter((f) => f.key !== idField).slice(0, 4).map((f) => (
                  <Td key={f.key} maxW="240px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                    {Array.isArray(d[f.key]) ? d[f.key].join(', ') : String(d[f.key] ?? '')}
                  </Td>
                ))}
                <Td>
                  <HStack>
                    <Button size="xs" onClick={() => {
                      const next: Record<string, string> = { id: d.id }
                      fields.forEach((f) => { next[f.key] = Array.isArray(d[f.key]) ? d[f.key].join(', ') : String(d[f.key] ?? '') })
                      setDraft(next)
                    }}>Edit</Button>
                    <Button size="xs" colorScheme="red" variant="outline" onClick={() => remove(d.id)}>Delete</Button>
                  </HStack>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
    </Box>
  )
}
