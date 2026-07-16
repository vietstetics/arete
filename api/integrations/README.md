# Phase 2 — Direct cloud integrations (scaffold)

Phase 2 (Oura / WHOOP / Fitbit full OAuth with token custody, webhooks and
server-side sync) is **not implemented**, because it requires a backend this
project does not have yet. This file records the target architecture so Phase 2
can start the moment that backend exists. Nothing here is faked in the UI —
providers without working integrations show as unavailable/coming soon.

## What exists today (precursors)

- `api/oura.js` — CORS pass-through; the user's own personal access token
  travels per-request, never stored server-side. Working.
- `api/whoop/token.js`, `api/strava/token.js` — OAuth code/refresh exchanges
  keeping client secrets in Vercel env vars. Tokens are returned to and stored
  by the CLIENT (localStorage). Working when app credentials are configured.
- Fitbit uses OAuth PKCE entirely client-side (no secret — allowed by Fitbit).

These satisfy "no secrets in frontend JavaScript", but they are NOT Phase 2:
there is no server-side token custody, no webhook receiver, no server sync.

## What Phase 2 requires

A backend with a **database** (e.g. Supabase Postgres, already scaffolded for
auth in js/auth.js) plus a secrets store. Then implement per provider:

```
/api/integrations/{provider}/start        → build authorize URL, save state (+PKCE verifier) server-side
/api/integrations/{provider}/callback     → validate state, exchange code, ENCRYPT + store refresh token
/api/integrations/{provider}/sync         → refresh access token server-side, pull + normalise records
/api/integrations/{provider}/disconnect   → revoke token at provider, delete stored tokens
/api/integrations/{provider}/webhook      → verify signature, enqueue incremental sync
```

Requirements:
- OAuth `state` generated + validated server-side; PKCE where supported
- refresh tokens encrypted at rest (e.g. AES-GCM with a KMS/env key)
- webhook signature verification (each provider documents its scheme)
- revoke on disconnect; delete tokens
- normalise into `HealthRecord` (features/health/types/health.ts) and return
  to the client, which stores locally — cloud storage of health data only if
  the user explicitly opts in
- keep proprietary scores in `ProviderMetric` (same types file) — Oura
  readiness, WHOOP recovery/strain etc. are never interchangeable

## Phase 3 (placeholders shipped)

Garmin (partner program), Polar AccessLink, Withings, Samsung Health direct
SDK — adapters exist in `features/health/providers/cloudAdapters.js` as
explicit "Coming soon". Each needs developer-program approval before any code
can be truthfully enabled.
