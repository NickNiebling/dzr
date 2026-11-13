# Test af browserbaseret OBS-onboarding

[Repository-opsætning](../README.md#obs-streaming) · [Streamingarkitektur](architecture/streaming.md)

`/streaming_add_new` registreres ved normal botstart og bruger samme medlemskontrol, registrering, private nøgle, Lua-fil og streamingtjenester som `/streaming_add`. Eksisterende medlemmer kan genåbne guiden uden nøglerotation. Browseren kræver ikke login og modtager ingen personlig nøgle; forbindelsestesten er valgfri. Det gamle flow er uændret.

## Automatiske kontroller

Brug Node 22 og installér afhængigheder med `npm ci` i roden og `npm ci --ignore-scripts` i `apps/bot`. Kør fra roden:

```sh
npm run test:streaming-setup
npm --prefix apps/bot test
npm test
npx tsc --noEmit
```

Browserregressionen starter selv et isoleret Next.js-website på port 3100 med demo-Firebase-konfiguration, lokal Lua-fil og mockede filhandles. Brug et checkout uden `.env`-filer:

```sh
npm ci --prefix scripts/architecture
node scripts/architecture/node_modules/playwright-core/cli.js install --with-deps chromium
npm run test:streaming-setup:browser
```

`CHROME_BIN` kan vælge en installeret Chromium. Browserkontrollen bruger ingen rigtig Discord-app eller OBS. Lua-transporttesten kræver LuaJIT, libcurl og OpenSSL; mangler LuaJIT, rapporteres den som sprunget over. Rapportér faktiske resultater, og skeln automatiske kontroller fra native OBS-/Discord-tests.

## Kort manuel smoke test

- Opret en registrering på testserveren, og genåbn guiden: privat nøgle ved oprettelse, ingen rotation ved genåbning eller dobbelt indsendelse. Kontrollér også afvisning uden Club Member-rollen og det uændrede `/streaming_add`-flow.
- Følg Windows/macOS-guiden på OBS-computeren. Prøv mappevalg og almindelig download; en anderledes eksisterende fil skal bevares, og annullering eller fejl må ikke ligne succes. Kontrollér også mobilvisningen.
- Indlæs Lua i OBS, kopiér endpoint fra guiden og din personlige nøgle fra Discord. Prøv eventuelt **Test forbindelse** og Discord-statusknappen: et nyt signal vises uden offentlig annonce. Guiden kan også afsluttes uden test; en gemt fil beviser ikke en forbindelse.
- En valgfri offentlig teststream skal bruge den eksisterende verifikation og testkanal. Notér OS, browser, OBS-version og det faktisk afprøvede; browserillustrationer og automatiske tests dokumenterer ikke native OBS-adfærd.

## Valgfri isoleret testbot

Brug en separat Discord-testapp og testserver, en Club Member-testrolle samt private streaming- og IT-kanaler. Giv botten adgang til at se/skrive, embedde links og læse historik. Den eksisterende runner bruger kun streamingfunktionerne og registrerer guild-kommandoer; start ikke `bot.js` mod testdatabasen. Der behøves ingen ekstra Render-service.

Start Firestore-emulatoren med Java og Firebase CLI i en terminal fra roden:

```sh
firebase emulators:start --only firestore --project demo-dzr-streaming
```

Åbn midlertidig HTTPS-adgang til websiteport 3000 og botport 3001. Emulatoren forbliver lokal. Opret den Git-ignorerede `apps/bot/.env.streaming.local`:

```dotenv
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
STREAMING_TEST_BOT_TOKEN=TESTAPPENS_TOKEN
STREAMING_TEST_CLIENT_ID=TESTAPPENS_APPLICATION_ID
STREAMING_TEST_GUILD_ID=TESTSERVERENS_ID
STREAMING_TEST_CLUB_ROLE_ID=TESTROLLENS_ID
STREAMING_TEST_CHANNEL_ID=TESTKANALENS_ID
STREAMING_TEST_IT_CHANNEL_ID=TEST_IT_KANALENS_ID
STREAMING_TEST_PUBLIC_URL=https://BOT-HTTPS-ADRESSE
STREAMING_TEST_SETUP_URL=https://WEBSITE-HTTPS-ADRESSE/streaming/setup
```

Tilføj kun providercredentials for platforme, der testes: `YOUTUBE_API_KEY` og/eller `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET`. Kør `npm run dev:streaming` fra `apps/bot` i en anden terminal. Runneren kontrollerer testappens destinationer, afviser produktionsguild og produktionsadresser og skriver medlemsrollen i emulatoren. `STREAMING_TEST_SETUP_URL` gælder kun denne runner; normal botstart kræver ingen guidekonfiguration.

Website-layoutet læser også Firestore. Start derfor websitet med demo-konfiguration og emulator frem for produktionscredentials. Følgende genererer en lokal testnøgle i hukommelsen; ret `botOrigin`, og kør fra roden i en tredje terminal:

```sh
node <<'NODE'
const { generateKeyPairSync, randomBytes } = require('node:crypto')
const { spawn } = require('node:child_process')
const botOrigin = 'https://BOT-HTTPS-ADRESSE'
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const allowed = ['PATH', 'SystemRoot', 'COMSPEC', 'TMPDIR', 'TMP', 'TEMP',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy', 'NODE_EXTRA_CA_CERTS']
const testEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => allowed.includes(name)))
Object.assign(testEnv, {
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_PROJECT_ID: 'demo-dzr-streaming',
  FIREBASE_CLIENT_EMAIL: 'local-test@demo-dzr-streaming.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey,
  FIREBASE_STORAGE_BUCKET: 'demo-dzr-streaming.appspot.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-dzr-streaming',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaSy' + '0'.repeat(33),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-dzr-streaming.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-dzr-streaming.appspot.com',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:1234567890:web:demo-streaming',
  NEXTAUTH_SECRET: randomBytes(32).toString('hex'),
  NEXTAUTH_URL: 'http://localhost:3000',
  STREAMING_PUBLIC_URL: botOrigin,
})
const child = spawn(process.execPath,
  ['node_modules/next/dist/bin/next', 'dev', '--webpack'],
  { env: testEnv, stdio: 'inherit' })
child.on('exit', code => { process.exitCode = code || 0 })
NODE
```

Åbn `/streaming/setup` uden login, og kør `/streaming_add_new` på testserveren. **Brug testbottens endpoint i OBS**; Lua-filens standard peger på produktionsbotten. Kopiér testnøglen direkte fra Discord til OBS. En separat website-preview kan også bruges med egen test-Firebase-konfiguration og `STREAMING_PUBLIC_URL` sat til testbotten.

## Sammenligning og selvstændige forbedringer

Lad nogle begyndere registrere en kanal og gøre OBS klar med hvert flow i testmiljøet. Brug nye registreringer eller nulstil emulatoren imellem, da det gamle flow roterer nøglen ved gemning. Notér gennemførelse, tid, behov for hjælp, filplaceringsfejl, Discord-handlinger og valg af test; der behøves ingen analytics-infrastruktur.

Disse fem forslag til det oprindelige flow er uafhængige af browserguiden og er ikke implementeret her:

| Prioritet | Forslag | UX-effekt / kompleksitet |
| --- | --- | --- |
| 1 | Tilføj **Vis opsætning**, og adskil kanalredigering fra bekræftet nøgleskift. | Meget høj / middel |
| 2 | Brug permanent filplacering og korte Windows/macOS-trin med billeder. | Høj / lav–middel |
| 3 | Bevar kanalinput ved fejl, og skeln mellem forkert link, optaget kanal og driftsfejl. | Høj / middel |
| 4 | Gør testen tydeligt valgfri, og forklar signaltid kontra verificeret offentlig livestream. | Middel–høj / lav |
| 5 | Undersøg direkte modal inden Discord-fristen. Bevar separate kodefelter til nøgle og endpoint; almindelige Discord-knapper kan ikke kopiere vilkårlig tekst. | Middel / lav–middel |
