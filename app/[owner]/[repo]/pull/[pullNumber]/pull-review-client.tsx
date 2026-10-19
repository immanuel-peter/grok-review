"use client";

import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  renderReviewMarkdown,
  type ReviewStats,
  type ReviewStreamEvent,
  type StructuredFileComment,
  type StructuredReview,
} from "@/lib/structured-review";

import { DiffView, type DiffLayout } from "./diff";
import { FileTree } from "./file-tree";
import {
  Chevron,
  GrokMark,
  SEVERITIES,
  SEVERITY_DOT,
  SEVERITY_LABEL,
  type Severity,
} from "./ui";

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

type ReviewResult = {
  review: StructuredReview;
  stats: ReviewStats | null;
  reviewedAt: string;
};

const VERDICT: Record<StructuredReview["verdict"], { label: string; tone: string; icon: ReactNode }> = {
  request_changes: {
    label: "Changes requested",
    tone: "border-[#ff636940] bg-[#ff63691f] text-[#ff8a8f]",
    icon: <path d="M3 3l6 6M9 3l-6 6" />,
  },
  approve: {
    label: "Approved",
    tone: "border-[#5fd18b40] bg-[#5fd18b1a] text-ok",
    icon: <path d="M2.5 6.5l2.5 2.5 4.5-6" />,
  },
  comment: {
    label: "Commented",
    tone: "border-line-strong bg-raised text-muted",
    icon: <path d="M2.5 3.5h7v4.5H6L3.5 10V8h-1z" />,
  },
};

function basename(path: string) {
  return path.split("/").pop() ?? path;
}

function dirname(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
}

function formatTokens(tokens: number) {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens);
}

function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

function timeAgo(iso: string) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function fileId(filename: string) {
  return `file-${encodeURIComponent(filename)}`;
}

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open>
      <summary className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium tracking-[0.04em] text-subtle uppercase hover:bg-surface-hover">
        <Chevron />
        {title}
      </summary>
      {children}
    </details>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy review as Markdown"
      title="Copy as Markdown"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line-strong text-ink transition-colors hover:bg-raised"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        {copied ? (
          <path d="M3 8.5l3 3 7-7" />
        ) : (
          <>
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 3.5V3A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" />
          </>
        )}
      </svg>
    </button>
  );
}

export function PullReviewClient({
  owner,
  repo,
  pullNumber,
  pullRequest,
  files,
}: PullReviewClientProps) {
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [severities, setSeverities] = useState<Set<Severity>>(new Set(SEVERITIES));
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<DiffLayout>("unified");

  const review = result?.review ?? null;

  const toggleIn = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const runReview = useCallback(
    async (forceRefresh = false) => {
      setError(null);
      setResult(null);
      setLogs([]);
      setResolved(new Set());
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
          else if (event.type === "review") {
            setResult({ review: event.review, stats: event.stats, reviewedAt: event.reviewedAt });
            setExpandedFiles(
              (cur) => new Set([...cur, ...event.review.file_comments.map((c) => c.path)]),
            );
          } else throw new Error(event.message);
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

  const allComments = review?.file_comments ?? [];
  const severityCounts = new Map<Severity, number>();
  const commentCounts = new Map<string, number>();
  const commentsByFile = new Map<string, StructuredFileComment[]>();
  for (const comment of allComments) {
    severityCounts.set(comment.severity, (severityCounts.get(comment.severity) ?? 0) + 1);
    commentCounts.set(comment.path, (commentCounts.get(comment.path) ?? 0) + 1);
    if (!severities.has(comment.severity)) continue;
    commentsByFile.set(comment.path, [...(commentsByFile.get(comment.path) ?? []), comment]);
  }

  const selectFile = (filename: string) => {
    setActiveFile(filename);
    setExpandedFiles((cur) => new Set(cur).add(filename));
    requestAnimationFrame(() =>
      document.getElementById(fileId(filename))?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  const verdict = review ? VERDICT[review.verdict] : null;

  return (
    <main className="min-h-screen bg-canvas text-sm text-ink">
      <header className="sticky top-0 z-10 flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-line bg-canvas/90 px-6 py-2 backdrop-blur">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2.5 text-muted">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-[-0.01em] text-ink hover:text-white">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <circle cx="10" cy="10" r="8" />
              <path d="M6 14 14 6" />
            </svg>
            grok review
          </Link>
          <span className="text-[#3a3a3a]">/</span>
          <span className="truncate">{owner}/{repo}</span>
          <span className="text-[#3a3a3a]">/</span>
          <span className="text-ink">#{pullNumber}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runReview(true)}
            disabled={isLoading}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[13px] text-ink transition-colors hover:bg-raised disabled:opacity-50"
          >
            <svg className={isLoading ? "animate-spin" : ""} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
            </svg>
            {isLoading ? "Reviewing" : "Re-run"}
          </button>
          <a
            href={pullRequest.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3.5 text-[13px] font-medium text-canvas transition-opacity hover:opacity-90"
          >
            Open on GitHub
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M4 2h6v6M10 2 3 9" />
            </svg>
          </a>
        </div>
      </header>

      <div className="flex flex-wrap items-stretch">
        <aside className="flex max-w-full flex-[1_1_260px] flex-col gap-4 border-line px-3 py-6 md:max-w-[320px] md:border-r lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain">
          <SidebarSection title="Files">
            <FileTree
              files={files}
              commentCounts={commentCounts}
              activeFile={activeFile}
              onSelect={selectFile}
            />
          </SidebarSection>

          <SidebarSection title="Findings">
            <div className="flex flex-col gap-0.5 pt-1">
              {SEVERITIES.map((severity) => (
                <label key={severity} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-ink hover:bg-surface-hover">
                  <input
                    type="checkbox"
                    checked={severities.has(severity)}
                    onChange={() => setSeverities((cur) => toggleIn(cur, severity))}
                    className="m-0 accent-ink"
                  />
                  <span className={`h-2 w-2 rounded-[2px] ${SEVERITY_DOT[severity]}`} />
                  <span className="flex-1">{SEVERITY_LABEL[severity]}</span>
                  <span className="text-xs text-subtle">{review ? (severityCounts.get(severity) ?? 0) : "–"}</span>
                </label>
              ))}
            </div>
          </SidebarSection>

          <SidebarSection title="Stats">
            <dl className="m-0 flex flex-col gap-2 pt-2 pr-2 pl-[26px] text-[13px] text-subtle">
              <div className="flex justify-between">
                <dt>Tokens</dt>
                <dd className="m-0 font-mono text-xs text-ink">{result?.stats ? formatTokens(result.stats.tokens) : "–"}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Duration</dt>
                <dd className="m-0 font-mono text-xs text-ink">{result?.stats ? formatDuration(result.stats.durationMs) : "–"}</dd>
              </div>
            </dl>
          </SidebarSection>
        </aside>

        <div className="min-w-0 flex-[999_1_560px] px-4 pt-10 pb-20 md:px-14">
          <div className="flex max-w-[1040px] flex-col gap-8">
            <div className="flex flex-col gap-3.5">
              <h1 className="text-[28px] leading-tight font-medium tracking-[-0.025em]">
                {pullRequest.title}{" "}
                <span className="font-normal text-[#6b6b6b]">#{pullNumber}</span>
              </h1>
              <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-muted">
                <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-line-strong text-[10px] text-ink uppercase">
                  {pullRequest.author.slice(0, 2)}
                </span>
                <span className="text-ink">{pullRequest.author}</span>
                <span>wants to merge</span>
                <code className="rounded-md border border-line-strong bg-raised px-2 py-0.5 font-mono text-xs text-ink">
                  {pullRequest.headRef}
                </code>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#6b6b6b" strokeWidth="1.5" role="img" aria-label="into">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
                <code className="rounded-md border border-line-strong bg-raised px-2 py-0.5 font-mono text-xs text-ink">
                  {pullRequest.baseRef}
                </code>
                <span className="text-[#3a3a3a]">·</span>
                <span>{pullRequest.changedFiles} files</span>
                <span className="font-mono text-ok">+{pullRequest.additions}</span>
                <span className="font-mono text-danger">−{pullRequest.deletions}</span>
              </div>
            </div>

            <section aria-label="Grok's review" className="overflow-hidden rounded-[14px] border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
                <div className="flex items-center gap-3">
                  <GrokMark />
                  <span className="font-medium">Grok</span>
                  {verdict ? (
                    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${verdict.tone}`}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        {verdict.icon}
                      </svg>
                      {verdict.label}
                    </span>
                  ) : isLoading ? (
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line-strong bg-raised px-2.5 text-xs text-muted">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink" />
                      Reviewing
                    </span>
                  ) : null}
                </div>
                {result && (
                  <span className="text-xs text-subtle">
                    Reviewed <span className="font-mono text-muted">{pullRequest.headSha.slice(0, 7)}</span> · {timeAgo(result.reviewedAt)}
                  </span>
                )}
              </div>

              {error && (
                <p className="m-0 px-5 py-4 text-sm text-danger">{error}</p>
              )}

              {isLoading && !review && (
                <div className="px-5 py-4">
                  <p className="m-0 text-muted">Grok is exploring the repo in a sandbox.</p>
                  {logs.length > 0 && (
                    <pre className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[11.5px] leading-5 whitespace-pre-wrap text-subtle">
                      {logs.slice(-40).join("\n")}
                    </pre>
                  )}
                </div>
              )}

              {review && (
                <>
                  <div className="review-markdown px-5 pt-5 pb-1">
                    <ReactMarkdown>{review.overall_review}</ReactMarkdown>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-[18px]">
                    {SEVERITIES.filter((s) => severityCounts.has(s)).map((severity) => (
                      <span key={severity} className="inline-flex h-[26px] items-center gap-1.5 rounded-md bg-raised px-2.5 text-xs text-ink">
                        <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[severity]}`} />
                        {severityCounts.get(severity)} {severity}
                      </span>
                    ))}
                    {allComments.length === 0 && (
                      <span className="text-xs text-subtle">No inline comments</span>
                    )}
                    <span className="flex-1" />
                    <CopyButton text={renderReviewMarkdown(review)} />
                  </div>
                </>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-[15px] font-medium">Files changed</h2>
                <div role="group" aria-label="Diff layout" className="flex rounded-lg border border-line bg-[#111111] p-0.5">
                  {(["unified", "split"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={layout === option}
                      onClick={() => setLayout(option)}
                      className={`h-7 rounded-md px-2.5 text-xs capitalize ${layout === option ? "bg-line-strong text-ink" : "text-subtle hover:text-ink"}`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              {files.map((file) => {
                const isExpanded = expandedFiles.has(file.filename);
                const total = commentCounts.get(file.filename) ?? 0;

                return (
                  <article
                    key={file.filename}
                    id={fileId(file.filename)}
                    className={`scroll-mt-32 overflow-hidden lg:scroll-mt-20 rounded-xl border ${activeFile === file.filename ? "border-line-strong" : "border-line"}`}
                  >
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => setExpandedFiles((cur) => toggleIn(cur, file.filename))}
                      className={`flex w-full items-center gap-3 bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-hover ${isExpanded ? "border-b border-line-soft" : ""}`}
                    >
                      <Chevron className={`text-subtle ${isExpanded ? "rotate-90" : ""}`} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                        <span className="text-faint">{dirname(file.filename)}</span>
                        {basename(file.filename)}
                      </span>
                      {total > 0 && (
                        <span className="text-xs text-muted">
                          {total} {total === 1 ? "comment" : "comments"}
                        </span>
                      )}
                      <span className="font-mono text-xs text-ok">+{file.additions}</span>
                      <span className="font-mono text-xs text-danger">−{file.deletions}</span>
                    </button>

                    {isExpanded &&
                      (file.patch ? (
                        <DiffView
                          patch={file.patch}
                          layout={layout}
                          comments={commentsByFile.get(file.filename) ?? []}
                          resolved={resolved}
                          onToggleResolved={(key) => setResolved((cur) => toggleIn(cur, key))}
                        />
                      ) : (
                        <div className="px-4 py-3 text-xs text-faint">
                          No diff available (binary or generated file)
                        </div>
                      ))}
                  </article>
                );
              })}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
