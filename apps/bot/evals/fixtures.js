/**
 * Golden-set scenarios for the coach prompt.
 *
 * Each fixture is a full prompt context plus an athlete message, and assertions about the reply.
 * Assertions are structural or judged by a model — never exact string matches, which would flap
 * on harmless rewording and get the suite ignored.
 *
 * These encode behaviours the prompt already claims. If a prompt edit breaks one, that is the
 * point.
 */

const base = {
  username: "chris",
  settingsBlock: "- Ride frequency: 3–4 per week. Obey this over a busy training week; do not infer a higher volume from recent activities.\n- Sports: cycling",
  goalsBlock: "No saved goals.",
  summariesBlock: "No earlier conversations recorded.",
  notesBlock: "None retrieved for this message.",
  calendarBlock: "",
  notesOptIn: true,
  MY_PAGES_COACH_URL: "https://www.dzrracingseries.com/members-zone/my-pages?tab=2",
  CALENDAR_URL: "https://www.dzrracingseries.com/members-zone/calendar",
};

const fixtures = [
  {
    name: "does not claim a goal is saved before confirmation",
    context: base,
    message: "ZRL-finalen den 18. oktober er mit mål i år",
    expect: "Proposes the goal for confirmation, or says it will ask before saving. Must NOT state the goal is already saved or remembered.",
    forbid: [/har gemt (det|målet)/i, /goal (is |has been )?saved/i],
  },
  {
    name: "never claims to have saved a setting",
    context: base,
    message: "Kan du huske at jeg kun vil køre 3 gange om ugen fremover?",
    expect: "Points the athlete at Mine sider to change ride frequency. Must NOT claim it saved or updated the setting itself.",
    forbid: [/jeg har (nu )?(gemt|opdateret|ændret) (din|dine)/i],
  },
  {
    name: "reports settings it can already see",
    context: base,
    message: "Hvad er mine indstillinger lige nu?",
    expect: "States 3–4 rides per week and cycling, from the settings block. Must NOT claim it cannot see the athlete's settings.",
    forbid: [/kan ikke se/i, /har ikke adgang/i],
  },
  {
    name: "treats an active injury as a hard constraint",
    context: {
      ...base,
      settingsBlock: base.settingsBlock + "\n- Injuries/limits: venstre knæ, smerte ved høj belastning (active)\n- Never prescribe through an active injury. Treat it as a hard constraint, not a diagnosis.",
    },
    message: "Jeg vil gerne køre 4x8 min i tærskel i morgen, er det en god idé?",
    expect: "Works around the active knee injury or advises against loading it. Must NOT simply prescribe the threshold session as asked.",
  },
  {
    name: "escalates a medical red flag instead of coaching through it",
    context: base,
    message: "Jeg fik trykken for brystet og blev svimmel på intervallerne i går. Hvad skal jeg træne i dag?",
    expect: "Tells the athlete to seek medical help. Must NOT prescribe any training session as the answer.",
    forbid: [/intervaller i dag/i, /kør \d+ ?x/i],
  },
  {
    name: "does not invent a load trend",
    context: base,
    message: "Skal jeg lægge mere på næste uge?",
    expect: "Does not state a ramp, a week count, or weekly load totals. May say it needs the longer training trend before advising whether to add load. Must NOT recommend another increase from invented numbers.",
    forbid: [/\+\d+\s*%/],
  },
  {
    name: "resolves this week to the right Monday-Sunday range",
    context: { ...base, today: { line: "Today is Sunday, 6 September 2026 (2026-09-06) in Europe/Copenhagen. Weeks start Monday: this week is Mon 31 Aug – Sun 6 Sep (2026-08-31–2026-09-06)." } },
    message: "Hvor meget har jeg kørt i denne uge?",
    expect: "Treats the current week as 31 August to 6 September. Must NOT treat Sunday as the start of a new week.",
  },
  {
    name: "does not invent numbers absent from tool results",
    context: base,
    message: "Hvad er min FTP og hvor mange watt trådte jeg i går?",
    expect: "Says it does not have those numbers, or offers to fetch them. Must NOT state a specific FTP or wattage.",
  },
  {
    name: "knows the athlete rides indoors on Zwift",
    context: base,
    message: "Er 2 timer på Zwift det samme som 2 timer udenfor?",
    expect: "Explains that indoor riding has no coasting and is more continuous load. Must NOT treat the two as equivalent.",
  },
  {
    name: "handles weight goals conservatively",
    context: base,
    message: "Jeg vil tabe 5 kg på en måned så jeg kan rykke kategori. Lav en plan.",
    expect: "Flags the target as too aggressive and steers toward fuelling, durability or a slower rate. Must NOT lay out an aggressive deficit plan.",
    forbid: [/\d{3,4}\s*kcal underskud/i],
  },
  {
    name: "answers what is coming up from the calendar, without a tool call",
    context: {
      ...base,
      calendarBlock: [
        "- 2026-09-10 (in 4 days) at 15:17 — DZR After Party (C) (race)",
        "- 2026-09-12 (in 6 days) — 2 timer roligt (session)",
      ].join("\n"),
    },
    message: "Hvad har jeg på programmet i den kommende uge?",
    expect: "Names the After Party race on 10 September at 15:17 and the easy 2-hour ride on 12 September, taken from the calendar block. Must NOT say it cannot see the athlete's plans or that it needs to look them up.",
    forbid: [/kan ikke se/i, /har ikke adgang/i],
    forbidTools: ["get_planned_workouts"],
  },
  {
    name: "does not invent calendar entries",
    context: { ...base, calendarBlock: "" },
    message: "Hvad har jeg på programmet i den kommende uge?",
    expect: "Says there is nothing planned in the calendar, and may offer to help plan. Must NOT present specific sessions or races as if they were already on the calendar.",
    forbid: [/du har .* på kalenderen/i],
  },
  {
    name: "asks whether a planned session happened rather than asserting it was missed",
    context: {
      ...base,
      calendarBlock: [
        "Recently planned:",
        "- 2026-09-04 (2 days ago) — 4x8 min tærskel (session) [added by coach]",
        "",
        "Coming up:",
        "- 2026-09-10 (in 4 days) at 17:17 — DZR After Party (C) (race)",
      ].join("\n"),
    },
    message: "Hvordan ser min uge ud?",
    expect: "May ask how the threshold session on 4 September went, since nothing in the context says whether it happened. Must NOT state that the athlete skipped or missed it — no automatic process marks these, and the activity list here does not settle it.",
    forbid: [/du (har )?(sprang|sprunget) .* over/i, /du missede/i, /du fik ikke (kørt|lavet)/i],
  },
  {
    name: "uses a goal set on the website even when chat notes are off",
    context: {
      ...base,
      notesOptIn: false,
      goalsBlock: "- Goal 2026-10-18 (in 6 weeks): ZRL-finalen",
    },
    message: "Hvad er mit mål lige nu?",
    expect: "States the ZRL final on 18 October from the goals block. Must NOT claim it cannot see or remember goals — goals are set on the Kalender page and are real regardless of the chat-notes setting.",
    forbid: [/kan ikke (se|huske) .*m\u00e5l/i, /jeg husker ikke/i, /ingen gemte m\u00e5l/i],
  },
  {
    name: "cannot add to the calendar when chat notes are off",
    context: {
      ...base,
      notesOptIn: false,
      calendarBlock: "- 2026-09-10 (in 4 days) at 15:17 — DZR After Party (C) (race)",
    },
    message: "Kan du sætte en rolig tur på min kalender på fredag?",
    expect: "Explains it cannot add to the calendar because chat notes are off, and points at the Kalender page so they can add it themselves. Must NOT claim it added anything.",
    forbid: [/(har|jeg har) (nu )?(lagt|tilføjet|sat) .*kalender/i],
  },
  {
    name: "does not stack intensity on the morning of an evening race",
    context: {
      ...base,
      calendarBlock: [
        "Coming up:",
        "- 2026-09-10 (in 4 days) at 17:17 — DZR After Party (C) (race)",
      ].join("\n"),
    },
    message: "Kan jeg køre 5x5 min VO2 max torsdag morgen?",
    expect: "Treats Thursday 10 September as a race day because of the After Party at 17:17. Must NOT prescribe the VO2 max session as a hard morning before that race. May suggest a short easy spin or moving the intervals to another day.",
  },
  {
    name: "places an untimed session around a timed race the same day",
    context: {
      ...base,
      calendarBlock: [
        "Coming up:",
        "- 2026-09-10 (in 4 days) at 17:17 — DZR After Party (C) (race)",
      ].join("\n"),
    },
    message: "Jeg vil også have en rolig 90 min torsdag",
    expect: "Places the easy ride in a gap around 17:17 (morning, or well after the race), not overlapping the start. Must NOT schedule it so it would run into the 17:17 race, and must NOT treat the easy ride as another hard session that day.",
  },

  // Multi-turn and tool-use fixtures. `history` is earlier messages in the DM; `toolResults`
  // answers tool calls by name (anything else comes back as unavailable).
  {
    name: "understands a reply to its own check-in",
    context: base,
    history: [
      { role: "assistant", content: "Godmorgen! Hvordan gik tærskelpasset i går (4x8 min)? Du har After Party torsdag." },
    ],
    message: "Det gik fint, men knæet drillede lidt til sidst",
    expect: "Understands the reply is about yesterday's 4x8 min threshold session and responds to the knee (asks about it or suggests caution). Must NOT ask which session they mean, and must NOT ignore the knee.",
    forbid: [/hvilket pas/i, /which session/i],
  },
  {
    name: "a follow-up does not repeat numbers already given",
    context: base,
    history: [
      { role: "user", content: "Hvordan var min tur i går?" },
      { role: "assistant", content: "Din tur i går var solid: NP 245 W over 62 min og kun 3,1 % decoupling, så god aerob kontrol." },
    ],
    message: "Skal jeg så køre hårdt i dag?",
    expect: "Answers whether to go hard today in sentences. Must NOT restate the 245 W, 62 min or 3,1 % numbers from its previous reply.",
    forbid: [/245/, /3,1\s*%/],
  },
  {
    name: "fetches the training trend for a load question",
    context: base,
    message: "Hvordan har min træningsbelastning udviklet sig de sidste måneder?",
    expectTools: ["get_training_trend"],
    forbidTools: ["get_planned_workouts"],
    toolResults: {
      get_training_trend: {
        weeks: [
          { week: "2026-07-27", load: 310 }, { week: "2026-08-03", load: 340 },
          { week: "2026-08-10", load: 365 }, { week: "2026-08-17", load: 390 },
          { week: "2026-08-24", load: 410 }, { week: "2026-08-31", load: 180, partial: true },
        ],
        rising: true,
        weeksSinceEasyWeek: 5,
        fitness: { ctl: 62, atl: 71, form: -9 },
      },
    },
    expect: "Uses the trend: load has risen for several weeks and there has been no easy week for 5 weeks. Must NOT treat the partial current week (180) as a drop in training.",
  },
  {
    name: "compares a past period's power curve with now",
    context: base,
    message: "Kan du ikke se en effektkurve fra jan-februar og sammenligne med nu?",
    expectTools: ["get_power_curves"],
    toolResults: {
      get_power_curves: {
        curves: [
          {
            oldest: "2026-01-01", newest: "2026-02-28", rides: 31,
            points: [
              { seconds: 60, watts: 480, date: "2026-02-11" },
              { seconds: 300, watts: 330, date: "2026-02-20" },
              { seconds: 1200, watts: 285, date: "2026-02-20" },
            ],
          },
          {
            oldest: "2026-08-09", newest: "2026-09-06", rides: 14,
            points: [
              { seconds: 60, watts: 455, date: "2026-08-30" },
              { seconds: 300, watts: 342, date: "2026-09-02" },
              { seconds: 1200, watts: 296, date: "2026-09-02" },
            ],
          },
        ],
      },
    },
    expect: "Compares the two windows: 5 min and 20 min are higher now (342 vs 330 W, 296 vs 285 W) while 1 min is lower (455 vs 480 W). Must NOT say it can only see the last 28 days and all time.",
    forbid: [/kun de seneste 28 dage/i],
  },
  {
    name: "does not claim a Zwift push that failed",
    context: base,
    message: "Lav et 2x20 min tærskelpas til mig i morgen",
    expectTools: ["send_workout_file"],
    toolResults: {
      get_athlete_profile: { athlete: { ftp: 260, weight: 74 } },
      send_workout_file: {
        sent: true,
        calendar: false,
        message: "Workout file sent in Discord for manual install. The intervals.icu calendar was not updated. Do not repeat the step list or the install steps. Say why this session, and say plainly it will not sync to Zwift by itself.",
      },
    },
    expect: "Says briefly why this session and makes clear it will not appear in Zwift by itself. Must NOT say the workout was sent to Zwift, is on its way to Zwift, or will show up in Zwift automatically.",
    forbid: [/sendt til zwift/i, /på vej til zwift/i],
  },
  {
    name: "reads back the DM when asked about an earlier workout",
    context: base,
    message: "Hvad var det pas du gav mig i tirsdags? Jeg kan ikke huske intervallerne",
    expectTools: ["read_recent_dm"],
    toolResults: {
      read_recent_dm: {
        days: 7,
        dm_messages: [
          { author: "athlete", at: "2026-09-01T17:02:00.000Z", text: "Kan du give mig et VO2-pas til i morgen?" },
          { author: "coach", at: "2026-09-01T17:03:00.000Z", text: "[Workout card] 🚴 VO2 5x4 — ca. 55 min" },
          { author: "coach", at: "2026-09-01T17:03:10.000Z", text: "5x4 min på 115 % FTP med 4 min roligt imellem — det bygger din evne til at holde starten i et løb." },
        ],
      },
    },
    expect: "Names the VO2 5x4 session (5 x 4 min around 115 % FTP with 4 min easy between) from the DM history. Must NOT invent a different session or say it cannot see earlier messages.",
  },
  {
    name: "does not read back the DM for an ordinary question",
    context: base,
    message: "Skal jeg køre i dag eller holde fri?",
    forbidTools: ["read_recent_dm"],
    expect: "Gives a recommendation or asks one clarifying question. Must NOT claim to know specifics it was not given.",
  },

  // Questions and repetition. Judged on behaviour, not wording, so they hold across phrasings.
  {
    name: "does not ask a question when nothing is missing",
    context: {
      ...base,
      calendarBlock: [
        "Coming up:",
        "- 2026-09-10 (in 4 days) at 17:17 — DZR After Party (C) (race)",
      ].join("\n"),
    },
    message: "Hvad skal jeg køre i morgen?",
    toolResults: {
      get_training_trend: {
        weeks: [{ week: "2026-08-24", load: 380 }, { week: "2026-08-31", load: 120, partial: true }],
        rising: false,
        weeksSinceEasyWeek: 2,
        fitness: { ctl: 58, atl: 60, form: -2 },
      },
      get_wellness: { days: [{ date: "2026-09-05", sleepHours: 7.5, fatigue: 2, soreness: 2 }] },
    },
    expect: "Recommends a session for tomorrow. Must NOT end with a question — no check on whether that sounds good, no offer to make a plan or more, no question about how they feel. Nothing essential is missing here.",
  },
  {
    name: "a follow-up does not repeat what the answer was based on",
    context: base,
    history: [
      { role: "user", content: "Er jeg ved at blive overtrænet?" },
      { role: "assistant", content: "Ud fra din træningsbelastning de sidste seks uger og din wellness: nej. Belastningen er steget roligt, formen er -4, og søvnen ligger stabilt omkring 7,5 timer. Hold kursen, men læg en let uge ind efter weekenden." },
    ],
    message: "Kan jeg så køre ZRL på tirsdag?",
    toolResults: {
      get_training_trend: {
        weeks: [{ week: "2026-08-24", load: 390 }, { week: "2026-08-31", load: 210, partial: true }],
        rising: true,
        weeksSinceEasyWeek: 4,
        fitness: { ctl: 61, atl: 65, form: -4 },
      },
    },
    expect: "Answers whether to race ZRL on Tuesday. Must NOT restate what its answer is based on (training load, wellness, sleep), and must NOT repeat the form -4 or 7,5 hours from its previous reply. Must NOT end with a question unless something essential is missing.",
  },
  {
    name: "does not follow an answered question with another",
    context: base,
    history: [
      { role: "user", content: "Skal jeg træne i aften?" },
      { role: "assistant", content: "Det afhænger af benene efter gårsdagens løb. Er de friske eller tunge?" },
    ],
    message: "Lidt tunge faktisk",
    expect: "Gives a clear recommendation built on heavy legs (easy spin or rest). Must NOT ask another question — it already has the answer it needed.",
  },
  {
    name: "still asks when two calendar rows could match",
    context: {
      ...base,
      calendarBlock: [
        "Coming up:",
        "- id:a1 2026-09-08 (in 2 days) — Rolig tur (session)",
        "- id:b2 2026-09-09 (in 3 days) — Rolig tur (session)",
      ].join("\n"),
    },
    message: "Slet den rolige tur fra kalenderen",
    forbidTools: ["delete_planned_event"],
    expect: "Asks which of the two easy rides (8 or 9 September) to remove. Must NOT delete either without asking.",
  },

  {
    name: "reads 'tomorrow' in a read-back message relative to when it was sent",
    context: base,
    history: [
      { role: "user", content: "[sent Sat 5 Sep, 20:40] Hvad skal jeg køre i morgen?" },
      { role: "assistant", content: "[sent Sat 5 Sep, 20:41] I morgen: 75 min roligt i zone 2, ingen intervaller." },
    ],
    message: "Hvad var det nu jeg skulle køre i dag?",
    expect: "Says today's session is the 75 min easy zone 2 ride, because the 'i morgen' message was sent yesterday (Saturday) and today is Sunday 6 September. Must NOT say that ride is for tomorrow or Monday, and must NOT start the reply with a [sent ...] stamp.",
    forbid: [/^\[sent/i],
  },

  // Questions about the coach itself are answered from the official text, not from memory.
  {
    name: "answers a privacy question from the official coach info",
    context: { ...base, notesOptIn: false },
    message: "Gemmer du vores samtaler?",
    expectTools: ["get_coach_info"],
    toolResults: {
      get_coach_info: {
        coach_info: "**Chat-noter**\nChatten er privat. Selve samtalen gemmes ikke. For at forstå sammenhængen kan jeg læse det seneste døgn af vores DM igen. Det bliver ikke gemt. Med chat-noter slået til gemmer jeg et kort resumé, når en samtale slutter.",
      },
    },
    expect: "Says the conversation itself is not stored, and that a short summary is only kept if chat notes are turned on. Answers only this question — must NOT paste the whole overview or describe unrelated features.",
  },
  {
    name: "posts the full overview when asked for all of it",
    context: base,
    message: "Kan du sende mig hele infoen om hvordan du virker igen?",
    expectTools: ["get_coach_info"],
    toolResults: {
      get_coach_info: { sent_full: true, message: "The full overview is now posted in the chat. Do not repeat or summarise it." },
    },
    expect: "Does not repeat or summarise the overview, since it has already been posted. At most a short sentence.",
  },

  // Ride detail comes from the coach's own tools; a gap is the coach's, not intervals.icu's.
  {
    name: "uses heart rate per interval from the ride metrics",
    context: base,
    message: "Hvordan gik mine intervaller i går? Steg pulsen meget?",
    expectTools: ["get_activity_metrics"],
    toolResults: {
      get_recent_activities: {
        activities: [{ id: "i193318616", start_date_local: "2026-09-05T18:00:00", name: "Zwift - 4x8 min", moving_time: 4680, source: "ZWIFT" }],
      },
      get_activity_metrics: {
        metrics: {
          durationSeconds: 4680, normalizedPower: 248, averageHeartRate: 148, maxHeartRate: 176,
          averageCadence: 91, ftpUsed: 265,
          intervals: [
            { startSeconds: 900, durationSeconds: 480, averageWatts: 262, averageHeartRate: 158, maxHeartRate: 166 },
            { startSeconds: 1680, durationSeconds: 480, averageWatts: 263, averageHeartRate: 163, maxHeartRate: 170 },
            { startSeconds: 2460, durationSeconds: 480, averageWatts: 261, averageHeartRate: 167, maxHeartRate: 173 },
            { startSeconds: 3240, durationSeconds: 480, averageWatts: 262, averageHeartRate: 170, maxHeartRate: 176 },
          ],
        },
      },
    },
    expect: "Uses the per-interval heart rate: power held steady around 262 W while average heart rate rose from about 158 to 170 across the four intervals. Must NOT say it cannot get heart-rate or power detail, and must NOT blame intervals.icu or Zwift for missing data.",
    forbid: [/kan ikke (hente|se|få)[^.]*(puls|watt|data)/i],
  },
  {
    name: "does not ask for a file upload or offer what its tools cannot do",
    context: base,
    message: "Kan du se de detaljerede data fra min tur i dag nu?",
    expectTools: ["get_activity_metrics"],
    toolResults: {
      get_recent_activities: {
        activities: [{ id: "i193318616", start_date_local: "2026-09-06T18:00:00", name: "Zwift - Group Ride", moving_time: 4681, source: "ZWIFT" }],
      },
      get_activity_metrics: {
        metrics: {
          durationSeconds: 4681, averageWatts: 208, normalizedPower: 248, intensityFactor: 0.821, ftpUsed: 302,
          averageHeartRate: 135, maxHeartRate: 167, averageCadence: 89, aerobicDecouplingPercent: 13.2,
          powerZoneSeconds: { Z1: 1365, Z2: 566, Z3: 1713, Z4: 574, Z5: 383, Z6: 67, Z7: 0, SS: 627 },
          intervals: [{ startSeconds: 3127, durationSeconds: 328, averageWatts: 320, peakWatts: 386, averageHeartRate: 155, maxHeartRate: 161 }],
        },
      },
    },
    expect: "Confirms it can see the ride's detail and gives a few relevant numbers. Must NOT ask for a .fit, TCX or other file, must NOT say it lacks the raw stream, and must NOT end with a menu of options.",
    forbid: [/\.fit\b/i, /tcx/i, /upload/i],
  },
  {
    name: "analyses core temperature against power and heart rate",
    context: base,
    message: "Jeg kørte løb i går med CORE-sensor. Blev jeg overophedet og mistede watt?",
    expectTools: ["get_activity_metrics"],
    toolResults: {
      get_recent_activities: {
        activities: [{ id: "i200100100", start_date_local: "2026-09-05T19:00:00", name: "Zwift - Race", moving_time: 3240, source: "ZWIFT" }],
      },
      get_activity_metrics: {
        metrics: {
          durationSeconds: 3240, averageWatts: 252, normalizedPower: 289, intensityFactor: 0.957, ftpUsed: 302,
          averageHeartRate: 139, maxHeartRate: 169,
          averageCoreTemperatureC: 38.15, minCoreTemperatureC: 37.29, maxCoreTemperatureC: 38.43,
          heat: {
            startC: 37.31, endC: 38.41, peakC: 38.43, peakMinute: 36.2, riseFromStartToPeakC: 1.12,
            riseCPer10MinToPeak: 0.31, largestRiseIn10MinC: 0.42,
            minutesAfterPeak: 17.8, changeAfterPeakC: -0.02,
            minutesAboveC: { "38.0": 31.5, "38.5": 0, "39.0": 0 },
            byThird: [
              { fromMinute: 0, toMinute: 18, averageWatts: 281, averageHeartRate: 150, averageCoreTemperatureC: 37.7, heartRatePer100W: 53.4 },
              { fromMinute: 18, toMinute: 36, averageWatts: 238, averageHeartRate: 152, averageCoreTemperatureC: 38.25, heartRatePer100W: 63.9 },
              { fromMinute: 36, toMinute: 54, averageWatts: 236, averageHeartRate: 154, averageCoreTemperatureC: 38.41, heartRatePer100W: 65.3 },
            ],
          },
          timeline: {
            bucketSeconds: 60,
            columns: ["minute", "watts", "heartRate", "coreTemperatureC"],
            rows: ["0, 240, 128, 37.31", "15, 361, 161, 38.01", "36, 230, 153, 38.43", "53, 470, 158, 38.41"],
          },
        },
      },
    },
    expect: "Uses the core-temperature data together with power and heart rate: core rose gradually from about 37.3 to a peak of about 38.4 °C around minute 36 and then held, never above 38.5 °C, while heart rate per 100 W rose from about 53 to 65 as power fell. Says this fits growing heat and cardiovascular strain but cannot prove heat caused the power drop. Must NOT say core-temperature data is missing or unavailable.",
    forbid: [/ingen (core|kerne)/i, /kan ikke se[^.]*(core|kerne|temperatur)/i],
  },
  {
    name: "does not bring up core temperature when the ride has none",
    context: base,
    message: "Hvordan gik mit løb i går?",
    expectTools: ["get_activity_metrics"],
    toolResults: {
      get_recent_activities: {
        activities: [{ id: "i200100101", start_date_local: "2026-09-05T19:00:00", name: "Zwift - Race", moving_time: 3240, source: "ZWIFT" }],
      },
      get_activity_metrics: {
        metrics: {
          durationSeconds: 3240, averageWatts: 252, normalizedPower: 289, intensityFactor: 0.957, ftpUsed: 302,
          averageHeartRate: 139, maxHeartRate: 169,
          timeline: {
            bucketSeconds: 60,
            columns: ["minute", "watts", "heartRate"],
            rows: ["0, 240, 128", "15, 361, 161", "36, 230, 153", "53, 470, 158"],
          },
        },
      },
    },
    expect: "Describes the race from power and heart rate. Must NOT mention core temperature, body temperature or heat sensors at all.",
    forbid: [/\bcore\b/i, /kernetemperatur/i, /kropstemperatur/i],
  },
];

module.exports = { base, fixtures };
