# Grok Review

Grok reviews your pull requests. It reads the diff, digs through the repo in a sandbox to check its hunches, and posts a GitHub review with inline comments.

## Using it

**GitHub App.** Install the app on a repo. Grok reviews a PR when it's opened, reopened, marked ready for review, or pushed to. Drafts are skipped.

**Web.** Swap `github.com` for `grokreq.com` in any PR URL, e.g. `grokreq.com/honojs/hono/pull/5541`. You watch Grok's commands live, then get the review next to the diff. Results are cached per head commit; **Re-run** forces a fresh one.

## How a review works

```
webhook / browser ──▶ review agent (Grok) ──shell──▶ sandbox: PR head + merge base
                              │
                              └──submit_review──▶ GitHub review / web page
```

Grok starts with the PR description and the list of changed files, not the patches. From there it explores on its own: `git diff base HEAD -- <file>`, `rg`, reading callers and types. It finishes by calling `submit_review`. Comments that don't land on a diff line go back to Grok to fix.

Reasoning effort defaults to `low`. On a 26-file PR it found the same blocking bug as `medium` and `high` for under a fifth of the tokens. Reviews stop at 30 turns.

## Running locally

API keys come from your shell. Export `XAI_API_KEY`, and optionally `GITHUB_TOKEN=$(gh auth token)`.

```bash
# Dry run: review any PR without posting. Commands stream to stderr, review JSON to stdout.
docker compose up sandbox -d --build
SANDBOX_URL=http://localhost:8080 SANDBOX_TOKEN=dev-sandbox-token \
  pnpm review:local https://github.com/vercel/ms/pull/250

# Full stack: app + sandbox + Postgres on :3000
docker compose up -d --build
```

## Configuration

| Variable | Purpose |
|---|---|
| `XAI_API_KEY` | xAI API key (required) |
| `GROK_MODEL` | Default `grok-4.5` |
| `GROK_REASONING_EFFORT` | `low` (default), `medium`, `high` |
| `SANDBOX_URL`, `SANDBOX_TOKEN` | Where the sandbox lives and the shared token for calling it |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | GitHub App |
| `GITHUB_TOKEN` | Higher rate limits for the web route |
| `DATABASE_URL` | Review cache; caching is off without it |

## Deploying

The app runs on [Hostess](https://hostess.sh): `web`, `sandbox`, and Postgres, all in `hostess.yml`.

```bash
hostess secrets add XAI_API_KEY --value "$XAI_API_KEY"
hostess secrets add SANDBOX_TOKEN --value "$(openssl rand -hex 32)"
# plus the three GITHUB_APP_* secrets
hostess deploy --env production
```

## About the sandbox

The sandbox holds no app secrets. Each review gets its own Unix user and workspace, deleted when the review ends. Know its limits:

- It has internet access, since it needs it to clone. A prompt injection in a PR could try to send that repo's code somewhere.
- It can run code. Grok sometimes runs `node -e` to test a claim.
- It's Alpine, so the shell tools are BusyBox versions, not GNU.
