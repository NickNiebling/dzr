import HeroSection from '@/components/HeroSection';
import Features from '@/components/Features';
import { Metadata } from 'next';
import { JsonLd, sportsClubJsonLd } from '@/components/seo/JsonLd';
import { getPublishedSeries } from '@/app/lib/publishedSeries';

export const metadata: Metadata = {
  title: 'Danish Zwift Racers — Danish Zwift club and DCU E-Serien',
  description:
    'Danish Zwift Racers is a Danish online cycling club for e-cycling on Zwift and a member of Danmarks Cykle Union. We are active in DCU E-Serien, Zwift Racing League, ECRO, Club Ladder and other racing series on Zwift.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Danish Zwift Racers: Race, Train, and Ride Together on Zwift',
    description:
      'A Danish Zwift club for e-cycling. Member of Danmarks Cykle Union. We are active in DCU E-Serien, Zwift Racing League, ECRO, Club Ladder and other racing series on Zwift.',
    url: '/',
    siteName: 'DZR',
    images: [
      {
        url: '/general/DZR_logo.svg',
      },
    ],
    type: 'website',
    locale: 'en_US',
  },
};

export default async function Home() {
  const series = await getPublishedSeries();
  return (
    <>
      <JsonLd data={sportsClubJsonLd} />
      <HeroSection />
      <Features series={series} />
    </>
  );
}
