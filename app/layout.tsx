import type { Metadata } from "next";
import { Inter } from "next/font/google";
import SidebarWithHeader from "@/components/Sidebar";



// app/layout.tsx
import { Providers } from './providers'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode,
}) {
  return (
    <html lang='en'>
      <body>
        <Providers>
          <SidebarWithHeader />
          {children}
        </Providers>
      </body>
    </html>
  )
}
