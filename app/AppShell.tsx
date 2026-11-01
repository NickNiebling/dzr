'use client';

import SidebarWithHeader from '@/components/Sidebar';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { AuthProvider } from '@/components/auth/AuthContext';
import { Providers } from './providers';
import DanishInviteBanner from '@/components/DanishInviteBanner';
import type { PublishedSeriesLink } from '@/app/lib/publishedSeriesLink';

export default function AppShell({
  children,
  series,
}: {
  children: React.ReactNode;
  series: PublishedSeriesLink[];
}) {
  return (
    <Providers>
      <AuthProvider>
        <SidebarWithHeader series={series} />
        <div style={{ position: 'relative', minHeight: '100vh', paddingTop: '80px' }}>{children}</div>
        <DanishInviteBanner />
        <Analytics />
        <SpeedInsights />
      </AuthProvider>
    </Providers>
  );
}
