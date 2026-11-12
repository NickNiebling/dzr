/**
 * Tool definitions offered to DZR Coach.
 *
 * No side effects at import time, so the evals (and eval:dry in CI) can load the real tool list
 * without Firebase or OpenAI credentials. Execution lives in aiChatHandler.
 */
const { EPISODE_NOTE_KINDS } = require("./coachChatNotes");
const { askHelperToolDefinition } = require("./helperAgent");

const coachToolDefinitions = [
  {
    type: "function",
    function: {
      name: "get_athlete_profile",
      description: "Holds weight, height, and FTP for the asking athlete, including a scale weight from the wellness calendar. Call when the answer needs those facts. Always the caller — never another member.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_athlete_stats",
      description: "Holds recent, year-to-date, and all-time ride totals, plus power curves for the last 28 days and all time when intervals.icu has them. Call when the answer needs those totals or a curve. Weekly load and whether to rest are get_training_trend, not this.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_power_curves",
      description: "Holds best power per duration (5 s to 60 min, watts and W/kg, with the date each was set) for one or more date windows. Pass up to four windows to compare periods, e.g. January–February against the last 28 days. Call when the answer needs a power curve from a specific period or a comparison between periods.",
      parameters: {
        type: "object",
        properties: {
          windows: {
            type: "array",
            description: "Date windows, at most 4. Default is the last 28 days.",
            items: {
              type: "object",
              properties: {
                oldest: { type: "string", description: "Window start, YYYY-MM-DD in Denmark." },
                newest: { type: "string", description: "Window end, YYYY-MM-DD in Denmark. Default today." },
                days: { type: "number", description: "Lookback in days ending at newest. Default 28. Ignored when oldest is set." }
              }
            }
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_athlete_zones",
      description: "Holds the asking athlete's heart-rate and power zones. Call when the answer needs zone targets.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_recent_activities",
      description: "Holds ride summaries for a date window: averages only, not interval quality. Default is the last 14 days. Pass days or oldest and newest (YYYY-MM-DD) for any earlier period intervals.icu still has. There is no maximum. Not the weekly load trend. Activities intervals.icu only holds from another platform may be omitted; say so if the message says that.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Lookback in days ending at newest, or today if newest is omitted. Default 14. No maximum. Ignored when oldest is set. For 'this week' (Monday–Sunday, Denmark), fetch enough days to cover from this Monday."
          },
          oldest: {
            type: "string",
            description: "Optional window start, YYYY-MM-DD in Denmark. Use with newest to read a period that is not the most recent rides."
          },
          newest: {
            type: "string",
            description: "Optional window end, YYYY-MM-DD in Denmark. Default today. Not a future date."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_activity_details",
      description: "Holds one ride's summary (time, distance, average power, heart rate) by id from get_recent_activities. Has no sensor streams, so no core or skin temperature: a field missing here says nothing about what the ride recorded. Call when the answer needs that ride and not its interval metrics.",
      parameters: {
        type: "object",
        properties: {
          activity_id: {
            type: "string",
            description: "Activity id from get_recent_activities"
          }
        },
        required: ["activity_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_activity_metrics",
      description: "Holds one ride's detail, computed from every performance field and sensor stream Intervals advertises for it. Common cycling data has named metrics; sourceData preserves other non-empty numeric/boolean activity fields; additionalStreamData compactly summarizes unfamiliar numeric streams. Raw samples, free text, identifiers and route coordinates are deliberately excluded. W-prime balance is derived from power, FTP and Intervals' W-prime value when no stored trace exists. timeline is the ride as a table, one row per bucketSeconds, columns named in timeline.columns, \"-\" for no reading; use it to see how power, heart rate and temperature moved together. When the ride recorded core temperature there are core temperature fields, a coreTemperatureC timeline column and a heat section (start, peak and end temperature, rise rate, minutes above 38.0/38.5/39.0 °C, and heart rate per 100 W by third of the ride). Without them the ride has no core temperature. Missing fields mean the source data was unavailable. Needs an activity id from get_recent_activities. Call when the answer needs how a ride went beyond its averages. One activity at a time.",
      parameters: {
        type: "object",
        properties: {
          activity_id: { type: "string", description: "Activity id from get_recent_activities" },
          from_minute: { type: "number", description: "Optional. Start of one part of the ride, in minutes from the start. Adds a segment with the same metrics for just that part." },
          to_minute: { type: "number", description: "Optional. End of that part, in minutes from the start. Omit for the end of the ride." }
        },
        required: ["activity_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_training_trend",
      description: "Holds weekly load, whether load is rising, how long since an easy week, plus CTL, ATL, and form. Default is about six months. Pass days or oldest (YYYY-MM-DD) for any longer history intervals.icu has. There is no maximum. Not a list of rides. The current week is partial. Not stored. Call when the answer needs that trend.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Lookback in days from today. Default 182. No maximum. Ignored when oldest is set."
          },
          oldest: {
            type: "string",
            description: "Optional window start, YYYY-MM-DD in Denmark. Use for history further back than the default."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_wellness",
      description: "Holds sleep, HRV, soreness, fatigue, resting HR, and daily form. Default is the last 14 days. Pass days or oldest and newest (YYYY-MM-DD) for any earlier period intervals.icu has. There is no maximum. Empty fields are unknown, not fine. Not the weekly load trend.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Lookback in days ending at newest, or today if newest is omitted. Default 14. No maximum. Ignored when oldest is set."
          },
          oldest: {
            type: "string",
            description: "Optional window start, YYYY-MM-DD in Denmark."
          },
          newest: {
            type: "string",
            description: "Optional window end, YYYY-MM-DD in Denmark. Default today."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_planned_workouts",
      description: "Holds workouts queued for Zwift via intervals.icu. Not the athlete's plan. Call only when the answer needs to know whether a structured workout is already waiting to sync. Do not use it for what is coming up.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "How many days ahead of oldest, or of today if oldest is omitted. Default 14. No maximum. Ignored when newest is set."
          },
          oldest: {
            type: "string",
            description: "Optional window start, YYYY-MM-DD in Denmark. Default today."
          },
          newest: {
            type: "string",
            description: "Optional window end, YYYY-MM-DD in Denmark."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_zwiftpower_context",
      description: "Holds ZwiftPower category and phenotype for the asking athlete, if they have a linked Zwift ID. Call when the answer needs category or phenotype.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "search_past_notes",
      description: "Search dated episode notes from earlier coach DMs (feelings, one-off plans). Use when the athlete refers to something discussed before that is not in the retrieved notes block. Not for workouts, not for goals, and not for standing Coach settings.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to look for, e.g. easy week, knee, felt ill"
          },
          sinceDays: {
            type: "number",
            description: "Only notes from the last N days (1-365). Omit to search all stored notes."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_chat_notes",
      description: "Silently persist dated episode notes from this chat (feelings, one-off plans, life schedule). Not for goals. Not for standing Coach settings. Do not mention this save unless they asked if you remembered it. Saving notes must not skip training-data tools.",
      parameters: {
        type: "object",
        properties: {
          notes: {
            type: "array",
            description: "Episode notes to save. Quality over quantity. Prefer none over noise. Max 8. Never include kind goal.",
            items: {
              type: "object",
              properties: {
                text: {
                  type: "string",
                  description: "One or two sentences in the athlete's language."
                },
                kind: {
                  type: "string",
                  enum: EPISODE_NOTE_KINDS,
                  description: "feeling | plan | preference_transient | life"
                },
                eventDate: {
                  type: "string",
                  description: "YYYY-MM-DD if they named a date. Optional. Does not make this a goal."
                }
              },
              required: ["text", "kind"]
            }
          }
        },
        required: ["notes"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_workout_file",
      description: "Add one structured workout to the DZR calendar and push the same workout through intervals.icu so Zwift can pick it up. Posts a short card in Discord. A .zwo file is sent only if the Zwift push fails. Use for a specific structured session, not for a race or a ride they are merely committing to (that is save_planned_event, DZR calendar only). Power is a fraction of FTP. Do not also call save_planned_event for this session. Pass the date they should ride it.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Ride date YYYY-MM-DD in Denmark. Default is tomorrow if omitted." },
          name: { type: "string", description: "Short workout name, e.g. 'VO2 5x4' or 'Tærskel 2x20'." },
          description: { type: "string", description: "One or two sentences on the purpose of the session." },
          steps: {
            type: "array",
            description: "Ordered steps. Start with a warmup and end with a cooldown.",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["warmup", "steady", "intervals", "freeride", "cooldown"] },
                duration: { type: "number", description: "Seconds. For warmup, steady, freeride and cooldown." },
                power: { type: "number", description: "Fraction of FTP for a steady step, e.g. 0.65." },
                powerFrom: { type: "number", description: "Warmup/cooldown start, fraction of FTP." },
                powerTo: { type: "number", description: "Warmup/cooldown end, fraction of FTP." },
                repeat: { type: "number", description: "Interval repetitions." },
                onDuration: { type: "number", description: "Work seconds per repetition." },
                offDuration: { type: "number", description: "Recovery seconds per repetition." },
                onPower: { type: "number", description: "Work power, fraction of FTP, e.g. 1.05." },
                offPower: { type: "number", description: "Recovery power, fraction of FTP, e.g. 0.55." }
              },
              required: ["type"]
            }
          }
        },
        required: ["name", "steps"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_club_races",
      description: "DZR club race series and their usual weekly ride times (ZRL, WTRL TTT, DRS, Club Ladder, DZR After Party). Use when planning the athlete's week around racing, or when they mention a club race and you need to know when it runs.",
      parameters: {
        type: "object",
        properties: {
          series: {
            type: "string",
            description: "Optional filter, e.g. 'WTRL ZRL' or 'DRS'. Omit for all series."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "propose_coach_goal",
      description: "Propose a dated goal and send Ja/Nej buttons. The only way to save a goal from chat. Use when they explicitly call something their goal or ask you to remember a dated aim. Do not use for a casual upcoming ride. Do not say it is saved until they press Ja.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Short goal in the athlete's language, e.g. tabe 3 kg or ZRL-finalen."
          },
          eventDate: {
            type: "string",
            description: "Future date YYYY-MM-DD. Resolve relative dates from Today. Weeks start Monday."
          },
          replaceNoteId: {
            type: "string",
            description: "If they already have 3 active goals, the id of the goal to replace."
          }
        },
        required: ["text", "eventDate"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "save_planned_event",
      description: "Put a race, an event, or a ride the athlete is committing to on the DZR calendar only. Nothing is sent to Zwift. Use when they say they are riding or racing on a date. A structured workout with steps is send_workout_file, which writes the DZR calendar and pushes to Zwift — do not also call this for that session. Do not use it to write out a training plan they did not ask for, and do not use it for a dated aim they call their goal — that is propose_coach_goal.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Short description in the athlete's language, e.g. 'DZR After Party (C)' or '2 timer roligt'."
          },
          eventDate: {
            type: "string",
            description: "Future date YYYY-MM-DD. Resolve relative dates from Today. Weeks start Monday."
          },
          kind: {
            type: "string",
            enum: ["session", "race", "event", "other"],
            description: "race and event have a start time someone else set; session is training they can move."
          },
          startTime: {
            type: "string",
            description: "Optional Europe/Copenhagen wall-clock HH:MM. Set it when they name a time (\"kl. 19\", a DZR subgroup start). Omit it when they do not — an untimed session may float around that day's fixtures. Never guess a race start."
          }
        },
        required: ["text", "eventDate"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_planned_event",
      description: "Remove one row from the DZR calendar when the athlete asks to delete that row. Pass the id shown on the calendar line. This does not remove a planned workout from intervals.icu or from Zwift. Do not call it unless they asked to remove that specific row.",
      parameters: {
        type: "object",
        properties: {
          entryId: {
            type: "string",
            description: "The id: value on the DZR calendar line to remove."
          }
        },
        required: ["entryId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_recent_dm",
      description: "Read back earlier messages from this DM with the athlete (up to 14 days), oldest first, with timestamps. Use only when they refer to something said earlier — advice you gave, a workout you sent, something they told you — that is not in this prompt or found by search_past_notes. Do not use it when a question is merely unclear; ask instead. Nothing is stored.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "How far back, 1-14. Default 7." },
          limit: { type: "number", description: "Max messages, 1-30. Default 20." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_coach_info",
      description: "The official description of how DZR Coach works: what data it reads, what is and is not stored, chat notes, the calendar, check-ins, feedback, settings, and intervals.icu setup. Use whenever they ask how you work, what you can do, or what you save about them. Answer only what they asked, from this text. Set send_full only when they want the whole overview again.",
      parameters: {
        type: "object",
        properties: {
          send_full: { type: "boolean", description: "Post the complete overview in the chat. Only when they ask for all of it (\"send infoen igen\")." }
        }
      }
    }
  },
  askHelperToolDefinition
];

// Tools that read or write conversation-derived memory. Only offered when chat notes are on.
const COACH_NOTE_TOOLS = new Set([
  // Looking further back than the automatic one-day read-back is memory across conversations.
  "read_recent_dm",
  "search_past_notes",
  "save_chat_notes",
  "propose_coach_goal",
  // Reading the calendar is ungated, but writing to it is not: a coach-written row derived
  // from a conversation is persisted conversation content, so it follows the same consent.
  "save_planned_event",
  "delete_planned_event",
]);

/** The tools offered for one turn, depending on the chat-notes setting. */
function coachToolsFor(notesOptIn) {
  return notesOptIn
    ? coachToolDefinitions
    : coachToolDefinitions.filter((t) => !COACH_NOTE_TOOLS.has(t.function?.name));
}

/**
 * Never expose the destructive calendar tool when a vague request could match duplicate rows.
 * The prompt tells the model to ask, but hiding the tool makes that safety boundary deterministic.
 */
function coachToolsForTurn(notesOptIn, { calendarBlock = "", userText = "" } = {}) {
  const tools = coachToolsFor(notesOptIn);
  if (!notesOptIn || !/\b(slet|fjern|delete|remove)\b/i.test(String(userText))) return tools;

  const rows = String(calendarBlock)
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s*-\s+id:([^\s]+)\s+(\d{4}-\d{2}-\d{2}).*?—\s+(.+?)(?:\s+\([^)]*\))?\s*$/);
      return match ? { id: match[1], date: match[2], title: match[3].trim().toLowerCase() } : null;
    })
    .filter(Boolean);
  if (rows.some((row) => String(userText).includes(row.id) || String(userText).includes(row.date))) return tools;

  const titleCounts = new Map();
  for (const row of rows) titleCounts.set(row.title, (titleCounts.get(row.title) || 0) + 1);
  const hasDuplicate = Array.from(titleCounts.values()).some((count) => count > 1);
  return hasDuplicate
    ? tools.filter((tool) => tool.function?.name !== "delete_planned_event")
    : tools;
}

// Answers built on these are where the athlete judges the coach, so they get more reasoning.
const ANALYSIS_TOOLS = new Set(["get_training_trend", "get_activity_metrics", "get_wellness", "get_power_curves"]);

/**
 * Reasoning effort for the model call that follows a tool round. The first call of a turn runs
 * before any tool is chosen, so it always uses the base effort.
 */
function reasoningEffortAfterTools(toolNames, base = "low") {
  const names = Array.from(toolNames || []);
  return names.some((name) => ANALYSIS_TOOLS.has(name)) ? "medium" : base;
}

module.exports = {
  coachToolDefinitions,
  COACH_NOTE_TOOLS,
  ANALYSIS_TOOLS,
  coachToolsFor,
  coachToolsForTurn,
  reasoningEffortAfterTools,
};
