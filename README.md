# Baymax

**A robot that walks the floor and listens, a system that charts it to FHIR, thinks it through, and gets the doctor on the phone before anyone reaches the bedside.**

Built for the YC × Medplum Agentic Healthcare Hackathon.

[Live app](https://baymax-jet.vercel.app) · [Try the voice intake](https://baymax-jet.vercel.app/intake) · [Clinician dashboard](https://baymax-jet.vercel.app/clinician) · [Robot half of this project](https://github.com/KaushikSiva/baymax)

---

## The problem

By the time a patient reaches the exam room, none of what happened before them has reached the clinician yet. A patient checks in and describes their symptoms to a receptionist or a form, and that information sits unread until the doctor walks in and re-asks the same questions from scratch, burning the first minutes of the visit on things the patient already said. In a hospital the gap is worse: nurses walk rounds manually, and a patient's spoken symptom or a monitor spiking heart rate or dropping oxygen can sit unnoticed until someone happens to check that room, because there's no system connecting what a patient says or a monitor reads to the person who needs to act on it in real time.

This repo closes that gap on the digital side. A companion project, [KaushikSiva/baymax](https://github.com/KaushikSiva/baymax), closes it on the physical side: a Unitree G1 humanoid that patrols hospital rooms, listens to patients, and watches vitals monitors. Either path, patient voice or robot patrol, ends the same way: a real FHIR chart, a cited differential, and the doctor's phone ringing with an actual briefing before they ever reach the bedside.

## What it does

1. A patient opens `/intake` in a browser or calls a real phone number. The voice agent asks for their name, looks them up or registers them on the spot if they're new, and starts the visit — no form, no waiting room tablet.
2. As they describe symptoms, the agent charts each one as a real FHIR `Observation` / `Condition` / `AllergyIntolerance`, pulls relevant history through semantic search, runs a ranked differential, and checks insurance eligibility, live, mid-conversation.
3. If it hears something that sounds urgent, it drafts a `Task` for the clinician to approve, the one autonomous action in the flow.
4. `/clinician` shows a live per-patient dashboard: problem list, a likelihood-ranked differential chart, suggested next steps, pending Tasks with an Approve action, and verified cost.
5. The moment the intake ends, the on-call doctor's phone rings, and it's a real conversation grounded in that patient's chart, not a recording. The doctor can ask questions and get answered; their reply is captured and shown back on the dashboard.
6. The same doctor-call pipeline is wired to a robot dispatch endpoint (`/api/robot/monitor-event`), so a physical patrol robot reporting a critical vitals reading triggers the exact same live call.

## Architecture

<p align="center">
  <img src="docs/media/architecture.png" alt="Two front doors, browser and phone, merge at a single Deepgram Voice Agent WebSocket. Function calls route through Next.js API routes to moss.dev, Claude, Stedi, and Medplum Bots, all writing FHIR resources into Medplum, which the clinician screen reads live." width="100%" />
</p>

Both front doors, browser and phone, merge at one Deepgram Voice Agent socket. Everything downstream of the agent, retrieval, reasoning, eligibility, the chart itself, is one shared pipeline regardless of how the patient showed up.

## Built with

| | How it's used |
|---|---|
| **[Medplum](https://www.medplum.com)** | The system of record. Every write, from a charted symptom to a differential to a doctor-call transcript, is a real FHIR R4 resource (`Patient`, `Encounter`, `Condition`, `Observation`, `AllergyIntolerance`, `ClinicalImpression`, `Coverage`, `Task`, `Communication`). The clinician dashboard reads live from Medplum, so what the doctor sees is the same standards-compliant chart a real EHR would hold. |
| **[Deepgram](https://deepgram.com)** | Runs every conversation, both directions. The Voice Agent API (STT + LLM + TTS over one socket) powers the patient intake in the browser and over the phone via a Twilio Media Streams bridge, and drives the outbound doctor call too, so the doctor is talking to a live agent grounded in the patient's chart, not a script. |
| **[moss.dev](https://moss.dev)** | Gives the voice agent memory. A semantic search over the patient's indexed history lets it ask "how's your blood sugar been" instead of a generic checklist, grounded in what's actually in that patient's record. |
| **[Stedi](https://www.stedi.com)** | Real-time 270/271 insurance eligibility, called mid-conversation. The verified coverage and copay get written back to the chart as a FHIR `Coverage` resource before the patient hangs up. |

Plus [Twilio](https://www.twilio.com) for the phone number and Media Streams, [Vercel](https://vercel.com) for the app, and [Render](https://render.com) for the always-listening phone bridge.

## Stack

| Layer | Tech |
|---|---|
| Web app | Next.js 15 (App Router), React 19, TypeScript, Vercel |
| Voice agent | Deepgram Voice Agent API (STT + LLM + TTS over one WebSocket) |
| Phone path | Twilio number → Media Streams → standalone Node `ws` service on Render |
| Retrieval | moss.dev (semantic search over patient history) |
| Differential LLM | OpenAI-compatible gateway (see `lib/llm-gateway.ts`) |
| Eligibility | Stedi 270/271 eligibility API (test mode) |
| Outbound calls | Twilio REST API, connected to a real Deepgram Voice Agent session for the doctor call |
| FHIR data | Medplum (hosted, FHIR R4) |
| Clinician UI | Next.js + `@medplum/react` |

## Live deployments

| Component | URL |
|---|---|
| App (frontend + API routes) | https://baymax-jet.vercel.app |
| Patient intake (voice, browser) | https://baymax-jet.vercel.app/intake |
| Clinician dashboard | https://baymax-jet.vercel.app/clinician |
| Phone bridge (Twilio ↔ Deepgram relay) | https://baymax-phone-bridge.onrender.com |
| Twilio number | +1 (805) 590-5092 |

## Repo layout

```
app/
  intake/              patient voice intake (browser)
  clinician/           clinician dashboard (queue + per-patient chart)
  api/
    agent-config/      Deepgram agent Settings (prompt + tool defs, patient or doctor mode)
    intake/            start/end an Encounter
    patients/          name-based patient lookup
    tasks/approve/     approve a red-flag Task
    tools/             the 6 voice-agent tools (identifyPatient, chartObservation,
                        lookupHistory, runDifferential, checkEligibility, flagRedFlag)
    notify-doctor/     manual + automatic "Call Doctor" trigger
    robot/             ingestion endpoint for external monitors (see KaushikSiva/baymax)
    twilio/            Twilio webhooks (call status, doctor-call transcript capture)
    admin/import/      bulk patient import (see docs/import-payload-example.json)
lib/                   Medplum/Deepgram/moss/Stedi/Twilio/LLM clients + FHIR write helpers
seed/                  one-time seed script + moss indexing
phone-bridge/          standalone Node service: Twilio Media Streams <-> Deepgram (deploy separately)
docs/                  import payload spec/example, architecture diagram
```

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in real keys
npm run dev                        # http://localhost:3000
```

`phone-bridge/` is a separate deployable with its own `package.json`:

```bash
cd phone-bridge
npm install
cp .env.example .env               # fill in real keys
npm run dev
```

## Environment variables

See `.env.local.example` and `phone-bridge/.env.example` for the full list. Notably:

- `AI_GATEWAY_KEY` — differential-generation LLM (independent of Deepgram's own think-model key)
- `MOSS_API_KEY` / `MOSS_PROJECT_ID` — semantic history retrieval
- `STEDI_API_KEY` — eligibility checks (currently falls back to a labeled stub in test mode; see
  `lib/stedi.ts` for why)
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` — outbound calls
- `DOCTOR_PHONE_NUMBER` — who gets called on intake completion, "Call Doctor," or a robot event
- `PHONE_BRIDGE_WSS_URL` / `APP_BASE_URL` — cross-service URLs for the doctor-call and phone paths

## Known limitations

Said plainly, because a demo that hides its edges is less useful than one that names them:

- **Stedi eligibility** returns a labeled stub (`[STUBBED -- ...]`) unless the configured provider
  NPI is actually enrolled with the target payer — Stedi's test mode has no generic always-succeeds
  mock payer. The integration is fully live and wired; it needs real enrollment to return a clean
  benefits response instead of a genuine payer-level rejection.
- **Medplum WebSocket subscriptions** aren't enabled on the hosted project (requires a support
  request to Medplum), so the clinician dashboard polls every 3s instead of updating via push.
- **Render free tier** spins the phone bridge down after inactivity; the first call after an idle
  stretch can be slow enough to cold-start that it misses Twilio's connection window.
