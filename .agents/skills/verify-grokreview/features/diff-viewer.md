# Diff viewer

"Files changed": one collapsible card per file with unified or split diffs, Grok's inline comments under their lines, and a sidebar file tree that jumps to a file.

## Sub-features

- Expand and collapse per file (`article button[aria-expanded]`). Files with comments open automatically when the review lands.
- Unified / Split toggle (`[aria-label="Diff layout"]`, `aria-pressed`)
- Sidebar file tree: folders are `<details>`, files are `button[title=<path>]` with a comment count and a status letter. Clicking scrolls to the file and sets `aria-current="true"`.
- Inline comments: severity, `line N`, markdown body, **Resolve**, which collapses it to "Resolved · line N" with a **Show** button
- Suggestion blocks (`suggestion` fences) with a **Copy** button
- "No diff available (binary or generated file)" when GitHub returns no patch

## How to get to it (user POV)

Scroll below the review on a PR page, or click a file in the left sidebar.

## Driving it with agent-browser

Needs a PR whose review has inline comments. `vercel/ms#250` has none; `honojs/hono#5541` does. Review it once, then it's cached.

```bash
export AGENT_BROWSER_SESSION=verify-grokreview
agent-browser open http://localhost:3100/honojs/hono/pull/5541
agent-browser wait 'button[aria-label="Copy review as Markdown"]' --timeout 600000
agent-browser find role button click --name split
agent-browser eval '[...document.querySelectorAll("[aria-label=\"Diff layout\"] button")].map(b=>b.textContent+":"+b.getAttribute("aria-pressed")).join(" ")'
agent-browser click 'aside button[title="<path from the tree>"]'
agent-browser get attr 'aside button[title="<path>"]' aria-current      # "true"
agent-browser find role button click --name Resolve
agent-browser screenshot --full "$RUN/diff-split-resolved.png"
```

Proof: screenshots in both layouts, the `aria-pressed` and `aria-current` values, and a comment before and after Resolve.

## Gotchas

- Resolve state lives in memory only and resets on reload and on Re-run. That's expected.
- With many files open, `--full` screenshots get very tall. Scroll the card into view (`agent-browser scrollintoview 'article:has(button[title])'`) and take a viewport shot instead.
- Comments only show for severities checked in the sidebar Findings filter.
