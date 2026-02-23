import { createHash } from "node:crypto";
import type { GitHubPullRequest, GitHubPullRequestFile } from "@/lib/github";

const PROMPT_VERSION = "v1";
const MAX_FILES_FOR_PROMPT = 80;
const MAX_PATCH_CHARS_PER_FILE = 3200;
const MAX_TOTAL_PATCH_CHARS = 90000;

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clampPatch(patch: string, maxChars: number): string {
  if (patch.length <= maxChars) {
    return patch;
  }

  const half = Math.floor((maxChars - 80) / 2);
  const omitted = patch.length - half * 2;

  return `${patch.slice(0, half)}\n... [${omitted} chars omitted] ...\n${patch.slice(-half)}`;
}

function renderFileContext(file: GitHubPullRequestFile): string {
  const patch = file.patch?.trim();
  const patchSection = patch
    ? `\nPatch:\n${clampPatch(patch, MAX_PATCH_CHARS_PER_FILE)}`
    : "\nPatch: <omitted by GitHub or binary/generated file>";

  return [
    `File: ${file.filename}`,
    `Status: ${file.status}`,
    `Changes: +${file.additions} / -${file.deletions} (${file.changes} total)`,
    patchSection,
  ].join("\n");
}

export function buildReviewPrompt({
  owner,
  repo,
  pullRequest,
  files,
}: {
  owner: string;
  repo: string;
  pullRequest: GitHubPullRequest;
  files: GitHubPullRequestFile[];
}): string {
  const fileContexts: string[] = [];
  let totalPatchChars = 0;

  for (const file of files.slice(0, MAX_FILES_FOR_PROMPT)) {
    const patchChars = file.patch?.length ?? 0;
    if (totalPatchChars + patchChars > MAX_TOTAL_PATCH_CHARS) {
      break;
    }

    fileContexts.push(renderFileContext(file));
    totalPatchChars += patchChars;
  }

  return [
    `Repository: ${owner}/${repo}`,
    `PR #${pullRequest.number}: ${pullRequest.title}`,
    `Author: ${pullRequest.user.login}`,
    `Base -> Head: ${pullRequest.base.ref} -> ${pullRequest.head.ref}`,
    `Stats: ${pullRequest.changed_files} changed files, +${pullRequest.additions}, -${pullRequest.deletions}`,
    "",
    "PR Description:",
    pullRequest.body?.trim() || "<no description>",
    "",
    "You are reviewing this pull request as a senior engineer.",
    "Focus on correctness, regressions, security, performance, and test coverage.",
    "Prioritize actionable comments over broad praise.",
    "",
    "Respond in markdown with the following sections and order:",
    "## Verdict",
    "## Meta Comment",
    "## Blocking Issues",
    "## File-Scoped Comments",
    "## Suggested Tests",
    "",
    "In File-Scoped Comments, list each issue with:",
    "- file path",
    "- line reference if inferable",
    "- severity (critical/high/medium/low)",
    "- issue explanation",
    "- concrete fix",
    "",
    "Changed file contexts:",
    fileContexts.join("\n\n---\n\n"),
  ].join("\n");
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
