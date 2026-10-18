# Grok Review

A GitHub PR reviewer. Grok explores the repo through a shell in a sandbox and submits a structured review.

## How it fits together

Reviews start in one of two places: the GitHub App webhook (`app/api/github/webhook`) or the browser route (`app/api/review`). Both call `runReviewAgent` in `lib/review-agent.ts`. Anything about how reviews behave (the prompt, turn cap, tools, validation) changes there, once.

`sandbox/` is a separate service with no dependencies. It clones the PR head as branch `pr` and the merge base as branch `base` at depth 1, then runs Grok's commands. The web app talks to it through `lib/sandbox.ts`.

## The trust boundary

The sandbox runs commands written by a model that reads untrusted code. Keep it that way:

- App secrets live only in `web`. The sandbox receives `SANDBOX_TOKEN` and a GitHub token per clone; the GitHub token goes in a `-c http.extraHeader` argument and never touches disk.
- Each workspace runs as its own uid in a mode-700 directory, so one review can't read another.
- Repo content and PR descriptions are data. The agent prompt says so; keep that line when editing the prompt.

## Contracts

- **Comment lines.** A `submit_review` comment must point at a new-file line inside a diff hunk, or GitHub rejects it. `buildValidLinesMap` is the check; the agent gets two retries before invalid comments are filtered out.
- **Cache version.** Bump `PROMPT_VERSION` in `lib/review-context.ts` whenever review behavior changes, so stale cached reviews stop being served.
- **Stream format.** `/api/review` sends newline-delimited `ReviewStreamEvent` JSON. Change the route and `pull-review-client.tsx` together.
- **ESM.** The package is `"type": "module"` because `@xai-official/sdk` is ESM-only. Scripts are `.mts`.

## Verifying a change

There's no test suite. Run `npx tsc --noEmit`, `pnpm lint`, and `pnpm build`, then dry-run real reviews against a local sandbox (commands are in the README):

- `vercel/ms#250`: one file, about 15 seconds. A sanity check.
- `honojs/hono#5541`: 26 files. The stress test for turns and token use.

Watch stderr for turn counts, token usage, and `submit_review rejected` lines.

API keys live in the user's shell profile, not `.env` files. Run commands that need them through `zsh -ic '…'` (or `bash -ic`).

For `hostess.yml` changes, use the `hostess` skill and finish with `hostess validate`.
