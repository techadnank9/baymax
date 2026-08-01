# CLAUDE.md

Project-specific notes for working in this repo. See `README.md` for the feature overview and
live URLs.

## Gotchas found the hard way

- **`phone-bridge/` is excluded from the root `tsconfig.json`** (`exclude: ["phone-bridge"]`). It's
  a separate deployable with its own `package.json`/deps that Vercel never installs — including it
  in the root TS build broke the Vercel build (`Could not find a declaration file for module 'ws'`).
- **`@moss-dev/moss` is dynamically imported (`await import(...)`), never a static top-level import**
  in `lib/moss.ts`. It's a native N-API addon; Next's build-time "collect page data" step eagerly
  evaluates static route imports even without calling the handler, which loaded the native binary
  during the Vercel build and failed there. Deferring to request time fixed it.
- **No `vercel.json`.** A leftover one from before this template was Next.js routed *everything* to
  `/`, silently breaking every API route and page in production. It never showed up in `next dev`
  (which ignores `vercel.json`) — only surfaced on Vercel. If you're debugging "routes 200 locally
  but 404/wrong-content in production," check for a stray `vercel.json` first.
- **Vercel SSO/Deployment Protection was on by default** and blocked all unauthenticated access —
  fatal for this app since Deepgram, Twilio's phone-bridge, and browser JS all need to call
  `/api/*` routes unauthenticated. Disabled via the Vercel API (`ssoProtection: null`). Preview
  deployments still need this checked if the project is ever transferred/recreated.
- **Medplum hosted project has two features gated behind a support email**, not self-service:
  `websocket-subscriptions` (dashboard polls instead) and `Bots` (FHIR writes happen directly from
  API routes instead of through Bots, despite the original spec calling for Bots specifically).
- **Stedi test mode has no generic mock payer.** A real request against a real payer with a made-up
  provider NPI returns a genuine HTTP 200 with an AAA error (`Invalid/Missing Provider
  Identification`), not a clean success. `lib/stedi.ts` detects this and falls back to a clearly
  labeled stub `Coverage`.
- **`AI_GATEWAY_KEY` is a hackathon-provided gateway key, not a raw OpenAI key.** It only works
  against the raw Responses API endpoint in `lib/llm-gateway.ts` — the documented
  `/gw/v1/chat/completions` proxy path 404s. If that key ever needs replacing, verify the actual
  reachable endpoint before assuming the docs are current.
- **Render auto-deploy-on-push isn't wired up** for `phone-bridge` (Render logged "doesn't look
  like we have access to your repo" on first deploy). Trigger deploys manually via the Render API
  (`POST /v1/services/{id}/deploys`) until the GitHub App permission is fixed in Render's dashboard.
- **Render's default readiness check is slow to confirm a live process** when the app only returns
  200 on specific paths (not `/`) — after a restart it can take several minutes for Render to mark
  the service routable even though the process started fine. Don't assume "no response yet" means
  crashed; check `/v1/services/{id}/deploys` and logs before restarting again.

## Patterns to follow

- Every route logs via `lib/logger.ts` (`createLogger('scope')`) — request in, result or error out.
  Keep this up in any new route.
- FHIR writes go through `lib/fhir-writes.ts` helpers, not inline `medplum.createResource` calls
  scattered in routes, so the resource shapes stay in one place.
- The voice agent's tool contract (functions, prompt) lives in `lib/deepgram.ts` — both `/intake`
  (browser) and `phone-bridge/server.ts` (phone) fetch `/api/agent-config` and share the exact same
  tool routing table (`TOOL_ROUTES` in each). If you add a tool, update both call sites' routing
  tables, not just the Next.js one.
- Voice-driven identification (`identifyPatient`) auto-registers unknown names rather than
  rejecting them — see `app/api/tools/identify-patient/route.ts`. Other tools reject calls made
  before identification succeeds (both in `/intake` and `phone-bridge/server.ts`).
- Outbound Twilio calls only ever speak clinician-approved or system-generated-from-charted-data
  text (`lib/twilio.ts`, `lib/notify-doctor.ts`) — never raw/unreviewed LLM output. Keep that
  boundary if you touch this path.

## Verifying changes

There's no test suite. Verify by:
1. `npx tsc --noEmit` (root) and `cd phone-bridge && npx tsc --noEmit`
2. `npx next build` locally before pushing anything that touches routing, env var access at
   module-load time, or new dependencies — several bugs above only appeared in Vercel's build, not
   `next dev`.
3. Hit the actual route with `curl` against a running `npm run dev` (or the deployed URL for
   anything needing a public webhook, like the Twilio response endpoint) — don't assume a clean
   typecheck means the route works.
