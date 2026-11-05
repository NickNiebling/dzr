'use client'

import AdminShell from '@/components/admin/AdminShell'
import BoardTemplates from '@/components/admin/signups/BoardTemplates'
import LiveSignups from '@/components/admin/signups/LiveSignups'
import { Tabs, TabList, TabPanels, Tab, TabPanel } from '@chakra-ui/react'

export default function SignupsAdminPage() {
  return (
    <AdminShell title="Signup boards">
      <Tabs colorScheme="red">
        <TabList>
          <Tab>Live signups</Tab>
          <Tab>Board templates</Tab>
        </TabList>
        <TabPanels>
          <TabPanel px={0}>
            <LiveSignups />
          </TabPanel>
          <TabPanel px={0}>
            <BoardTemplates />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </AdminShell>
  )
}
