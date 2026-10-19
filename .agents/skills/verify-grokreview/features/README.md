# Feature map

One file per user-facing feature. Each says how a user reaches it, how to drive it with `agent-browser`, and what end state proves it works. When you change a feature, cover every entry point its file lists. When you add or remove a feature, update this map.

| Feature | File | Entry points |
|---|---|---|
| Landing form | [landing-form.md](landing-form.md) | `/` |
| Review stream | [review-stream.md](review-stream.md) | PR page load, Re-run, `POST /api/review` |
| Review panel | [review-panel.md](review-panel.md) | PR page, `section[aria-label^="Grok"]` |
| Diff viewer | [diff-viewer.md](diff-viewer.md) | PR page, Files changed, sidebar file tree |
| Error states | [error-states.md](error-states.md) | bad URL, missing PR, sandbox down |

Not mapped on purpose: the GitHub App webhook (`/api/github/webhook`). It posts real reviews to GitHub. Check agent-side changes with `pnpm review:local <pr-url>` instead (see the README).
