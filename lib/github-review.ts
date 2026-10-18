import type { Octokit } from "octokit";

import {
  buildValidLinesMap,
  type ValidLineMap,
} from "@/lib/github-app";
import { runReviewAgent } from "@/lib/review-agent";
import {
  filterValidFileComments,
  getReviewEventFromVerdict,
  type StructuredReview,
} from "@/lib/structured-review";
import type { GitHubPullRequestFile } from "@/lib/github";

export type PostReviewArgs = {
  octokit: Octokit;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  files: GitHubPullRequestFile[];
  githubToken: string;
  structuredReview?: StructuredReview; // if already generated
};

export type PostReviewResult = {
  reviewId: number;
  htmlUrl: string;
  verdict: StructuredReview["verdict"];
  fileCommentsPosted: number;
};

export async function generateAndPostReview(
  args: PostReviewArgs & {
    owner: string;
    repo: string;
    pullRequest: {
      number: number;
      title: string;
      body: string | null;
      html_url: string;
      state: string;
      draft: boolean;
      user: { login: string };
      head: { sha: string; ref: string };
      base: { ref: string; sha: string };
      additions: number;
      deletions: number;
      changed_files: number;
    };
  },
): Promise<PostReviewResult> {
  const {
    octokit,
    owner,
    repo,
    pullNumber,
    headSha,
    files,
    githubToken,
    pullRequest,
  } = args;

  let review = args.structuredReview;
  if (!review) {
    review = await runReviewAgent({
      owner,
      repo,
      pullRequest,
      files,
      githubToken,
      log: (message) => console.log(`[agent ${owner}/${repo}#${pullNumber}] ${message}`),
    });
  }

  const validLinesMap: ValidLineMap = buildValidLinesMap(files);
  const knownFiles = new Set(files.map((f) => f.filename));

  const validComments = filterValidFileComments(
    review.file_comments,
    validLinesMap,
    knownFiles,
  );

  console.log(
    `Posting review for ${owner}/${repo}#${pullNumber} — verdict=${review.verdict}, ${validComments.length}/${review.file_comments.length} file comments valid`,
  );

  // Deduplicate previous bot reviews by searching for our marker?
  // For MVP we just create a new review; GitHub UI collapses outdated ones.

  const event = getReviewEventFromVerdict(review.verdict);

  // GitHub requires at least body or comments. If we have file comments but empty overall, synthesize.
  const body = review.overall_review?.trim() || 
    (validComments.length > 0 
      ? `Grok reviewed ${files.length} files, found ${validComments.length} issues. See inline comments.` 
      : "LGTM - no blocking issues found.");

  const bodyWithFooter = `${body}\n\n---\n*Reviewed by Grok • model: ${process.env.GROK_MODEL || "grok-4.5"} • sha: ${headSha.slice(0, 7)}*`;

  try {
    const { data } = await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: headSha,
      event: event as "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
      body: bodyWithFooter,
      comments: validComments.map((c) => ({
        path: c.path,
        line: c.line,
        side: "RIGHT" as const,
        body: `**${c.severity.toUpperCase()}** - ${c.body}`,
      })),
    });

    return {
      reviewId: data.id,
      htmlUrl: data.html_url,
      verdict: review.verdict,
      fileCommentsPosted: validComments.length,
    };
  } catch (err: unknown) {
    // Fallback: if posting inline comments failed (invalid lines), try without inline comments
    const isLineError = err instanceof Error && /line/i.test(err.message);
    if (isLineError && validComments.length > 0) {
      console.warn("File comments failed, retrying with overall comment only", err);
      const { data } = await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: headSha,
        event: "COMMENT",
        body: `${bodyWithFooter}\n\n<details><summary>Inline comments that failed to post</summary>\n\n${validComments.map(c => `- **${c.path}:${c.line}** (${c.severity}): ${c.body}`).join("\n")}\n\n</details>`,
      });
      return {
        reviewId: data.id,
        htmlUrl: data.html_url,
        verdict: review.verdict,
        fileCommentsPosted: 0,
      };
    }
    throw err;
  }
}

/**
 * Optionally post a failure comment when Grok itself fails, so developer sees feedback.
 */
export async function postFailureComment({
  octokit,
  owner,
  repo,
  pullNumber,
  headSha,
  error,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  error: unknown;
}): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: headSha,
      event: "COMMENT",
      body: `⚠️ Grok Review failed to generate:\n\`\`\`\n${message.slice(0, 2000)}\n\`\`\`\n\nCheck logs / XAI_API_KEY / model availability.`,
    });
  } catch (e) {
    console.error("Failed to post failure comment", e);
  }
}
