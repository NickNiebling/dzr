'use client'

import { useEffect, useState } from 'react'
import AdminShell from '@/components/admin/AdminShell'
import {
  Box,
  Button,
  Checkbox,
  HStack,
  Select,
  Text,
  useToast,
} from '@chakra-ui/react'
import PanelSection from '@/components/admin/roles/PanelSection'
import { DeleteRoleModal, PanelModal, RoleModal, type RoleFormData } from '@/components/admin/roles/RoleModals'
import type { CategoryChannel, GuildRole, PanelRole, RolePanel, TextChannel } from '@/components/admin/roles/types'

async function parseApi(res: Response) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Request failed')
  return body
}

function defaultPanelId(panels: RolePanel[]) {
  const hold = panels.find((p) => {
    const name = String(p.name || '').toLowerCase()
    const id = String(p.panelId || '').toLowerCase()
    return name === 'hold' || id === 'hold'
  })
  if (hold) return hold.panelId
  const teamPanel = panels.find((p) => p.provisioning?.createVoice)
  if (teamPanel) return teamPanel.panelId
  return panels[0]?.panelId || ''
}

export default function RolesAdminPage() {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [panels, setPanels] = useState<RolePanel[]>([])
  const [roles, setRoles] = useState<GuildRole[]>([])
  const [channels, setChannels] = useState<TextChannel[]>([])
  const [categories, setCategories] = useState<CategoryChannel[]>([])
  const [voiceChannels, setVoiceChannels] = useState<TextChannel[]>([])
  const [selectedPanelId, setSelectedPanelId] = useState('')

  const [panelModal, setPanelModal] = useState<{ mode: 'create' | 'edit'; panel?: RolePanel } | null>(null)
  const [roleModal, setRoleModal] = useState<{ mode: 'add' | 'edit'; panelId: string; role?: PanelRole } | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ panel: RolePanel; role: PanelRole } | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  async function load(preferPanelId?: string) {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/roles')
      const body = await parseApi(res)
      const nextPanels: RolePanel[] = body.panels || []
      setPanels(nextPanels)
      setRoles(body.roles || [])
      setChannels(body.channels || [])
      setCategories(body.categories || [])
      setVoiceChannels(body.voiceChannels || [])
      setSelectedPanelId((prev) => {
        if (preferPanelId && nextPanels.some((p) => p.panelId === preferPanelId)) return preferPanelId
        if (prev && nextPanels.some((p) => p.panelId === prev)) return prev
        return defaultPanelId(nextPanels)
      })
    } catch (e: any) {
      toast({ title: e.message || 'Failed to load roles', status: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load().catch(() => {}) }, [])

  const selectedPanel = panels.find((p) => p.panelId === selectedPanelId) || null

  function notify(ok: boolean, message: string) {
    toast({ title: message, status: ok ? 'success' : 'error' })
  }

  async function createPanel(data: any) {
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/roles/panels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const body = await parseApi(res)
      notify(true, body.message)
      setPanelModal(null)
      await load(data.panelId)
    } catch (e: any) {
      notify(false, e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function updatePanel(panelId: string, data: any) {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/roles/panels/${panelId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const body = await parseApi(res)
      notify(true, body.message)
      setPanelModal(null)
      await load()
    } catch (e: any) {
      notify(false, e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function deletePanel(panel: RolePanel) {
    if (!window.confirm(`Delete panel "${panel.name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/admin/roles/panels/${panel.panelId}`, { method: 'DELETE' })
      const body = await parseApi(res)
      notify(true, body.message)
      await load()
    } catch (e: any) {
      notify(false, e.message)
    }
  }

  function rolePayload(data: RoleFormData) {
    return {
      createDiscord: data.createDiscord,
      roleId: data.roleId,
      roleName: data.roleName,
      roleColor: data.roleColor,
      description: data.description || null,
      emoji: data.emoji || null,
      buttonColor: data.buttonColor,
      requiredRoles: data.requiredRoles,
      requiresApproval: data.requiresApproval,
      teamCaptainId: data.teamCaptainId || null,
      roleApprovalChannelId: data.roleApprovalChannelId || null,
      isTeamRole: data.isTeamRole,
      teamName: data.teamName || null,
      raceSeries: data.raceSeries || null,
      division: data.division || null,
      rideTime: data.rideTime || null,
      lookingForRiders: data.lookingForRiders,
      sortIndex: data.sortIndex,
      visibility: data.visibility,
      captainDisplayName: data.captainDisplayName || null,
      textChannelId: data.textChannelId || null,
      voiceChannelId: data.voiceChannelId || null,
      textCategoryId: data.textCategoryId || null,
      voiceCategoryId: data.voiceCategoryId || null,
      redeploy: data.redeploy,
    }
  }

  async function addRole(panelId: string, data: RoleFormData) {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/roles/panels/${panelId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rolePayload(data)),
      })
      const body = await parseApi(res)
      notify(true, body.message)
      setRoleModal(null)
      await load()
    } catch (e: any) {
      notify(false, e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function updateRole(panelId: string, roleId: string, data: RoleFormData) {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/roles/panels/${panelId}/roles/${roleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rolePayload(data)),
      })
      const body = await parseApi(res)
      notify(true, body.message)
      setRoleModal(null)
      await load()
    } catch (e: any) {
      notify(false, e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function removeRole(panel: RolePanel, role: PanelRole, deleteDiscordEntities: boolean) {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/roles/panels/${panel.panelId}/roles/${role.roleId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteDiscordEntities }),
      })
      const body = await parseApi(res)
      notify(true, body.message)
      setDeleteModal(null)
      await load()
    } catch (e: any) {
      notify(false, e.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function reorderRoles(panelId: string, roleOrder: string[]) {
    const previous = panels.find((p) => p.panelId === panelId)?.roles
    setPanels((prev) => prev.map((p) => {
      if (p.panelId !== panelId) return p
      const byId = new Map((p.roles || []).map((r) => [r.roleId, r]))
      return { ...p, roles: roleOrder.map((id) => byId.get(id)).filter(Boolean) as PanelRole[] }
    }))
    try {
      const res = await fetch(`/api/admin/roles/panels/${panelId}/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleOrder }),
      })
      const body = await parseApi(res)
      notify(true, body.message)
    } catch (e: any) {
      if (previous) {
        setPanels((prev) => prev.map((p) => (p.panelId === panelId ? { ...p, roles: previous } : p)))
      }
      notify(false, e.message)
    }
  }

  const editingPanel = panelModal?.panel
  const roleModalPanel = roleModal ? panels.find((p) => p.panelId === roleModal.panelId) : null

  return (
    <AdminShell title="Role Management">
      <HStack mb={4} justify="space-between" spacing={4} wrap="wrap">
        {panels.length > 0 && (
          <Select
            maxW="320px"
            value={selectedPanelId}
            onChange={(e) => setSelectedPanelId(e.target.value)}
            bg="black"
            color="white"
            sx={{ option: { color: '#171923', bg: 'white' } }}
          >
            {panels.map((p) => (
              <option key={p.panelId} value={p.panelId}>{p.name || p.panelId}</option>
            ))}
          </Select>
        )}
        <HStack spacing={4} ml="auto">
          <Checkbox isChecked={showAdvanced} onChange={(e) => setShowAdvanced(e.target.checked)} colorScheme="red">
            Advanced
          </Checkbox>
          <Button onClick={() => load()} isLoading={loading} variant="outline" colorScheme="red">Refresh</Button>
          {showAdvanced && (
            <Button colorScheme="red" onClick={() => setPanelModal({ mode: 'create' })}>Create Panel</Button>
          )}
        </HStack>
      </HStack>

      {panels.length === 0 && !loading ? (
        <Box textAlign="center" py={16} bg="gray.900" rounded="md" border="1px solid" borderColor="whiteAlpha.200">
          <Text mb={4} color="gray.400">No Role Panels Found</Text>
          {showAdvanced && (
            <Button colorScheme="red" onClick={() => setPanelModal({ mode: 'create' })}>Create Panel</Button>
          )}
        </Box>
      ) : selectedPanel ? (
        <PanelSection
          panel={selectedPanel}
          channels={channels}
          showAdvanced={showAdvanced}
          onEditPanel={() => setPanelModal({ mode: 'edit', panel: selectedPanel })}
          onDeletePanel={() => deletePanel(selectedPanel)}
          onAddRole={() => setRoleModal({ mode: 'add', panelId: selectedPanel.panelId })}
          onEditRole={(role) => setRoleModal({ mode: 'edit', panelId: selectedPanel.panelId, role })}
          onRemoveRole={(role) => setDeleteModal({ panel: selectedPanel, role })}
          onReorder={(roleIds) => reorderRoles(selectedPanel.panelId, roleIds)}
        />
      ) : null}

      <PanelModal
        mode={panelModal?.mode || 'create'}
        isOpen={!!panelModal}
        onClose={() => setPanelModal(null)}
        channels={channels}
        categories={categories}
        roles={roles}
        initial={editingPanel || null}
        submitting={submitting}
        onSubmit={(data) => {
          if (panelModal?.mode === 'edit' && editingPanel) {
            updatePanel(editingPanel.panelId, data)
          } else {
            createPanel(data)
          }
        }}
      />

      <RoleModal
        mode={roleModal?.mode || 'add'}
        isOpen={!!roleModal}
        onClose={() => setRoleModal(null)}
        channels={channels}
        voiceChannels={voiceChannels}
        categories={categories}
        roles={roles}
        usedRoleIds={(roleModalPanel?.roles || []).map((r) => r.roleId)}
        panel={roleModalPanel || null}
        initial={roleModal?.role || null}
        submitting={submitting}
        onSubmit={(data) => {
          if (!roleModal) return
          if (roleModal.mode === 'edit' && roleModal.role) {
            updateRole(roleModal.panelId, roleModal.role.roleId, data)
          } else {
            addRole(roleModal.panelId, data)
          }
        }}
      />

      <DeleteRoleModal
        isOpen={!!deleteModal}
        onClose={() => setDeleteModal(null)}
        panel={deleteModal?.panel || null}
        role={deleteModal?.role || null}
        channels={channels}
        voiceChannels={voiceChannels}
        submitting={submitting}
        onConfirm={(deleteDiscordEntities) => {
          if (!deleteModal) return
          removeRole(deleteModal.panel, deleteModal.role, deleteDiscordEntities)
        }}
      />
    </AdminShell>
  )
}
