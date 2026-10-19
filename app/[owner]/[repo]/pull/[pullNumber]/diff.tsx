import ReactMarkdown, { type Components } from "react-markdown";
import { Fragment, useState, type ReactNode } from "react";

import type { StructuredFileComment } from "@/lib/structured-review";

import { GrokMark, SEVERITY_DOT, SEVERITY_LABEL, SEVERITY_TEXT } from "./ui";

type DiffRow =
  | { kind: "hunk"; text: string }
  | { kind: "context"; oldLine: number; newLine: number; text: string }
  | { kind: "add"; newLine: number; text: string }
  | { kind: "del"; oldLine: number; text: string };

type Side = { line: number; text: string; kind: "context" | "add" | "del" };

type SplitRow =
  | { kind: "hunk"; text: string }
  | { kind: "pair"; left?: Side; right?: Side };

export type DiffLayout = "unified" | "split";

export function parsePatch(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      oldLine = match ? Number(match[1]) : 0;
      newLine = match ? Number(match[2]) : 0;
      rows.push({ kind: "hunk", text: line });
    } else if (line.startsWith("+")) {
      rows.push({ kind: "add", newLine: newLine++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", oldLine: oldLine++, text: line.slice(1) });
    } else if (!line.startsWith("\\")) {
      rows.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text: line.slice(1) });
    }
  }
  return rows;
}

function toSplitRows(rows: DiffRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let dels: Side[] = [];
  let adds: Side[] = [];

  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) {
      out.push({ kind: "pair", left: dels[i], right: adds[i] });
    }
    dels = [];
    adds = [];
  };

  for (const row of rows) {
    if (row.kind === "del") {
      dels.push({ line: row.oldLine, text: row.text, kind: "del" });
    } else if (row.kind === "add") {
      adds.push({ line: row.newLine, text: row.text, kind: "add" });
    } else {
      flush();
      out.push(
        row.kind === "hunk"
          ? row
          : {
              kind: "pair",
              left: { line: row.oldLine, text: row.text, kind: "context" },
              right: { line: row.newLine, text: row.text, kind: "context" },
            },
      );
    }
  }
  flush();
  return out;
}

const ROW_TONE = {
  context: "text-muted",
  add: "bg-[var(--diff-add-bg)] text-[var(--diff-add-ink)]",
  del: "bg-[var(--diff-del-bg)] text-[var(--diff-del-ink)]",
} as const;

const SIGN = {
  context: <span className="w-5 shrink-0 text-center"> </span>,
  add: <span className="w-5 shrink-0 text-center text-ok">+</span>,
  del: <span className="w-5 shrink-0 text-center text-danger">−</span>,
} as const;

function LineNo({ value, kind }: { value?: number; kind: Side["kind"] }) {
  const tone =
    kind === "add" ? "text-[#4e7a5b]" : kind === "del" ? "text-[#8a4e51]" : "text-ghost";
  return <span className={`w-11 shrink-0 pr-2 text-right select-none ${tone}`}>{value ?? ""}</span>;
}

function textOf(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(textOf).join("");
}

function SuggestionBlock({ original, suggestion }: { original: string; suggestion: string }) {
  const [copied, setCopied] = useState(false);
  const lines = suggestion.replace(/\n$/, "").split("\n");

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-line font-mono text-xs leading-5">
      <div className="flex items-center justify-between bg-raised px-3 py-1.5 font-sans text-xs text-subtle">
        Suggested change
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(lines.join("\n"));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="h-6 rounded-md border border-[#2e2e2e] px-2.5 text-xs text-ink hover:bg-active"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <div className={`whitespace-pre px-3 ${ROW_TONE.del}`}>− {original}</div>
        {lines.map((line, i) => (
          <div key={i} className={`whitespace-pre px-3 ${ROW_TONE.add}`}>
            + {line}
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineComment({
  comment,
  original,
  resolved,
  onToggleResolved,
}: {
  comment: StructuredFileComment;
  original: string;
  resolved: boolean;
  onToggleResolved: () => void;
}) {
  const components: Components = {
    pre({ node, children }) {
      const code = node?.children[0];
      const isSuggestion =
        code?.type === "element" &&
        String(code.properties.className ?? "").includes("language-suggestion");
      return isSuggestion ? (
        <SuggestionBlock original={original} suggestion={textOf(code)} />
      ) : (
        <pre>{children}</pre>
      );
    },
  };

  if (resolved) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2 text-xs text-subtle">
        <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[comment.severity]}`} />
        <span>Resolved · line {comment.line}</span>
        <button type="button" onClick={onToggleResolved} className="ml-auto text-muted hover:text-ink">
          Show
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[760px] rounded-xl border border-line-strong bg-[#121212]">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
        <GrokMark size={22} />
        <span className="font-medium text-ink">Grok</span>
        <span className={`inline-flex items-center gap-1.5 text-xs ${SEVERITY_TEXT[comment.severity]}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[comment.severity]}`} />
          {SEVERITY_LABEL[comment.severity]}
        </span>
        <span className="font-mono text-xs text-faint">line {comment.line}</span>
      </div>
      <div className="review-markdown px-4 py-3.5 text-sm">
        <ReactMarkdown components={components}>{comment.body}</ReactMarkdown>
      </div>
      <div className="px-4 pb-3.5">
        <button
          type="button"
          onClick={onToggleResolved}
          className="h-8 rounded-lg border border-line-strong px-3 text-xs text-ink transition-colors hover:bg-raised"
        >
          Resolve
        </button>
      </div>
    </div>
  );
}

export function DiffView({
  patch,
  layout,
  comments,
  resolved,
  onToggleResolved,
}: {
  patch: string;
  layout: DiffLayout;
  comments: StructuredFileComment[];
  resolved: Set<string>;
  onToggleResolved: (key: string) => void;
}) {
  const rows = parsePatch(patch);
  const textByLine = new Map<number, string>();
  for (const row of rows) {
    if (row.kind === "add" || row.kind === "context") textByLine.set(row.newLine, row.text);
  }

  const commentsAt = (line: number | undefined): ReactNode => {
    if (line === undefined) return null;
    const here = comments.filter((c) => c.line === line);
    if (here.length === 0) return null;
    return (
      <div className="flex flex-col gap-2 py-3 pr-4 pl-4 font-sans whitespace-normal md:pl-28">
        {here.map((c) => {
          const key = commentKey(c);
          return (
            <InlineComment
              key={key}
              comment={c}
              original={textByLine.get(c.line) ?? ""}
              resolved={resolved.has(key)}
              onToggleResolved={() => onToggleResolved(key)}
            />
          );
        })}
      </div>
    );
  };

  const hunk = (text: string, i: number) => (
    <div key={i} className="bg-[var(--diff-hunk-bg)] py-1 pr-4 pl-4 whitespace-pre text-faint md:pl-28">
      {text}
    </div>
  );

  return (
    <div className="overflow-x-auto bg-canvas pb-2 font-mono text-[12.5px] leading-[22px]">
      {layout === "unified"
        ? rows.map((row, i) => {
            if (row.kind === "hunk") return hunk(row.text, i);
            const newLine = row.kind === "del" ? undefined : row.newLine;
            const oldLine = row.kind === "add" ? undefined : row.oldLine;
            return (
              <Fragment key={i}>
                <div className={`flex whitespace-pre ${ROW_TONE[row.kind]}`}>
                  <LineNo value={oldLine} kind={row.kind} />
                  <LineNo value={newLine} kind={row.kind} />
                  {SIGN[row.kind]}
                  <span>{row.text}</span>
                </div>
                {commentsAt(newLine)}
              </Fragment>
            );
          })
        : toSplitRows(rows).map((row, i) => {
            if (row.kind === "hunk") return hunk(row.text, i);
            return (
              <Fragment key={i}>
                <div className="grid grid-cols-2">
                  {[row.left, row.right].map((side, j) => (
                    <div
                      key={j}
                      className={`flex min-w-0 ${side ? ROW_TONE[side.kind] : "bg-surface"} ${j === 1 ? "border-l border-line-soft" : ""}`}
                    >
                      {side && (
                        <>
                          <LineNo value={side.line} kind={side.kind} />
                          {SIGN[side.kind]}
                          <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{side.text}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                {commentsAt(row.right?.line)}
              </Fragment>
            );
          })}
    </div>
  );
}

export function commentKey(c: StructuredFileComment) {
  return `${c.path}:${c.line}:${c.body.slice(0, 40)}`;
}
