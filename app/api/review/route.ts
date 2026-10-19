import { fetchPullRequestWithFiles } from "@/lib/github";
import {
  buildReviewAgentPrompt,
  REVIEW_AGENT_INSTRUCTIONS,
  runReviewAgent,
} from "@/lib/review-agent";
import {
  getCachedReview,
  isReviewCacheEnabled,
  upsertCachedReview,
} from "@/lib/review-cache";
import { buildReviewCacheKey, computePromptHash } from "@/lib/review-context";
import {
  renderReviewMarkdown,
  StructuredReviewSchema,
  type ReviewStats,
  type ReviewStreamEvent,
} from "@/lib/structured-review";

export const runtime = "nodejs";
export const maxDuration = 300;

type ReviewRequestBody = {
  owner?: unknown;
  repo?: unknown;
  pullNumber?: unknown;
  forceRefresh?: unknown;
};

type ValidatedReviewRequest = {
  owner: string;
  repo: string;
  pullNumber: number;
  forceRefresh: boolean;
};

const MODEL_ID = process.env.GROK_MODEL?.trim() || "grok-4.5";

function validateRequestBody(payload: ReviewRequestBody): ValidatedReviewRequest | null {
  if (typeof payload.owner !== "string" || typeof payload.repo !== "string") {
    return null;
  }

  const owner = payload.owner.trim();
  const repo = payload.repo.trim();
  const parsedPullNumber =
    typeof payload.pullNumber === "number"
      ? payload.pullNumber
      : typeof payload.pullNumber === "string"
        ? Number.parseInt(payload.pullNumber, 10)
        : Number.NaN;

  if (!owner || !repo || !Number.isInteger(parsedPullNumber) || parsedPullNumber <= 0) {
    return null;
  }

  return {
    owner,
    repo,
    pullNumber: parsedPullNumber,
    forceRefresh: Boolean(payload.forceRefresh),
  };
}

function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  let body: ReviewRequestBody;

  try {
    body = (await request.json()) as ReviewRequestBody;
  } catch {
    return jsonError("Request body must be valid JSON.");
  }

  const validated = validateRequestBody(body);
  if (!validated) {
    return jsonError("Expected { owner, repo, pullNumber } in request body.");
  }

  let pullData;
  try {
    pullData = await fetchPullRequestWithFiles(
      validated.owner,
      validated.repo,
      validated.pullNumber,
    );
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? `Could not load pull request from GitHub: ${error.message}`
        : "Could not load pull request from GitHub.",
      502,
    );
  }

  const cacheKey = buildReviewCacheKey({
    owner: validated.owner,
    repo: validated.repo,
    pullRequest: pullData.pullRequest,
    files: pullData.files,
    model: MODEL_ID,
  });

  const headers = {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Grokreq-Model": MODEL_ID,
    "X-Grokreq-Head-Sha": pullData.pullRequest.head.sha,
  };

  if (!validated.forceRefresh && isReviewCacheEnabled()) {
    const cached = await getCachedReview(cacheKey);
    const cachedReview = StructuredReviewSchema.safeParse(cached?.reviewJson);
    if (cachedReview.success) {
      const event: ReviewStreamEvent = {
        type: "review",
        review: cachedReview.data,
        cached: true,
        stats: (cached?.reviewStats as ReviewStats | null) ?? null,
        reviewedAt: (cached?.updatedAt ?? new Date()).toISOString(),
      };
      return new Response(`${JSON.stringify(event)}\n`, {
        headers: { ...headers, "X-Grokreq-Cache": "HIT" },
      });
    }
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ReviewStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Client disconnected; the agent stops via request.signal.
        }
      };

      try {
        const { review, stats } = await runReviewAgent({
          owner: validated.owner,
          repo: validated.repo,
          pullRequest: pullData.pullRequest,
          files: pullData.files,
          githubToken: process.env.GITHUB_TOKEN?.trim() || undefined,
          log: (message) => send({ type: "log", message }),
          signal: request.signal,
        });
        send({
          type: "review",
          review,
          cached: false,
          stats,
          reviewedAt: new Date().toISOString(),
        });

        if (isReviewCacheEnabled()) {
          await upsertCachedReview({
            cacheKey,
            owner: validated.owner,
            repo: validated.repo,
            pullNumber: validated.pullNumber,
            headSha: pullData.pullRequest.head.sha,
            model: MODEL_ID,
            promptHash: computePromptHash(
              `${REVIEW_AGENT_INSTRUCTIONS}\n${buildReviewAgentPrompt({
                owner: validated.owner,
                repo: validated.repo,
                pullRequest: pullData.pullRequest,
                files: pullData.files,
              })}`,
            ),
            reviewMarkdown: renderReviewMarkdown(review),
            reviewJson: review,
            reviewStats: stats,
          });
        }
      } catch (error) {
        console.error("Review agent failed", error);
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Review failed.",
        });
      }

      try {
        controller.close();
      } catch {}
    },
  });

  return new Response(readable, {
    headers: {
      ...headers,
      "X-Grokreq-Cache": isReviewCacheEnabled() ? "MISS" : "DISABLED",
    },
  });
}
