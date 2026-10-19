# Review stream

What the user sees while Grok works: a "Reviewing" badge, "Grok is exploring the repo in a sandbox.", and the last 40 sandbox commands. Then the review renders. Behind it, `POST /api/review` streams newline-delimited `ReviewStreamEvent` JSON: `log` events, then one `review` event (with `cached`, `stats`, `reviewedAt`) or one `error` event.

## Sub-features

- Live command log while loading
- Cache hit: a single `review` event with `cached: true`, no logs
- Re-run: `forceRefresh: true`, which bypasses and then overwrites the cache
- Stats in the sidebar (Tokens, Duration), "Reviewed <sha> · <time ago>" in the panel header

## How to get to it (user POV)

Load any PR page. An uncached PR streams; a cached one renders at once. **Re-run** in the header forces a fresh stream.

## Driving it with agent-browser

Uncached run (costs a review):

```bash
export AGENT_BROWSER_SESSION=verify-grokreview
agent-browser open http://localhost:3100/vercel/ms/pull/250
agent-browser find role button click --name Re-run --exact
agent-browser wait 3000 && agent-browser screenshot "$RUN/01-loading.png"
agent-browser get text 'section[aria-label^="Grok"]'      # contains "$ git ..." command lines
agent-browser wait 'button[aria-label="Copy review as Markdown"]' --timeout 240000
agent-browser screenshot --full "$RUN/02-done.png"
```

Raw stream, cached (free):

```bash
curl -sN -X POST localhost:3100/api/review -H 'content-type: application/json' \
  -d '{"owner":"vercel","repo":"ms","pullNumber":250}' > "$RUN/stream.ndjson"
```

Proof: the loading screenshot with log lines, the done screenshot, and the event types in the NDJSON (`log`… then `review`). For an uncached run, the last `log` event is `submitted: verdict=…` (the web route sends agent logs only to the stream, not to `dev.log`), and `doctor.sh` shows a new `updated_at` on the `pr_review_cache` row.

## Gotchas

- In dev an uncached page load fires two reviews (Strict Mode). Re-run is a click, so it fires only one.
- `vercel/ms#250` finishes in about 10 seconds, so take the loading screenshot within about 3 seconds of the click.
- If you change the event shape, change `app/api/review/route.ts` and `pull-review-client.tsx` together (see AGENTS.md).
