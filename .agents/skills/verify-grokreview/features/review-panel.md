# Review panel

The "Grok's review" card on the PR page: the verdict pill (Approved / Changes requested / Commented), the overall review markdown (Summary, Blocking Issues, Suggested Tests), severity chips, and a Copy as Markdown button. The sidebar's Findings filters and Stats belong to it too.

## Sub-features

- Verdict pill and "Reviewed <sha> · <time ago>"
- Overall review rendered by `ReactMarkdown` inside `.review-markdown`
- Severity chips, or "No inline comments"
- Copy as Markdown (`renderReviewMarkdown`)
- Sidebar Findings checkboxes (Critical / High / Medium / Low, with counts) and Stats (Tokens, Duration)

## How to get to it (user POV)

Open a PR page and wait for the review. It sits under the PR title.

## Driving it with agent-browser

```bash
export AGENT_BROWSER_SESSION=verify-grokreview
agent-browser open http://localhost:3100/vercel/ms/pull/250
agent-browser set viewport 1440 900
agent-browser wait 'button[aria-label="Copy review as Markdown"]' --timeout 240000
agent-browser get text 'section[aria-label^="Grok"]'
agent-browser screenshot --full "$RUN/review-wide.png"
agent-browser eval 'window.__copied=[];navigator.clipboard.writeText=async t=>{window.__copied.push(t)}'
agent-browser click 'button[aria-label="Copy review as Markdown"]'
agent-browser eval 'window.__copied[0]'                   # starts with **Verdict:**
agent-browser set viewport 390 844 && agent-browser screenshot --full "$RUN/review-narrow.png"
```

Severity filter (needs a PR with comments): uncheck one in `aside` with `agent-browser find label High click` and confirm the inline comments of that severity disappear from the diffs while the chip counts stay.

Proof: wide and narrow screenshots, the panel text, and the copied markdown matching the panel.

## Gotchas

- The clipboard is blocked in headless Chrome. Spy on the write as above; reading the clipboard fails.
- The panel's `aria-label` is `Grok's review`. In shell commands match it with `^="Grok"` to avoid quoting the apostrophe.
