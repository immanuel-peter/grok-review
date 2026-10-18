import { z } from "zod";

import { type ValidLineMap } from "@/lib/github-app";

// ─── Schema for structured output ───

export const StructuredFileCommentSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  body: z.string().min(1).max(2000),
  severity: z.enum(["critical", "high", "medium", "low"]),
});

export const StructuredReviewSchema = z.object({
  verdict: z.enum(["approve", "comment", "request_changes"]),
  overall_review: z.string().min(1).max(20000),
  file_comments: z.array(StructuredFileCommentSchema).max(40),
});

export type StructuredReview = z.infer<typeof StructuredReviewSchema>;
export type StructuredFileComment = z.infer<typeof StructuredFileCommentSchema>;

/**
 * Filter and clamp file comments to only those that GitHub will accept.
 */
export function filterValidFileComments(
  fileComments: StructuredReview["file_comments"],
  validLinesMap: ValidLineMap,
  knownFiles: Set<string>,
): StructuredReview["file_comments"] {
  const seen = new Set<string>();
  const out: StructuredReview["file_comments"] = [];

  for (const c of fileComments) {
    if (!knownFiles.has(c.path)) {
      console.warn(`Skipping comment for unknown file: ${c.path}`);
      continue;
    }

    const validLines = validLinesMap.get(c.path);
    if (!validLines) {
      console.warn(`Skipping comment for file with no diff lines: ${c.path}`);
      continue;
    }

    if (!validLines.has(c.line)) {
      // Try to snap to nearest valid line within ±5
      let snapped: number | null = null;
      for (let delta = 1; delta <= 5; delta++) {
        if (validLines.has(c.line + delta)) {
          snapped = c.line + delta;
          break;
        }
        if (validLines.has(c.line - delta)) {
          snapped = c.line - delta;
          break;
        }
      }
      if (snapped === null) {
        console.warn(
          `Skipping comment for ${c.path}:${c.line} - not in diff and no nearby line`,
        );
        continue;
      }
      c.line = snapped;
    }

    const dedupKey = `${c.path}:${c.line}:${c.body.slice(0, 50)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    out.push(c);
  }

  return out;
}

export function getReviewEventFromVerdict(verdict: StructuredReview["verdict"]): "APPROVE" | "COMMENT" | "REQUEST_CHANGES" {
  switch (verdict) {
    case "approve":
      return "APPROVE";
    case "request_changes":
      return "REQUEST_CHANGES";
    case "comment":
    default:
      return "COMMENT";
  }
}

export function renderReviewMarkdown(review: StructuredReview): string {
  const sections = [`**Verdict:** ${review.verdict}`, review.overall_review.trim()];
  if (review.file_comments.length > 0) {
    sections.push(
      [
        "## File-Scoped Comments",
        ...review.file_comments.map(
          (c) => `- **${c.path}:${c.line}** (${c.severity}): ${c.body}`,
        ),
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

export type ReviewStreamEvent =
  | { type: "log"; message: string }
  | { type: "review"; review: StructuredReview; cached: boolean }
  | { type: "error"; message: string };
