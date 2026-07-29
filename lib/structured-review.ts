import OpenAI from "openai";
import { z } from "zod";

import type { GitHubPullRequest, GitHubPullRequestFile } from "@/lib/github";
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

const MODEL_ID = process.env.GROK_MODEL?.trim() || "grok-4.5";

const SYSTEM_PROMPT = `You are an elite principal engineer performing pull request reviews.

STRICT REQUIREMENTS:
- Prioritize correctness, production risk, security issues, and test gaps.
- Only make claims grounded in the provided diff context.
- File comments MUST target specific lines with actionable fixes.
- The 'line' field MUST be the exact line number in the NEW file where the issue occurs, and MUST be a line that appears in the patch diff you receive.
- If you cannot confidently map an issue to a specific diff line, omit it from file_comments and mention it in overall_review instead.
- Respond ONLY with valid JSON matching the required schema. No markdown wrappers, no extra text.`;

function getXaiClient(): OpenAI {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) throw new Error("XAI_API_KEY is not set.");

  return new OpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
    timeout: 360_000,
  });
}

// Reuse clamping logic from review-context.ts but allow slightly more for structured
const MAX_FILES_FOR_PROMPT = 80;
const MAX_PATCH_CHARS_PER_FILE = 3500;
const MAX_TOTAL_PATCH_CHARS = 95000;

function clampPatch(patch: string, maxChars: number): string {
  if (patch.length <= maxChars) return patch;
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

export function buildStructuredReviewPrompt({
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
    if (totalPatchChars + patchChars > MAX_TOTAL_PATCH_CHARS) break;
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
    "TASK:",
    "Review this PR and respond with JSON only.",
    "",
    "JSON schema:",
    JSON.stringify(
      {
        verdict: "approve | comment | request_changes (use request_changes only for blocking critical bugs/security)",
        overall_review: "markdown string: include ## Summary, ## Verdict, ## Blocking Issues, ## Suggested Tests sections",
        file_comments: [
          {
            path: "exact file path from diff, e.g. lib/foo.ts",
            line: 42,
            body: "Concise issue + concrete fix. Keep <= 3 sentences.",
            severity: "critical | high | medium | low",
          },
        ],
      },
      null,
      2,
    ),
    "",
    "Changed file contexts:",
    fileContexts.join("\n\n---\n\n"),
  ].join("\n");
}

/**
 * Call Grok to produce structured review JSON.
 * Uses chat.completions with json_object mode (best supported by xAI).
 */
export async function generateStructuredReview({
  owner,
  repo,
  pullRequest,
  files,
}: {
  owner: string;
  repo: string;
  pullRequest: GitHubPullRequest;
  files: GitHubPullRequestFile[];
}): Promise<StructuredReview> {
  const prompt = buildStructuredReviewPrompt({
    owner,
    repo,
    pullRequest,
    files,
  });

  const client = getXaiClient();

  // Use chat completions for reliable JSON mode on xAI
  const completion = await client.chat.completions.create({
    model: MODEL_ID,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" } as unknown as undefined,
    max_tokens: 6000,
    temperature: 0.2,
  });

  const rawContent = completion.choices[0]?.message?.content;
  if (!rawContent) throw new Error("Grok returned empty response");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch (err) {
    console.error("Failed to parse Grok JSON", rawContent.slice(0, 2000));
    throw new Error(
      `Grok returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const validated = StructuredReviewSchema.safeParse(parsedJson);
  if (!validated.success) {
    console.error(
      "Structured review validation failed",
      validated.error.flatten(),
    );
    console.error("Raw JSON:", JSON.stringify(parsedJson).slice(0, 3000));
    throw new Error(
      `Grok JSON failed validation: ${validated.error.message}`,
    );
  }

  return validated.data;
}

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
