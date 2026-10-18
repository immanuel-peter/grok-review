import { buildValidLinesMap } from "@/lib/github-app";
import { fetchPullRequestWithFiles } from "@/lib/github";
import { parseGitHubPullUrl } from "@/lib/github-url";
import { runReviewAgent } from "@/lib/review-agent";
import { filterValidFileComments } from "@/lib/structured-review";

const parsed = parseGitHubPullUrl(process.argv[2] ?? "");
if (!parsed) {
  console.error("Usage: pnpm review:local https://github.com/<owner>/<repo>/pull/<number>");
  process.exit(1);
}

const { owner, repo, pullNumber } = parsed;
const { pullRequest, files } = await fetchPullRequestWithFiles(owner, repo, pullNumber);
console.error(`Reviewing ${owner}/${repo}#${pullNumber}: ${pullRequest.title} (${files.length} files)`);

const startedAt = Date.now();
const review = await runReviewAgent({
  owner,
  repo,
  pullRequest,
  files,
  githubToken: process.env.GITHUB_TOKEN?.trim() || undefined,
  log: (message) => console.error(`  ${message}`),
});

const postable = filterValidFileComments(
  review.file_comments,
  buildValidLinesMap(files),
  new Set(files.map((f) => f.filename)),
);

console.error(
  `Done in ${Math.round((Date.now() - startedAt) / 1000)}s: verdict=${review.verdict}, ${postable.length}/${review.file_comments.length} comments postable`,
);
console.log(JSON.stringify({ ...review, file_comments: postable }, null, 2));
