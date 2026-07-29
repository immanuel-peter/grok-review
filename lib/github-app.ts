import { createHmac, timingSafeEqual } from "node:crypto";
import { App } from "@octokit/app";
import { Octokit } from "octokit";

import type { GitHubPullRequest, GitHubPullRequestFile } from "@/lib/github";

const MAX_FILES = 500;

function normalizePrivateKey(key: string): string {
  let normalized = key.trim();
  // Handle when secret was stored with escaped newlines (\\n) or quoted
  if (normalized.includes("\\n")) {
    normalized = normalized.replace(/\\n/g, "\n");
  }
  // Remove surrounding quotes if present
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }
  // Final unescape again after quote removal
  if (normalized.includes("\\n")) {
    normalized = normalized.replace(/\\n/g, "\n");
  }
  return normalized;
}

function getEnv(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

let cachedApp: App | null = null;

export function getGithubApp(): App {
  if (cachedApp) return cachedApp;

  const appId = getEnv("GITHUB_APP_ID");
  const rawPrivateKey = getEnv("GITHUB_APP_PRIVATE_KEY");
  const webhookSecret = getEnv("GITHUB_WEBHOOK_SECRET");

  if (!appId) throw new Error("GITHUB_APP_ID is not set");
  if (!rawPrivateKey) throw new Error("GITHUB_APP_PRIVATE_KEY is not set");
  if (!webhookSecret) throw new Error("GITHUB_WEBHOOK_SECRET is not set");

  cachedApp = new App({
    appId,
    privateKey: normalizePrivateKey(rawPrivateKey),
    webhooks: { secret: webhookSecret },
    Octokit,
  });
  return cachedApp;
}

export async function getInstallationOctokit(
  installationId: number,
): Promise<Octokit> {
  const app = getGithubApp();
  // The App's Octokit now has rest.pulls and paginate because we passed Octokit from "octokit"
  return (await app.getInstallationOctokit(installationId)) as unknown as Octokit;
}

export function verifyWebhookSignature(
  payloadBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  // signatureHeader = "sha256=<hex>"
  const expected = `sha256=${createHmac("sha256", secret).update(payloadBody).digest("hex")}`;

  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function getWebhookSecret(): string {
  const s = getEnv("GITHUB_WEBHOOK_SECRET");
  if (!s) throw new Error("GITHUB_WEBHOOK_SECRET is not set");
  return s;
}

// Fetch PR + files using installation octokit (works for private repos)
export async function fetchPullRequestWithFilesViaOctokit(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<{ pullRequest: GitHubPullRequest; files: GitHubPullRequestFile[] }> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  const pullRequest = {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    html_url: pr.html_url,
    state: pr.state,
    draft: pr.draft ?? false,
    user: { login: pr.user?.login ?? "unknown" },
    head: { sha: pr.head.sha, ref: pr.head.ref },
    base: { ref: pr.base.ref },
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changed_files: pr.changed_files ?? 0,
  } satisfies GitHubPullRequest;

  // Paginate files
  const files: GitHubPullRequestFile[] = [];
  const iterator = octokit.paginate.iterator(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  for await (const { data } of iterator) {
    for (const f of data) {
      files.push({
        sha: f.sha ?? "",
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch,
      });
      if (files.length >= MAX_FILES) break;
    }
    if (files.length >= MAX_FILES) break;
  }

  return { pullRequest, files };
}

export type ValidLineMap = Map<string, Set<number>>;

/**
 * Build a map of filename -> set of valid new-file line numbers that appear in the diff.
 * GitHub's review API only accepts comments on lines that are part of the diff.
 * We parse patches to compute which new-file lines are present.
 */
export function buildValidLinesMap(
  files: GitHubPullRequestFile[],
): ValidLineMap {
  const map: ValidLineMap = new Map();

  for (const file of files) {
    if (!file.patch) continue;
    const validLines = new Set<number>();
    const lines = file.patch.split("\n");

    let newLineNumber = 0;

    for (const line of lines) {
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        newLineNumber = parseInt(hunkMatch[1], 10);
        continue;
      }

      if (line.startsWith(" ") || line.startsWith("+")) {
        // Context or addition -> exists in new file
        validLines.add(newLineNumber);
        newLineNumber++;
      } else if (line.startsWith("-")) {
        // Deletion -> only in old file, don't increment new line
      } else if (line.startsWith("\\")) {
        // "\ No newline at end of file" - ignore
      } else {
        // Other cases (shouldn't happen after first hunk, except maybe empty)
        // Don't increment
      }
    }

    if (validLines.size > 0) {
      map.set(file.filename, validLines);
    }
  }

  return map;
}
