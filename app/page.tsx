import Image from "next/image";
import { Inter } from "next/font/google";
import HeroSection from "@/components/HeroSection";
import Features from "@/components/Features";
import GoogleCalendarEmbed from "@/components/GoogleCalendar";
import { Metadata } from "next";

import { ColorModeScript } from '@chakra-ui/react'

const inter = Inter({ subsets: ['latin']})

export const metadata: Metadata = {
  title: 'DZR',
  description: 'Danish Zwift Racers',

  metadataBase: new URL('https://www.dzrracingseries.com/'),

  openGraph: {
    title: 'DZR',
    description: 'Danish Zwift Racers',
    url: 'https://www.dzrracingseries.com/',
    siteName: 'DZR',
    images: [
      {
        url: '/general/DZR_logo.svg'
      }
    ],
    type: 'website',
    locale: 'en_US',
  }
}

export default function Home() {
  return (
    <>

    <div style={{backgroundColor:'black'}}>
    <HeroSection />
    <Features />
    </div>
    </>
  );
}


