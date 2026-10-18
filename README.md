# Grok Review

**Grok Review** is a Next.js app that turns any public GitHub pull request URL into an AI review workspace.

- URL format: `https://grokreq.com/:owner/:repo/pull/:number`
- Model: `grok-4.5` via the OpenAI JS SDK pointed at `https://api.x.ai/v1`
- Cache: Hostess Postgres (`DATABASE_URL`) keyed by PR head SHA + diff fingerprint
- Hosting: [Hostess](https://hostess.sh) (`hostess.yml`)

## Features in this MVP

- Paste a GitHub PR URL on the landing page to open a review route.
- Fetch PR metadata + changed files directly from the GitHub REST API.
- Build a bounded prompt context for large diffs.
- Stream Grok review output to the browser (Responses API, `stream: true`).
- Cache finished review markdown in Postgres and return cached text on repeated runs.
- Re-run review with a force-refresh button.
- Hostess Next.js insights via `@hostess/nextjs` (`instrumentation.ts`).

## Environment

Create `.env.local` from `.env.example` and set:

- `XAI_API_KEY` — xAI API key
- `DATABASE_URL` — Postgres (optional; cache disabled if unset)
- `GITHUB_TOKEN` — optional but recommended for rate limits
- `GROK_MODEL` — optional (default: `grok-4.5`)
- `GROK_REASONING_EFFORT` — optional; `low` (default), `medium`, or `high`
- `SANDBOX_URL` - review sandbox service
- `SANDBOX_TOKEN` — review sandbox service

## Run locally

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), paste a GitHub PR URL, and start reviewing.

### Review agent

Reviews use a Grok harness with `shell` sandbox tools and a `submit_review` tool.
The sandbox clones the PR with the merge base.

Dry-run a review against any PR without posting to GitHub:

```bash
docker compose up sandbox -d --build
GITHUB_TOKEN=$(gh auth token) pnpm review:local https://github.com/<owner>/<repo>/pull/<n>
```

Shell commands stream to stderr; the final review JSON prints to stdout.

Full stack (app + sandbox + Postgres), with `XAI_API_KEY` exported in your shell:

```bash
docker compose up -d --build
open http://localhost:3000/vercel/ms/pull/250
```

Local Postgres via Compose:

```bash
docker compose up postgres -d
# DATABASE_URL=postgres://postgres:postgres@localhost:5432/grokreview?sslmode=disable
```

## Deploy on Hostess

```bash
hostess login
hostess secrets add XAI_API_KEY --value "$XAI_API_KEY"
hostess secrets add GITHUB_TOKEN --value "$GITHUB_TOKEN"   # optional
hostess secrets add SANDBOX_TOKEN --value "$(openssl rand -hex 32)"
hostess validate
hostess deploy --env production
```

Point `grokreq.com` DNS at Hostess after the first deploy (Studio shows the target records). Remove the domain from Vercel so DNS can cut over cleanly.

## Notes

- The app currently targets public repositories.
- If `DATABASE_URL` is not set, the app still works but cache is disabled.
- If GitHub API rate limits are hit, set `GITHUB_TOKEN`.
- Server instrumentation is a no-op outside Hostess unless `HOSTESS_OTEL_ENDPOINT` / OTEL env is set.
