# Error states

What the user sees when a review can't happen: a PR that doesn't exist or isn't reachable, a review that fails mid-stream, a bad request.

## Sub-features

- PR page can't load the PR: centered message from GitHub plus a **Back** link (`page.tsx`)
- Non-numeric or zero PR number: Next 404
- Review fails (sandbox down, Grok error): red text inside the review panel, from an `error` event or a non-200 from `/api/review`
- `/api/review` with a bad body: 400 JSON `{ error }`

## How to get to it (user POV)

Open a PR URL with a typo, or open a PR while the service is broken.

## Driving it with agent-browser

```bash
export AGENT_BROWSER_SESSION=verify-grokreview
agent-browser open http://localhost:3100/vercel/ms/pull/999999
agent-browser get text main             # GitHub's not-found message and "Back"
agent-browser open http://localhost:3100/vercel/ms/pull/abc   # 404 page
curl -s -X POST localhost:3100/api/review -H 'content-type: application/json' -d '{}' -w ' %{http_code}\n'
```

Review failure: stop only the sandbox (`docker compose stop sandbox`), open an **uncached** PR, and expect red error text in `section[aria-label^="Grok"]`. Then run `docker compose start sandbox`. A cached PR never touches the sandbox, so it can't show this.

Proof: a screenshot of each state plus the HTTP status codes.

## Gotchas

- Stopping the sandbox affects anything else using it. Start it again before you finish, and confirm with `doctor.sh`.
- An uncached PR in the failure test still calls GitHub, but it fails before Grok spends any tokens (the sandbox workspace is created before the first model turn).
