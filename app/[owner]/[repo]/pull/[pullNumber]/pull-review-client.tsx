"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { useCallback, useEffect, useState } from "react";

import type {
  ReviewStreamEvent,
  StructuredFileComment,
  StructuredReview,
} from "@/lib/structured-review";

type FileData = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
};

type PullReviewClientProps = {
  owner: string;
  repo: string;
  pullNumber: number;
  pullRequest: {
    title: string;
    body: string | null;
    htmlUrl: string;
    author: string;
    headSha: string;
    baseRef: string;
    headRef: string;
    additions: number;
    deletions: number;
    changedFiles: number;
  };
  files: FileData[];
};

function statusBadge(status: string) {
  switch (status) {
    case "added":
      return <span className="rounded-sm bg-ok/15 px-1.5 py-0.5 text-[11px] text-ok">added</span>;
    case "removed":
      return <span className="rounded-sm bg-danger/15 px-1.5 py-0.5 text-[11px] text-danger">removed</span>;
    case "renamed":
      return <span className="rounded-sm bg-warn/15 px-1.5 py-0.5 text-[11px] text-warn">renamed</span>;
    default:
      return <span className="rounded-sm bg-[--line]/60 px-1.5 py-0.5 text-[11px] text-muted">modified</span>;
  }
}

function DiffView({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  return (
    <div className="overflow-x-auto border-t border-[--line]">
      {lines.map((line, i) => {
        let cls = "diff-line diff-line-context";
        if (line.startsWith("@@")) cls = "diff-line diff-line-hunk";
        else if (line.startsWith("+")) cls = "diff-line diff-line-add";
        else if (line.startsWith("-")) cls = "diff-line diff-line-del";

        return (
          <div key={i} className={cls}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

function basename(path: string) {
  return path.split("/").pop() ?? path;
}

function dirname(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
}

export function PullReviewClient({
  owner,
  repo,
  pullNumber,
  pullRequest,
  files,
}: PullReviewClientProps) {
  const [review, setReview] = useState<StructuredReview | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleFile = (filename: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const expandAll = () =>
    setExpandedFiles(new Set(files.map((f) => f.filename)));
  const collapseAll = () => setExpandedFiles(new Set());

  const runReview = useCallback(
    async (forceRefresh = false) => {
      setError(null);
      setReview(null);
      setLogs([]);
      setIsLoading(true);

      try {
        const response = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner, repo, pullNumber, forceRefresh }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(payload?.error || "Review request failed.");
        }

        if (!response.body) {
          throw new Error("No response stream.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";

        const handleLine = (line: string) => {
          if (!line.trim()) return;
          const event = JSON.parse(line) as ReviewStreamEvent;
          if (event.type === "log") setLogs((cur) => [...cur, event.message]);
          else if (event.type === "review") setReview(event.review);
          else throw new Error(event.message);
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          const lines = buffered.split("\n");
          buffered = lines.pop() ?? "";
          lines.forEach(handleLine);
        }
        handleLine(buffered + decoder.decode());
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Review request failed.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [owner, pullNumber, repo],
  );

  useEffect(() => {
    void runReview(false);
  }, [runReview]);

  const summary = review
    ? `**Verdict:** ${review.verdict}\n\n${review.overall_review}`
    : "";

  const commentsByFile = new Map<string, StructuredFileComment[]>();
  for (const comment of review?.file_comments ?? []) {
    commentsByFile.set(comment.path, [
      ...(commentsByFile.get(comment.path) ?? []),
      comment,
    ]);
  }

  return (
    <main className="min-h-screen bg-[--canvas-0]">
      {/* ── Header ── */}
      <header className="border-b border-[--line] px-4 py-3 md:px-6">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-2 text-sm text-muted">
            <Link href="/" className="font-mono text-faint hover:text-ink">
              grokreq
            </Link>
            <span className="text-faint">/</span>
            <span>
              {owner}/{repo}
            </span>
            <span className="text-faint">#{pullNumber}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
        {/* ── PR Title ── */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              {pullRequest.title}
              <span className="ml-2 font-normal text-muted">
                #{pullNumber}
              </span>
            </h1>
            <p className="mt-1 text-sm text-muted">
              <span className="text-ink">{pullRequest.author}</span> wants to
              merge into{" "}
              <code className="rounded bg-[--canvas-2] px-1.5 py-0.5 font-mono text-xs text-ink">
                {pullRequest.baseRef}
              </code>{" "}
              from{" "}
              <code className="rounded bg-[--canvas-2] px-1.5 py-0.5 font-mono text-xs text-ink">
                {pullRequest.headRef}
              </code>
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void runReview(true)}
              disabled={isLoading}
              className="h-8 rounded-md border border-[--line] bg-[--surface] px-3 text-xs text-muted transition-colors hover:border-[--line-strong] hover:text-ink disabled:opacity-50"
            >
              {isLoading ? "Reviewing..." : "Re-run"}
            </button>
            <Link
              href={pullRequest.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-8 items-center rounded-md border border-[--line] bg-[--surface] px-3 text-xs text-muted transition-colors hover:border-[--line-strong] hover:text-ink"
            >
              GitHub
            </Link>
          </div>
        </div>

        {/* ── Stats bar ── */}
        <div className="mt-4 flex items-center gap-3 text-xs text-muted">
          <span>{pullRequest.changedFiles} files</span>
          <span className="text-ok">+{pullRequest.additions}</span>
          <span className="text-danger">-{pullRequest.deletions}</span>
          <span className="text-faint">
            {pullRequest.headSha.slice(0, 7)}
          </span>
        </div>

        <div className="mt-6 border-t border-[--line]" />

        {/* ── Review summary ── */}
        {error && (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {isLoading && !review && (
          <div className="mt-6">
            <p className="text-sm text-muted">
              Grok is exploring the repo
              <span className="animate-pulse">...</span>
            </p>
            {logs.length > 0 && (
              <pre className="mt-3 max-h-64 overflow-y-auto rounded-md border border-[--line] bg-[--canvas-2] px-3 py-2 font-mono text-[11px] text-muted">
                {logs.slice(-40).join("\n")}
              </pre>
            )}
          </div>
        )}

        {summary && (
          <div className="mt-6 rounded-md border border-[--line] bg-[--surface]">
            <div className="border-b border-[--line] px-4 py-2">
              <span className="text-xs font-medium text-muted">
                Grok Review
              </span>
            </div>
            <div className="review-markdown px-4 py-4">
              <ReactMarkdown>{summary}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* ── Files with diffs ── */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink">
              Files changed{" "}
              <span className="text-muted">({files.length})</span>
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={expandAll}
                className="text-xs text-muted hover:text-ink"
              >
                Expand all
              </button>
              <button
                type="button"
                onClick={collapseAll}
                className="text-xs text-muted hover:text-ink"
              >
                Collapse all
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {files.map((file) => {
              const isExpanded = expandedFiles.has(file.filename);
              const comments = commentsByFile.get(file.filename);

              return (
                <div
                  key={file.filename}
                  className="overflow-hidden rounded-md border border-[--line]"
                >
                  {/* File header */}
                  <button
                    type="button"
                    onClick={() => toggleFile(file.filename)}
                    className="flex w-full items-center gap-3 bg-[--surface] px-4 py-2 text-left transition-colors hover:bg-[--surface-hover]"
                  >
                    <span className="text-xs text-faint">
                      {isExpanded ? "▾" : "▸"}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">
                      <span className="text-muted">{dirname(file.filename)}</span>
                      {basename(file.filename)}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {statusBadge(file.status)}
                      <span className="font-mono text-[11px] text-ok">
                        +{file.additions}
                      </span>
                      <span className="font-mono text-[11px] text-danger">
                        -{file.deletions}
                      </span>
                      {comments && (
                        <span className="h-2 w-2 rounded-full bg-ink" title="Has review comments" />
                      )}
                    </span>
                  </button>

                  {/* Expanded: diff + comment */}
                  {isExpanded && (
                    <>
                      {file.patch ? (
                        <DiffView patch={file.patch} />
                      ) : (
                        <div className="border-t border-[--line] px-4 py-3 text-xs text-faint">
                          No diff available (binary or generated file)
                        </div>
                      )}

                      {comments?.map((comment) => (
                        <div
                          key={`${comment.line}:${comment.body.slice(0, 40)}`}
                          className="border-t border-[--line] bg-[--canvas-2] px-4 py-3"
                        >
                          <div className="mb-1 text-[11px] font-medium text-muted">
                            Line {comment.line} · {comment.severity}
                          </div>
                          <div className="review-markdown text-sm">
                            <ReactMarkdown>{comment.body}</ReactMarkdown>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
