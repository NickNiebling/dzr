# Review: daglig fejlopsummering fra botten

> **Omfanget er siden udvidet til også at omfatte hjemmesiden.** Reviewet nedenfor
> gælder den oprindelige botversion. Den aktuelle arkitekturanbefaling er fælles,
> struktureret fejlrapportering fra browser, Next-server og bot til en fejltjeneste
> som Sentry, hvorfra botten henter dagens opsummering. Den retning er endnu ikke
> implementeret, og botversionens godkendelsesanbefaling omfatter ikke det nye scope.

Implementeret lokalt på `feat/daily-error-digest`, baseret på `41c801c`. Ingen PR,
push eller deploy er udført, og der er ikke sendt testbeskeder til Discord.

## Adfærd

- Første scheduler-tick fra kl. **08:00 Europe/Copenhagen** sender til
  **1544209256100794378**, hvis der er opsamlet fejllogninger. Tomme dage er stille.
- Omfatter botprocessens `console.error`, inklusive Coach og botjobs. Gentagne
  kodeplaceringer samles med antal og tidspunkt for første/seneste logning.
- Perioden er siden seneste opsamling. Efter nedetid kan den dække flere dage.
  Fejl efter dagens opsamling kommer med næste dag.
- Beskeden indeholder kodeplaceringer og antal. De præcise fejltekster og stacks
  findes fortsat i Render-loggen. Ingen rå argumenter, API-svar eller medlemsdata
  kopieres til Discord eller Firestore.

Illustrativ besked, ikke faktiske produktionsfejl:

```text
Daglig fejlopsummering — DZR-botten
7 fejllogninger siden seneste opsamling.
Første: 24. oktober 10:12 · Seneste: 25. oktober 07:46

• 5 × services/contentApi.js:53
• 2 × handlers/aiChatHandler.js:2780

Placeringer er relative til apps/bot. Detaljer findes i Render-loggen;
rå fejltekster deles ikke her.
```

## Hvorfor denne løsning passer til koden

Den genbruger schedulerens minut-tick, Firestore, CommonJS, `node:test` og de
eksisterende tidszonefunktioner. Ingen nye pakker, tjenester eller AI-kald.

[errorLog.js](../apps/bot/services/errorLog.js) installerer én dokumenteret bro
over `console.error` ved opstart. Den oprindelige logning fortsætter uændret.
Det dækker eksisterende logkald uden en logger-migration gennem mange handlers.
Fremover skal uventede fejl fortsat logges med `console.error`; tavse catches og
fejl, der kun bliver warnings, indgår ikke automatisk.

[errorDigestStore.js](../apps/bot/services/errorDigestStore.js) bruger ét dokument,
`bot_state/error_digest`, med ventende tællinger og højst én fastlåst opsummering.
Firestore-transaktioner sikrer, at nye fejl under afsendelse ikke bliver slettet.
Dokumentet er allerede afskåret fra klientadgang af Firestore-reglernes default deny.
Hvert aggregat gemmer højst 50 placeringer; resten tælles samlet. Ingen voksende
historiksamling eller oprydningsjob.

[errorDigest.js](../apps/bot/services/errorDigest.js) sender gennem klubbotten.
En reservation på fem minutter koordinerer de overlappende instanser, der findes
under Render-deploys. Fejlet afsendelse bevarer opsummeringen til næste tick fra
kl. 08. Genstart kan overtage en udløbet reservation. Ændret kanalindstilling
anvendes også til en ventende opsummering, når den kan reserveres igen.

`ERROR_DIGEST_CHANNEL_ID` kan ændre destinationen. En eksplicit tom værdi slår
afsendelse fra; tællinger opsamles stadig. Botten skal have View Channel og Send
Messages i kanalen. Indsamling og afsendelse starter først ved deploy af ændringen.

## Reviewresultat

Et separat agentreview fandt to fejl, som begge er rettet og regressionstestet:

1. En ventende opsummering fastholdt den gamle kanal, selv efter konfigurationen
   var rettet. En ny reservation bruger nu den aktuelle destination uden at
   ændre opsummeringens identitet eller indhold.
2. En langsom databaseskrivning kunne forbruge reservationens levetid, før den
   blev oprettet. Tidspunkt og dagsnøgle læses nu efter skrivningen.

Genreview: **ingen resterende blokerende fund**. Reviewets anbefaling er at
godkende denne afgrænsede første version med nedenstående begrænsninger.

## Verifikation

- Node **22.23.4**, samme hovedversion som produktion: **319 tests bestået,
  0 fejl, 3 sprunget over**. De tre eksisterende canvas-tests springes over uden
  native canvas-binary, som ved CI-installation med `--ignore-scripts`.
- **24 nye tests** dækker opsamling, fortrolighed, størrelsesgrænser, tomme dage,
  sommer-/vintertid, forsinkede ticks, genstart, samtidige instanser, nye fejl
  under afsendelse, kanalrettelse og database-/Discord-fejl.
- `npm run lint:bot`: **0 fejl**, 18 eksisterende warnings uden for ændringen.
- `npm run eval:dry`: **33/33 bestået**. Shared-copy-check og `git diff --check`
  bestået.
- Discord og Firestore er testet med testdobler. Der er ikke kørt mod produktion,
  så kanaladgang og rigtig levering er endnu ikke verificeret.

## Bevidste begrænsninger

- Dette er tælling af **logkald**, ikke unikke hændelser. Samme fejl logget i flere
  lag kan tælle flere gange. Placeringer skal læses sammen med Render-loggen og
  den kodeversion, der kørte på tidspunktet.
- Tællinger skrives hvert minut og ved almindelig nedlukning. Et hårdt nedbrud
  kan miste endnu ikke gemte tællinger. Ved Firestore-udfald beholdes tællinger i
  hukommelsen, men de overlever ikke en efterfølgende genstart.
- Der er ingen garanti om præcis én levering: Discord kan have accepteret en
  besked, selv om kvitteringen i Firestore fejler. En stabil nonce reducerer
  dubletter, men Discord husker kun nylige nonces. En Discord-kø, der varer
  længere end reservationen, kan også give en dublet ved overtagelse.
- Opstartsfejl før scheduleren kommer i gang, ufangede procesfejl, `console.warn`,
  tavse catches og hjemmesidens/Flask-API'ets egne logs er ikke dækket.
- Fejl i selve opsamlingen eller afsendelsen skrives kun i Render-loggen, så
  fejlovervågningen ikke skaber en rekursiv strøm af fejlbeskeder.

PR afventer brugerens gennemlæsning og accept af løsningen.
