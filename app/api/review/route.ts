import { gateway, streamText } from "ai";
import { fetchPullRequestWithFiles } from "@/lib/github";
import {
  buildReviewCacheKey,
  buildReviewPrompt,
  computePromptHash,
} from "@/lib/review-context";
import {
  getCachedReview,
  isReviewCacheEnabled,
  upsertCachedReview,
} from "@/lib/review-cache";

export const runtime = "nodejs";
export const maxDuration = 60;

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

const MODEL_ID = process.env.GROK_MODEL?.trim() || "xai/grok-4-1-fast-reasoning";

const REVIEW_SYSTEM_PROMPT = `You are an elite principal engineer performing pull request reviews.
You are strict, precise, and concrete.
Prioritize correctness, production risk, security issues, and test gaps.
Avoid generic advice. Only make claims grounded in the provided diff context.`;

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

  if (!validated.forceRefresh && isReviewCacheEnabled()) {
    try {
      const cached = await getCachedReview(cacheKey);
      if (cached) {
        return new Response(cached.reviewMarkdown, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Grokreq-Cache": "HIT",
            "X-Grokreq-Model": MODEL_ID,
            "X-Grokreq-Head-Sha": pullData.pullRequest.head.sha,
          },
        });
      }
    } catch (error) {
      console.error("Failed to read cached review from Neon", error);
    }
  }

  const prompt = buildReviewPrompt({
    owner: validated.owner,
    repo: validated.repo,
    pullRequest: pullData.pullRequest,
    files: pullData.files,
  });

  const promptHash = computePromptHash(prompt);

  const result = streamText({
    model: gateway(MODEL_ID),
    system: REVIEW_SYSTEM_PROMPT,
    prompt,
    maxOutputTokens: 4000,
    onError: ({ error }) => {
      console.error("streamText error", error);
    },
    onFinish: async ({ text }) => {
      if (!isReviewCacheEnabled()) {
        return;
      }

      try {
        await upsertCachedReview({
          cacheKey,
          owner: validated.owner,
          repo: validated.repo,
          pullNumber: validated.pullNumber,
          headSha: pullData.pullRequest.head.sha,
          model: MODEL_ID,
          promptHash,
          reviewMarkdown: text,
        });
      } catch (error) {
        console.error("Failed to cache review in Neon", error);
      }
    },
  });

  return result.toTextStreamResponse({
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "X-Grokreq-Cache": isReviewCacheEnabled() ? "MISS" : "DISABLED",
      "X-Grokreq-Model": MODEL_ID,
      "X-Grokreq-Head-Sha": pullData.pullRequest.head.sha,
    },
  });
}
