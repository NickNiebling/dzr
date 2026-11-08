'use client'

import React from 'react'
import {
  Accordion, AccordionButton, AccordionIcon, AccordionItem, AccordionPanel,
  Alert, AlertIcon, Box, Button, Checkbox, Code, Container, Heading, HStack,
  Image, Progress, SimpleGrid, Stack, Text,
} from '@chakra-ui/react'
import { FaApple, FaCheckCircle, FaDownload, FaWindows } from 'react-icons/fa'
import {
  fetchScriptFile, getInstallationErrorMessage, installScript, SCRIPT_FILENAME,
  type DirectoryPicker, type InstallationResult,
} from './installScript'

type OperatingSystem = 'windows' | 'macos'
type Props = { callbackUrl: string; scriptUrl?: string }
type PickerWindow = Window & { showDirectoryPicker?: DirectoryPicker }

const steps = ['Computer', 'Gem fil', 'Tilføj i OBS', 'Forbind', 'Afslut']
const obsSteps = [
  { title: 'Åbn Scripts i OBS', image: 'tools-scripts', text: 'Åbn OBS Studio. Vælg Værktøjer / Tools → Scripts i menuen øverst.' },
  { title: 'Klik på plusset', image: 'add-script', text: 'Klik på + nederst til venstre i Scripts-vinduet.' },
  { title: 'Vælg DZR-filen', image: 'select-file', text: 'Find den DZR-mappe, du brugte i trin 2. Vælg dzr-stream.lua, og klik Åbn / Open.' },
]

export default function StreamingSetupWizard({ callbackUrl, scriptUrl = '/api/streaming/script' }: Props) {
  const [step, setStep] = React.useState(1)
  const [os, setOs] = React.useState<OperatingSystem | null>(null)
  const [supportsPicker, setSupportsPicker] = React.useState(false)
  const [mobile, setMobile] = React.useState(false)
  const [mobileDismissed, setMobileDismissed] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [copyMessage, setCopyMessage] = React.useState('')
  const [installation, setInstallation] = React.useState<InstallationResult | null>(null)
  const [downloaded, setDownloaded] = React.useState(false)
  const [manualFileReady, setManualFileReady] = React.useState(false)
  const [obsStep, setObsStep] = React.useState(0)
  const [showTest, setShowTest] = React.useState(false)
  const [finished, setFinished] = React.useState(false)
  const heading = React.useRef<HTMLHeadingElement>(null)
  const fileReady = manualFileReady || installation?.status === 'saved' || installation?.status === 'identical'

  React.useEffect(() => {
    const platform = navigator.platform || navigator.userAgent
    if (/Win/i.test(platform)) setOs('windows')
    else if (/Mac/i.test(platform)) setOs('macos')
    setMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1))
    setSupportsPicker(window.isSecureContext && typeof (window as PickerWindow).showDirectoryPicker === 'function')
  }, [])

  function goTo(next: number) {
    setStep(next)
    setError('')
    setCopyMessage('')
    requestAnimationFrame(() => heading.current?.focus())
  }

  async function copy(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopyMessage(success)
    } catch {
      setCopyMessage('Markér adressen og kopiér med Ctrl+C på Windows eller Cmd+C på Mac.')
    }
  }

  async function install() {
    if (busy) return
    const pick = (window as PickerWindow).showDirectoryPicker
    if (!pick) return
    setBusy(true)
    setError('')
    try {
      // installScript invokes the picker immediately, while this click is active.
      const result = await installScript({
        pickDirectory: (options) => pick.call(window, options),
        fetchScript: () => fetchScriptFile(scriptUrl),
      })
      setInstallation(result)
      if (result.status === 'conflict') {
        setManualFileReady(false)
        setError('Der ligger allerede en anden eller tom dzr-stream.lua i mappen. Den er ikke ændret. Vælg en anden mappe for at gemme den nye fil, eller kontrollér den eksisterende fil først.')
      }
    } catch (cause) {
      setError(getInstallationErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function download() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const bytes = await fetchScriptFile(scriptUrl)
      const url = URL.createObjectURL(new Blob([bytes], { type: 'text/plain;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = SCRIPT_FILENAME
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setDownloaded(true)
    } catch (cause) {
      setError(getInstallationErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function back() {
    if (step === 3 && obsStep > 0) setObsStep(obsStep - 1)
    else goTo(Math.max(1, step - 1))
  }

  function next() {
    if (step === 3 && obsStep < obsSteps.length - 1) {
      setObsStep(obsStep + 1)
      requestAnimationFrame(() => heading.current?.focus())
    } else goTo(step + 1)
  }

  function illustration(name: string, alt: string) {
    return (
      <Image
        src={`/streaming/setup/${os || 'windows'}/${name}.webp`}
        alt={`${os === 'macos' ? 'macOS' : 'Windows'}: ${alt}`}
        width="100%" borderRadius="lg" borderWidth="1px" borderColor="gray.600"
        htmlWidth={1280} htmlHeight={760} height="auto"
        loading="lazy"
      />
    )
  }

  const titles = ['Hvilken computer bruger du til OBS?', 'Gem DZR-scriptet på computeren', obsSteps[obsStep].title, 'Forbind OBS med DZR', 'Opsætningsguiden er gennemført']

  return (
    <Container as="main" lang="da" maxW="3xl" py={{ base: 7, md: 12 }} color="white">
      <Stack spacing={6}>
        <Stack spacing={1}>
          <Text color="red.300" fontWeight="bold" fontSize="sm">DZR STREAMING · OBS STUDIO</Text>
          <Text color="gray.300">Gør OBS klar én gang. DZR giver besked, når din offentlige stream er live.</Text>
        </Stack>

        {mobile && !mobileDismissed && (
          <Box bg="orange.900" borderWidth="1px" borderColor="orange.400" borderRadius="xl" p={5}>
            <Stack spacing={3}>
              <Heading size="md">Fortsæt på computeren med OBS</Heading>
              <Text>Denne guide gemmer en fil til OBS Studio. Åbn guiden på din Windows-computer eller Mac.</Text>
              <Button size="lg" colorScheme="orange" onClick={() => copy(new URL('/streaming/setup', window.location.origin).href, 'Guideadressen er kopieret. Send den til din OBS-computer.')}>
                Kopiér guideadresse
              </Button>
              <Button variant="link" color="white" whiteSpace="normal" onClick={() => setMobileDismissed(true)}>Vis guiden alligevel</Button>
            </Stack>
          </Box>
        )}

        <Box aria-label={`Trin ${step} af 5: ${steps[step - 1]}`}>
          <HStack justify="space-between" mb={2}>
            <Text fontSize="sm" color="gray.300">Trin {step} af 5</Text>
            <Text fontSize="sm" color="gray.300">{steps[step - 1]}</Text>
          </HStack>
          <Progress value={step * 20} colorScheme="red" bg="gray.700" borderRadius="full" size="sm" aria-label="Fremdrift" />
        </Box>

        <Box bg="gray.900" borderWidth="1px" borderColor="gray.700" borderRadius="2xl" p={{ base: 5, md: 8 }}>
          <Stack spacing={6}>
            <Heading ref={heading} tabIndex={-1} size="lg" outline="none">{titles[step - 1]}</Heading>

            {step === 1 && (
              <Stack spacing={5}>
                <Text color="gray.300">Vælg computeren, hvor OBS Studio er installeret. Du kan altid ændre dit valg.</Text>
                <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={4}>
                  {(['windows', 'macos'] as const).map((value) => (
                    <Button
                      key={value} onClick={() => setOs(value)} aria-pressed={os === value}
                      height="120px" fontSize="xl" color="white" borderWidth="2px"
                      borderColor={os === value ? 'red.400' : 'gray.600'}
                      bg={os === value ? 'red.900' : 'gray.800'} _hover={{ bg: 'gray.700' }}
                      leftIcon={value === 'windows' ? <FaWindows size={32} /> : <FaApple size={36} />}
                    >{value === 'windows' ? 'Windows' : 'macOS'}</Button>
                  ))}
                </SimpleGrid>
              </Stack>
            )}

            {step === 2 && (
              <Stack spacing={5}>
                <Text color="gray.300">
                  Filen skal blive liggende i en fast mappe. Vi foreslår Dokumenter / Documents → DZR.
                </Text>
                {supportsPicker && (
                  <Stack spacing={2}>
                    <Button colorScheme="red" size="lg" minH="56px" whiteSpace="normal" onClick={install} isLoading={busy} loadingText="Arbejder…">
                      {installation?.status === 'conflict' ? 'Vælg en anden mappe' : 'Installér DZR OBS-script'}
                    </Button>
                    <Text color="gray.400" fontSize="sm">Vælg Dokumenter eller en anden fast mappe, og tillad adgang. DZR-mappen oprettes for dig.</Text>
                  </Stack>
                )}
                <Button
                  leftIcon={<FaDownload />} onClick={download} isDisabled={busy}
                  variant={supportsPicker ? 'outline' : 'solid'} colorScheme={supportsPicker ? 'gray' : 'red'}
                  color="white" size="lg" minH="52px" whiteSpace="normal"
                >{supportsPicker ? 'Hent filen i stedet' : 'Hent dzr-stream.lua'}</Button>
                {!supportsPicker && <Text color="gray.400" fontSize="sm">Din browser bruger almindelig download. Du kan følge hele guiden her.</Text>}

                {installation && installation.status !== 'conflict' && (
                  <Alert status="success" bg="green.900" borderRadius="lg">
                    <AlertIcon />
                    <Text>{installation.status === 'saved' ? 'Filen er gemt i' : 'Den samme fil ligger allerede i'} <strong>{installation.directoryName}</strong>. Nu skal den tilføjes i OBS.</Text>
                  </Alert>
                )}

                {(downloaded || !supportsPicker) && (
                  <Stack spacing={3}>
                    <Text>{downloaded ? 'Når filen er hentet:' : 'Efter download:'} Åbn Downloads / Overførsler. Opret en DZR-mappe i Dokumenter, og flyt <strong>dzr-stream.lua</strong> dertil.</Text>
                    {illustration('save-file', 'Flyt dzr-stream.lua fra Downloads til en fast DZR-mappe i Dokumenter.')}
                    <Text color="gray.400" fontSize="sm">Behold filnavnet dzr-stream.lua. Undgå en ekstra endelse som .txt eller et nummer i filnavnet.</Text>
                  </Stack>
                )}

                <Checkbox colorScheme="red" isChecked={manualFileReady} onChange={(event) => setManualFileReady(event.target.checked)} isDisabled={busy} alignItems="start">
                  Jeg har selv lagt dzr-stream.lua i en fast DZR-mappe.
                </Checkbox>
                {manualFileReady && <Text color="green.300" fontSize="sm">Du har bekræftet filens placering. Browseren har ikke kontrolleret den.</Text>}
              </Stack>
            )}

            {step === 3 && (
              <Stack spacing={4}>
                <Text color="red.300" fontSize="sm">OBS · {obsStep + 1} af {obsSteps.length}</Text>
                <Text fontSize="lg">{obsSteps[obsStep].text}</Text>
                {illustration(obsSteps[obsStep].image, obsSteps[obsStep].text)}
                {obsStep === 2 && (
                  <Text color="gray.400" fontSize="sm">Er filen allerede tilføjet? Vælg den i listen. Hvis den er flyttet eller slettet, skal du gendanne den på den gamle placering og genindlæse scriptet i OBS.</Text>
                )}
              </Stack>
            )}

            {step === 4 && (
              <Stack spacing={5}>
                <Text>Vælg <strong>dzr-stream.lua</strong> i OBS-listen. Udfyld felterne til højre.</Text>
                {illustration('configure', 'DZR endpoint og DZR key i OBS-scriptets indstillinger. Ingen platformvælger.')}
                <Stack spacing={2}>
                  <Text fontWeight="bold">DZR endpoint</Text>
                  <Code display="block" p={3} borderRadius="md" bg="gray.800" color="white" whiteSpace="normal" overflowWrap="anywhere" userSelect="all">{callbackUrl}</Code>
                  <Button size="lg" colorScheme="red" onClick={() => copy(callbackUrl, 'DZR-adressen er kopieret. Indsæt den i DZR endpoint i OBS.')}>Kopiér adresse</Button>
                </Stack>
                <Stack spacing={2}>
                  <Text fontWeight="bold">DZR key</Text>
                  <Text color="gray.300">Find den private Discord-besked, hvor din nøgle blev oprettet med <strong>/streaming_add_new</strong> eller <strong>/streaming_add</strong>. Kopiér din personlige DZR-nøgle direkte ind i OBS.</Text>
                  <Text color="gray.400" fontSize="sm">Det er din DZR-nøgle, ikke streamnøglen til YouTube eller Twitch. Del den ikke. Har du allerede den rigtige nøgle i OBS, beholder du den.</Text>
                </Stack>
                <Text color="gray.300">DZR finder automatisk aktive streams på dine tilmeldte YouTube- og Twitch-kanaler. Du skal ikke vælge platform i OBS.</Text>
                <Accordion allowToggle>
                  <AccordionItem borderColor="gray.700">
                    <h3><AccordionButton px={0} py={3}><Box flex="1" textAlign="left">Mistet nøgle eller spørgsmål om YouTube?</Box><AccordionIcon /></AccordionButton></h3>
                    <AccordionPanel px={0} color="gray.300">
                      <Stack spacing={3}>
                        <Text>Nøglen vises kun, når den oprettes, i den private Discord-besked. Hvis den ikke længere er tilgængelig, kan du få en ny via /streaming_add.</Text>
                        <Text color="orange.200"><strong>Advarsel:</strong> Når du gemmer formularen i /streaming_add, bliver den gamle nøgle ugyldig. Opdatér derefter nøglen i OBS. Denne guide ændrer aldrig din nøgle.</Text>
                        <Text><strong>YouTube-videolink</strong> er valgfrit. Du kan lade feltet stå tomt. Et link til den aktuelle stream kan gøre live-verifikationen hurtigere; opdatér det, hvis du bruger det.</Text>
                      </Stack>
                    </AccordionPanel>
                  </AccordionItem>
                </Accordion>
              </Stack>
            )}

            {step === 5 && (
              <Stack spacing={5}>
                <HStack align="start" spacing={3}>
                  <Box color="green.300" pt={1}><FaCheckCircle size={24} /></Box>
                  <Text>Du har gennemgået installationen og indstillingerne. Behold filen i DZR-mappen.</Text>
                </HStack>
                <Alert status="info" bg="blue.900" borderRadius="lg"><AlertIcon /><Text>OBS-forbindelsen er ikke kontrolleret her. Kun et nyt signal i Discord bekræfter forbindelsen.</Text></Alert>
                {finished ? (
                  <Text color="green.300" fontWeight="bold" role="status">Guiden er afsluttet. Du kan lukke denne side.</Text>
                ) : (
                  <Button colorScheme="red" size="lg" minH="56px" onClick={() => setFinished(true)}>Afslut uden test</Button>
                )}
                <Button color="white" variant="outline" size="lg" whiteSpace="normal" minH="52px" onClick={() => setShowTest(!showTest)} aria-expanded={showTest} aria-controls="connection-test">
                  {showTest ? 'Skjul forbindelsestest' : 'Vis forbindelsestest – valgfrit'}
                </Button>
                {showTest && (
                  <Stack id="connection-test" spacing={3} bg="gray.800" p={4} borderRadius="lg">
                    <Text><strong>1.</strong> Klik på <strong>Test forbindelse</strong> i OBS-scriptets indstillinger.</Text>
                    <Text><strong>2.</strong> Gå tilbage til din private Discord-besked, og klik på <strong>Kontrollér OBS-forbindelse</strong>.</Text>
                    <Text><strong>3.</strong> Kontrollér, at tidspunktet for signalet passer med din nye test.</Text>
                    <Text color="gray.300" fontSize="sm">Intet nyt signal? Kontrollér DZR endpoint og DZR key, og prøv igen. Du kan åbne statusknappen igen med /streaming_add_new uden at ændre din nøgle.</Text>
                    <Text color="gray.300" fontSize="sm">Testen sender ingen offentlig besked. En annonce kræver, at din offentlige livestream er verificeret.</Text>
                    {!finished && <Button colorScheme="red" size="lg" onClick={() => setFinished(true)}>Afslut guiden</Button>}
                  </Stack>
                )}
              </Stack>
            )}

            {error && <Alert status="warning" bg="orange.900" borderRadius="lg" role="alert"><AlertIcon /><Text>{error}</Text></Alert>}
            {copyMessage && <Text role="status" aria-live="polite" color="blue.200">{copyMessage}</Text>}

            {step < 5 && (
              <Stack direction={{ base: 'column-reverse', sm: 'row' }} spacing={3} pt={2}>
                {step > 1 && <Button color="white" size="lg" variant="outline" onClick={back} isDisabled={busy}>Tilbage</Button>}
                <Button
                  colorScheme="red" size="lg" minH="52px" flex="1" whiteSpace="normal" onClick={next}
                  isDisabled={busy || (step === 1 && !os) || (step === 2 && !fileReady)}
                >{step === 2 ? 'Filen er klar – fortsæt' : step === 4 ? 'Jeg har udfyldt OBS' : 'Fortsæt'}</Button>
              </Stack>
            )}
            {step === 5 && <Button variant="link" color="gray.300" alignSelf="start" onClick={back}>Tilbage til indstillingerne</Button>}
          </Stack>
        </Box>
        {os && <Button variant="link" color="gray.400" alignSelf="start" isDisabled={busy} onClick={() => goTo(1)}>Computer: {os === 'windows' ? 'Windows' : 'macOS'} · Skift</Button>}
      </Stack>
    </Container>
  )
}
