import type { Metadata } from 'next'
import StreamingSetupWizard from '@/components/streaming/StreamingSetupWizard'
import { getStreamingSetupConfig } from '@/app/lib/streamingSetup'

export const metadata: Metadata = {
  title: 'Gør OBS klar til DZR',
  description: 'Installér DZR-scriptet i OBS Studio med en enkel vejledning til Windows og macOS.',
  robots: { index: false, follow: false },
}

export default function StreamingSetupPage() {
  let config: ReturnType<typeof getStreamingSetupConfig>
  try {
    config = getStreamingSetupConfig()
  } catch {
    return (
      <main lang="da" style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px', color: 'white' }}>
        <h1>OBS-guiden er midlertidigt utilgængelig</h1>
        <p>Prøv igen om lidt. Du kan også bruge /streaming_add i Discord.</p>
        <p>Hvis du allerede er tilmeldt, skal du være opmærksom på, at gemning i /streaming_add erstatter din DZR-nøgle.</p>
      </main>
    )
  }
  return <StreamingSetupWizard callbackUrl={config.callbackUrl} scriptUrl={config.scriptUrl} />
}
