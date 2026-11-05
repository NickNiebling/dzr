'use client'

import { useEffect, useState } from 'react'
import {
  Box, Button, Checkbox, Heading, HStack, Input, Table, Tbody, Td, Text, Textarea, Th, Thead, Tr, useToast, VStack,
} from '@chakra-ui/react'
import { COLLECTIONS } from '@/app/lib/sharedConstants'
import { categoriesToOptions, categoryKey, type Category } from './boardTemplateOptions'

const MAX_CATEGORIES = 25

type Draft = {
  id: string
  title: string
  channelId: string
  description: string
  allowMultiple: boolean
  categories: Category[]
}

function emptyCategory(): Category {
  return { emoji: '', label: '', value: '' }
}

function emptyDraft(): Draft {
  return {
    id: '',
    title: '',
    channelId: '',
    description: '',
    allowMultiple: false,
    categories: [emptyCategory()],
  }
}

function categoriesFromDoc(options: unknown): Category[] {
  if (!Array.isArray(options) || options.length === 0) return [emptyCategory()]
  return options.map((opt) => {
    const row = opt && typeof opt === 'object' ? opt as Record<string, unknown> : {}
    return {
      emoji: typeof row.emoji === 'string' ? row.emoji : '',
      label: typeof row.label === 'string' ? row.label : '',
      value: typeof row.value === 'string' ? row.value : '',
      roleId: typeof row.roleId === 'string' ? row.roleId : undefined,
    }
  })
}

export default function BoardTemplates() {
  const toast = useToast()
  const [docs, setDocs] = useState<any[]>([])
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [loading, setLoading] = useState(false)

  async function refresh() {
    const res = await fetch(`/api/admin/collection/${COLLECTIONS.signupBoardConfigs}`, { cache: 'no-store' })
    const body = await res.json()
    setDocs(body.docs || [])
  }

  useEffect(() => { refresh().catch(() => {}) }, [])

  function updateCategory(index: number, patch: Partial<Category>) {
    setDraft((current) => ({
      ...current,
      categories: current.categories.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }))
  }

  async function save() {
    setLoading(true)
    try {
      const options = categoriesToOptions(draft.categories)
      const payload: Record<string, unknown> = {
        title: draft.title.trim(),
        channelId: draft.channelId.trim(),
        description: draft.description,
        allowMultiple: draft.allowMultiple,
        options,
      }
      if (!payload.title) throw new Error('Title is required')
      const id = draft.id.trim()
      if (id) payload.id = id
      const res = await fetch(`/api/admin/collection/${COLLECTIONS.signupBoardConfigs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Save failed')
      toast({ title: 'Template saved', description: `${options.length} categories`, status: 'success' })
      setDraft(emptyDraft())
      await refresh()
    } catch (e: any) {
      toast({ title: e.message || 'Save failed', status: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function remove(id: string) {
    if (!confirm(`Delete template ${id}?`)) return
    const res = await fetch(`/api/admin/collection/${COLLECTIONS.signupBoardConfigs}/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast({ title: 'Delete failed', status: 'error' })
      return
    }
    if (draft.id === id) setDraft(emptyDraft())
    await refresh()
  }

  function edit(doc: any) {
    setDraft({
      id: doc.id || '',
      title: doc.title || '',
      channelId: doc.channelId || '',
      description: doc.description || '',
      allowMultiple: Boolean(doc.allowMultiple),
      categories: categoriesFromDoc(doc.options),
    })
  }

  return (
    <Box>
      <Heading size="md" mb={1}>{draft.id ? `Edit ${draft.id}` : 'New template'}</Heading>
      <Text fontSize="sm" color="gray.400" mb={4}>
        Each category is a button on the Discord board. After saving, post it with /post_signup_board and pick this template.
        A rider stays in one category unless you allow more than one.
      </Text>

      <VStack align="stretch" spacing={3} mb={4}>
        <Box>
          <Text fontSize="sm" mb={1}>ID (optional, leave blank to auto-create)</Text>
          <Input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} bg="gray.900" placeholder="hold-klubmesterskab-2026" />
        </Box>
        <Box>
          <Text fontSize="sm" mb={1}>Title</Text>
          <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} bg="gray.900" placeholder="Hold klubmesterskab 2026" />
        </Box>
        <Box>
          <Text fontSize="sm" mb={1}>Channel ID</Text>
          <Input value={draft.channelId} onChange={(e) => setDraft({ ...draft, channelId: e.target.value })} bg="gray.900" />
        </Box>
        <Box>
          <Text fontSize="sm" mb={1}>Description</Text>
          <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} bg="gray.900" />
        </Box>
      </VStack>

      <Heading size="sm" mb={2}>Categories</Heading>
      <VStack align="stretch" spacing={2} mb={3}>
        {draft.categories.map((row, index) => (
          <HStack key={index} align="flex-end" spacing={2}>
            <Box w="88px" flexShrink={0}>
              <Text fontSize="xs" mb={1}>Emoji</Text>
              <Input value={row.emoji} onChange={(e) => updateCategory(index, { emoji: e.target.value })} bg="gray.900" placeholder="🇦" />
            </Box>
            <Box flex="1">
              <Text fontSize="xs" mb={1}>Name</Text>
              <Input value={row.label} onChange={(e) => updateCategory(index, { label: e.target.value })} bg="gray.900" placeholder="Division A" />
            </Box>
            <Box w="180px" flexShrink={0}>
              <Text fontSize="xs" mb={1}>Key</Text>
              <Input
                value={row.value}
                onChange={(e) => updateCategory(index, { value: e.target.value })}
                bg="gray.900"
                placeholder={categoryKey(row.label) || 'auto'}
              />
            </Box>
            <Button
              size="md"
              variant="outline"
              isDisabled={draft.categories.length === 1}
              onClick={() => setDraft({
                ...draft,
                categories: draft.categories.filter((_, i) => i !== index),
              })}
            >
              Remove
            </Button>
          </HStack>
        ))}
      </VStack>
      <HStack mb={4} wrap="wrap">
        <Button
          size="sm"
          variant="outline"
          isDisabled={draft.categories.length >= MAX_CATEGORIES}
          onClick={() => setDraft({ ...draft, categories: [...draft.categories, emptyCategory()] })}
        >
          Add category
        </Button>
        <Checkbox
          colorScheme="red"
          isChecked={draft.allowMultiple}
          onChange={(e) => setDraft({ ...draft, allowMultiple: e.target.checked })}
        >
          Allow a rider to sign up for more than one category
        </Checkbox>
      </HStack>
      <Text fontSize="xs" color="gray.500" mb={4}>
        Leave Key blank to generate it from the name. Keep a key the same after riders have signed up, or their names drop off that category.
      </Text>

      <HStack mb={8}>
        <Button onClick={save} isLoading={loading} colorScheme="red">Save template</Button>
        <Button variant="ghost" onClick={() => setDraft(emptyDraft())}>Clear</Button>
      </HStack>

      <Heading size="md" mb={3}>Existing ({docs.length})</Heading>
      <Box overflowX="auto">
        <Table size="sm" variant="simple">
          <Thead>
            <Tr>
              <Th color="gray.400">id</Th>
              <Th color="gray.400">Title</Th>
              <Th color="gray.400">Categories</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {docs.map((d) => {
              const labels = Array.isArray(d.options)
                ? d.options.map((o: any) => o?.label || o?.value).filter(Boolean).join(', ')
                : ''
              return (
                <Tr key={d.id}>
                  <Td>{d.id}</Td>
                  <Td>{d.title || ''}</Td>
                  <Td maxW="360px">{labels || '—'}</Td>
                  <Td>
                    <HStack>
                      <Button size="xs" onClick={() => edit(d)}>Edit</Button>
                      <Button size="xs" colorScheme="red" variant="outline" onClick={() => remove(d.id)}>Delete</Button>
                    </HStack>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      </Box>
    </Box>
  )
}
