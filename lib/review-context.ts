import { createHash } from "node:crypto";
import type { GitHubPullRequest, GitHubPullRequestFile } from "@/lib/github";

const PROMPT_VERSION = "v2-agent";

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildReviewCacheKey({
  owner,
  repo,
  pullRequest,
  files,
  model,
}: {
  owner: string;
  repo: string;
  pullRequest: GitHubPullRequest;
  files: GitHubPullRequestFile[];
  model: string;
}): string {
  const sortedFingerprint = files
    .map((file) => {
      const patchHash = hashText(file.patch ?? "").slice(0, 12);
      return `${file.filename}:${file.status}:${file.changes}:${patchHash}`;
    })
    .sort()
    .join("|");

  const diffFingerprint = hashText(sortedFingerprint).slice(0, 20);

  return [
    "pr-review",
    PROMPT_VERSION,
    owner,
    repo,
    String(pullRequest.number),
    pullRequest.head.sha,
    model,
    diffFingerprint,
  ].join(":");
}

export function computePromptHash(prompt: string): string {
  return hashText(prompt);
}
