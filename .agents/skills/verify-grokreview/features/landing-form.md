# Landing form

The home page at `/`: one input for a GitHub PR URL and a Review button. A valid URL navigates to `/<owner>/<repo>/pull/<n>`, and a bad one shows an inline error.

## Sub-features

- Parse and navigate (`lib/github-url.ts`, `parseGitHubPullUrl`)
- Inline error "Enter a valid GitHub pull request URL."

## How to get to it (user POV)

Open the site and paste a PR URL. The other entry point is swapping `github.com` for the host in a PR URL, which skips this form and lands on the PR page directly.

## Driving it with agent-browser

```bash
export AGENT_BROWSER_SESSION=verify-grokreview
agent-browser open http://localhost:3100/
agent-browser fill 'input[placeholder*="github.com"]' https://github.com/vercel/ms/pull/250
agent-browser click 'button[type=submit]'
agent-browser get url        # expect http://localhost:3100/vercel/ms/pull/250
```

Error path: fill `not a url`, submit, and expect `agent-browser get url` still `/` and the text "Enter a valid GitHub pull request URL." on the page.

Proof: the URL after submit, and a screenshot of the PR page header showing the right owner/repo/#n.

## Gotchas

- Submitting a PR that isn't cached starts a paid review the moment the page loads (twice in dev, see SKILL.md). Use a cached PR (`doctor.sh` lists them) unless the review itself is under test.
