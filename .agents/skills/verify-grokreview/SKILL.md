---
name: verify-grokreview
description: Launch Grok Review locally and drive the web UI (landing form, PR review page, /api/review stream) in a real browser to prove a change works, with screenshots as evidence. Use after changing anything under app/, the review route, or the review agent, before calling the work done.
---

# Verify Grok Review

You run the app on a dev server, drive it with the `agent-browser` CLI, and leave screenshots and stream captures in `.verify/runs/`.

**Reviews cost money.** Every uncached review is a real Grok run (`vercel/ms#250` takes about 10 seconds; `honojs/hono#5541` takes about 2 minutes and 200k tokens). Reviews are cached in Postgres per head commit. Run a PR once to fill the cache, then iterate on UI against the cached result, which loads instantly and for free. Only press **Re-run** or review an uncached PR when the change is about the loading state, the stream, or the agent.

## Launch

```bash
.agents/skills/verify-grokreview/scripts/up.sh          # PORT=3200 to pick another port
```

This starts `postgres` and `sandbox` from docker compose, then `next dev -p 3100` through `zsh -ic` so `XAI_API_KEY` and `gh auth token` come from the user's shell. It prints `ready: http://localhost:3100` once the app answers. The server log is `.verify/state/dev.log`.

Port 3100 keeps clear of the compose `app` service on 3000. `up.sh` refuses to start if the port is taken or a previous run is still up.

## Doctor

```bash
.agents/skills/verify-grokreview/scripts/doctor.sh
```

Read-only. Checks the dev server is ours and answering, the sandbox and Postgres are healthy, and the keys are set (it never prints them). It also lists cached reviews, so you can tell which PRs are free to load. Run it first whenever something looks off.

## Drive

Use one named session so you don't touch the user's other browser sessions. Shell state doesn't persist between commands, so export it in every command:

```bash
export AGENT_BROWSER_SESSION=verify-grokreview
agent-browser open http://localhost:3100/vercel/ms/pull/250
agent-browser set viewport 1440 900
agent-browser wait 'button[aria-label="Copy review as Markdown"]' --timeout 240000   # review rendered
agent-browser snapshot -i -c                                                         # refs for clicking
```

Stable handles on the PR page:

| Thing | Selector |
|---|---|
| Review panel | `section[aria-label^="Grok"]` (the label has an apostrophe; match the prefix) |
| Review finished | `button[aria-label="Copy review as Markdown"]` |
| Re-run (starts a paid run) | `agent-browser find role button click --name Re-run --exact` (reads "Reviewing" while loading) |
| Diff layout | `agent-browser find role button click --name split`; state in `[aria-label="Diff layout"] button[aria-pressed]` |
| File header (expand) | `article button[aria-expanded]` |
| File tree entry | `aside button[title="<path>"]`, active one has `aria-current="true"` |
| Severity filters | `aside input[type=checkbox]` next to Critical / High / Medium / Low |
| Inline comment actions | buttons `Resolve`, `Show`, and `Copy` in a suggestion block |

The feature map in [`features/`](features/README.md) has the full recipe per feature. Cover every entry point it lists for the feature you changed.

For the stream itself, capture the raw NDJSON:

```bash
curl -sN -X POST localhost:3100/api/review -H 'content-type: application/json' \
  -d '{"owner":"vercel","repo":"ms","pullNumber":250}' > "$RUN/stream.ndjson"
```

## Evidence

Put each run in its own directory and give screenshots **absolute** paths. A relative path is silently ignored and the file lands in `~/.agent-browser/tmp/screenshots/`.

```bash
RUN="$PWD/.verify/runs/$(date +%Y%m%d-%H%M%S)-<feature>"; mkdir -p "$RUN"
agent-browser screenshot --full "$RUN/01-before.png"
```

A proof:

- starts from the user's entry point (the landing form or a pasted PR URL), not a component rendered on its own;
- captures the state before and after each action, not just the final screen;
- checks the data behind the pixels too: the NDJSON events (agent progress such as `submitted: verdict=…` arrives as `log` events, not in the server log), `POST /api/review` lines in `.verify/state/dev.log`, and the `pr_review_cache` row that `doctor.sh` lists;
- for layout changes, includes a 1440×900 shot and a 390×844 shot;
- ends with `agent-browser errors` coming back empty.

## Cleanup

```bash
.agents/skills/verify-grokreview/scripts/down.sh
```

This closes the browser session, kills the dev server's process group by the PID `up.sh` saved, and stops only the compose services `up.sh` started. It keeps `.verify/runs/` (your evidence) and the Postgres volume (the review cache). Never kill `next` or `node` by name: the user may be running their own dev server.

## Gotchas

- **Dev mode runs every review twice.** React Strict Mode mounts the page's effect twice and the first `/api/review` fetch isn't aborted, so an uncached load starts two Grok runs (two `workspace` lines in the log, two `POST /api/review`). Production builds don't do this. Budget for it, or load the PR once and let the cache absorb the rest.
- **The clipboard is blocked in headless Chrome.** To check a Copy button, spy on the write first, then read what was copied:
  `agent-browser eval 'window.__copied=[];navigator.clipboard.writeText=async t=>{window.__copied.push(t)}'`, click the button, then `agent-browser eval 'window.__copied[0]'`.
- **`agent-browser wait --text` doesn't match `title` or `aria-label`, and `find text` misses the CSS-capitalized `unified`/`split` buttons.** Wait on a selector, and use `find role button --name`.
- The Next dev indicator (the "N" badge, bottom left) shows up in screenshots. Ignore it.
- `vercel/ms#250` produces no inline comments, so it can't prove anything about diff comments. Use `honojs/hono#5541` once for that, then load it from the cache.
