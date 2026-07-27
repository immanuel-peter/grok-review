import OpenAI from "openai";
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

const REVIEW_SYSTEM_PROMPT = `You are an elite principal engineer performing pull request reviews.
You are strict, precise, and concrete.
Prioritize correctness, production risk, security issues, and test gaps.
Avoid generic advice. Only make claims grounded in the provided diff context.`;

function getXaiClient(): OpenAI {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("XAI_API_KEY is not set.");
  }

  return new OpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
    // Grok 4.5 reasoning can take a while; match xAI streaming guidance.
    timeout: 360_000,
  });
}

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
      console.error("Failed to read cached review from Postgres", error);
    }
  }

  const prompt = buildReviewPrompt({
    owner: validated.owner,
    repo: validated.repo,
    pullRequest: pullData.pullRequest,
    files: pullData.files,
  });

  const promptHash = computePromptHash(prompt);

  let client: OpenAI;
  try {
    client = getXaiClient();
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "XAI_API_KEY is not set.",
      500,
    );
  }

  let stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>;
  try {
    stream = await client.responses.create({
      model: MODEL_ID,
      instructions: REVIEW_SYSTEM_PROMPT,
      input: prompt,
      max_output_tokens: 4000,
      stream: true,
      store: false,
      // Routes repeat PR reviews to the same server for prompt-cache hits.
      prompt_cache_key: cacheKey,
    });
  } catch (error) {
    console.error("xAI responses.create error", error);
    return jsonError(
      error instanceof Error
        ? `Grok review failed: ${error.message}`
        : "Grok review failed.",
      502,
    );
  }

  const encoder = new TextEncoder();
  let fullText = "";

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "response.output_text.delta" && event.delta) {
            fullText += event.delta;
            controller.enqueue(encoder.encode(event.delta));
          } else if (event.type === "response.failed") {
            throw new Error("Grok response failed.");
          } else if (event.type === "error") {
            throw new Error(event.message || "Grok stream error.");
          }
        }

        if (isReviewCacheEnabled() && fullText) {
          try {
            await upsertCachedReview({
              cacheKey,
              owner: validated.owner,
              repo: validated.repo,
              pullNumber: validated.pullNumber,
              headSha: pullData.pullRequest.head.sha,
              model: MODEL_ID,
              promptHash,
              reviewMarkdown: fullText,
            });
          } catch (error) {
            console.error("Failed to cache review in Postgres", error);
          }
        }

        controller.close();
      } catch (error) {
        console.error("xAI stream error", error);
        controller.error(error);
      }
    },
  });

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Grokreq-Cache": isReviewCacheEnabled() ? "MISS" : "DISABLED",
      "X-Grokreq-Model": MODEL_ID,
      "X-Grokreq-Head-Sha": pullData.pullRequest.head.sha,
    },
  });
}
