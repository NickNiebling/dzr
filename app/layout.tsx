import type { Metadata } from 'next';
import AppShell from './AppShell';
import { getPublishedSeries } from '@/app/lib/publishedSeries';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.dzrracingseries.com'),
  title: 'Danish Zwift Racers',
  description: 'Join the Danish Zwift Racers community for virtual cycling races and training.',
  openGraph: {
    siteName: 'DZR',
    locale: 'en_US',
    type: 'website',
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const series = await getPublishedSeries();
  return (
    <html lang="en">
      <body>
        <AppShell series={series}>{children}</AppShell>
      </body>
    </html>
  );
}
