import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchPullRequestWithFiles } from "@/lib/github";
import { PullReviewClient } from "./pull-review-client";

type PullReviewPageProps = {
  params: Promise<{
    owner: string;
    repo: string;
    pullNumber: string;
  }>;
};

export default async function PullReviewPage({ params }: PullReviewPageProps) {
  const resolvedParams = await params;
  const pullNumber = Number.parseInt(resolvedParams.pullNumber, 10);

  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    notFound();
  }

  let pullData: Awaited<
    ReturnType<typeof fetchPullRequestWithFiles>
  > | null = null;
  let pullLoadError = "The GitHub request failed.";

  try {
    pullData = await fetchPullRequestWithFiles(
      resolvedParams.owner,
      resolvedParams.repo,
      pullNumber,
    );
  } catch (error) {
    pullLoadError = error instanceof Error ? error.message : pullLoadError;
  }

  if (!pullData) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md text-center">
          <p className="text-sm text-muted">{pullLoadError}</p>
          <Link
            href="/"
            className="mt-4 inline-block text-sm text-ink underline underline-offset-4"
          >
            Back
          </Link>
        </div>
      </main>
    );
  }

  const { pullRequest, files } = pullData;

  return (
    <PullReviewClient
      owner={resolvedParams.owner}
      repo={resolvedParams.repo}
      pullNumber={pullNumber}
      pullRequest={{
        title: pullRequest.title,
        body: pullRequest.body,
        htmlUrl: pullRequest.html_url,
        author: pullRequest.user.login,
        headSha: pullRequest.head.sha,
        baseRef: pullRequest.base.ref,
        headRef: pullRequest.head.ref,
        additions: pullRequest.additions,
        deletions: pullRequest.deletions,
        changedFiles: pullRequest.changed_files,
      }}
      files={files.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch ?? null,
      }))}
    />
  );
}
