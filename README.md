# Grok Review

**Grok Review** is a Next.js app that turns any public GitHub pull request URL into an AI review workspace.

- URL format: `https://grokreq.com/:owner/:repo/pull/:number`
- Model: `xai/grok-4-1-fast-reasoning` (via Vercel AI SDK gateway)
- Cache: Neon Postgres (`DATABASE_URL`) keyed by PR head SHA + diff fingerprint

## Features in this MVP

- Paste a GitHub PR URL on the landing page to open a review route.
- Fetch PR metadata + changed files directly from the GitHub REST API.
- Build a bounded prompt context for large diffs.
- Stream Grok review output to the browser using `streamText`.
- Cache finished review markdown in Neon and return cached text on repeated runs.
- Re-run review with a force-refresh button.

## Environment

Create `.env.local` from `.env.example` and set:

- `AI_GATEWAY_API_KEY`
- `DATABASE_URL`
- `GITHUB_TOKEN` (optional but recommended for rate limits)
- Install `postgres` in your environment to enable Neon cache writes:
  - `pnpm add postgres`

## Run

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), paste a GitHub PR URL, and start reviewing.

## Notes

- The app currently targets public repositories.
- If `DATABASE_URL` is not set, the app still works but cache is disabled.
- If GitHub API rate limits are hit, set `GITHUB_TOKEN`.
