import { after } from "next/server";

import {
  fetchPullRequestWithFilesViaOctokit,
  getInstallationOctokit,
  getWebhookSecret,
  verifyWebhookSignature,
} from "@/lib/github-app";
import {
  generateAndPostReview,
  postFailureComment,
} from "@/lib/github-review";

export const runtime = "nodejs";
export const maxDuration = 300;

type PullRequestWebhookPayload = {
  action: string;
  installation?: { id: number };
  repository: { name: string; full_name: string; owner: { login: string } };
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    draft: boolean;
    html_url: string;
    state: string;
    user: { login: string };
    head: { sha: string; ref: string };
    base: { ref: string };
  };
};

const ALLOWED_ACTIONS = new Set([
  "opened",
  "reopened",
  "ready_for_review",
  "synchronize",
]);

async function processPullRequestReview(payload: PullRequestWebhookPayload) {
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const pullNumber = payload.pull_request.number;
  const headSha = payload.pull_request.head.sha;
  const installationId = payload.installation?.id;

  if (!installationId) {
    console.error("No installation ID in webhook payload");
    return;
  }

  console.log(
    `[webhook] Processing ${owner}/${repo}#${pullNumber} action=${payload.action} sha=${headSha.slice(0, 7)} installation=${installationId}`,
  );

  // Skip draft PRs unless it's ready_for_review
  if (payload.pull_request.draft && payload.action !== "ready_for_review") {
    console.log(`[webhook] Skipping draft PR ${owner}/${repo}#${pullNumber}`);
    return;
  }

  let octokit;
  try {
    octokit = await getInstallationOctokit(installationId);
  } catch (err) {
    console.error("[webhook] Failed to get installation octokit", err);
    return;
  }

  // Fetch full PR + files via installation token (works for private repos)
  let prData;
  try {
    prData = await fetchPullRequestWithFilesViaOctokit(
      octokit,
      owner,
      repo,
      pullNumber,
    );
  } catch (err) {
    console.error(
      `[webhook] Failed to fetch PR ${owner}/${repo}#${pullNumber}`,
      err,
    );
    return;
  }

  try {
    const { token: githubToken } = (await octokit.auth({
      type: "installation",
    })) as { token: string };

    const result = await generateAndPostReview({
      octokit,
      owner,
      repo,
      pullNumber,
      headSha: prData.pullRequest.head.sha, // use fresh SHA in case payload is stale
      files: prData.files,
      githubToken,
      pullRequest: prData.pullRequest,
    });

    console.log(
      `[webhook] Review posted for ${owner}/${repo}#${pullNumber} reviewId=${result.reviewId} fileComments=${result.fileCommentsPosted}`,
    );
  } catch (err) {
    console.error(
      `[webhook] Failed to generate/post review for ${owner}/${repo}#${pullNumber}`,
      err,
    );
    await postFailureComment({
      octokit,
      owner,
      repo,
      pullNumber,
      headSha: prData.pullRequest.head.sha,
      error: err,
    });
  }
}

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const event = req.headers.get("x-github-event");
  const delivery = req.headers.get("x-github-delivery");

  console.log(`[webhook] Received event=${event} delivery=${delivery}`);

  let secret: string;
  try {
    secret = getWebhookSecret();
  } catch (err) {
    console.error("[webhook] Missing webhook secret env", err);
    return Response.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    console.warn("[webhook] Invalid signature");
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: PullRequestWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as PullRequestWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only handle pull_request events we care about
  if (event === "pull_request") {
    if (!ALLOWED_ACTIONS.has(payload.action)) {
      console.log(`[webhook] Ignoring action=${payload.action}`);
      return Response.json({ ok: true, ignored: payload.action });
    }

    // Use after() to respond quickly and continue processing
    // after is available in Next.js 15+ (this app is Next 16)
    try {
      after(async () => {
        await processPullRequestReview(payload);
      });
    } catch (err) {
      // Fallback if after() is not available in this runtime (e.g. tests)
      console.warn("[webhook] after() not available, running inline", err);
      // Don't await - let it run but respond immediately via microtask
      // We wrap in a promise chain that logs errors
      Promise.resolve().then(() => processPullRequestReview(payload)).catch(console.error);
    }

    return Response.json({
      ok: true,
      processing: `${payload.repository.full_name}#${payload.pull_request.number}`,
    });
  }

  if (event === "ping") {
    return Response.json({ ok: true, message: "pong" });
  }

  // Ignore other events
  return Response.json({ ok: true, ignored: event });
}

// Optional: allow GET for health check / manual verification
export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    message: "GitHub webhook endpoint",
    expected_events: ["pull_request"],
    allowed_actions: Array.from(ALLOWED_ACTIONS),
  });
}
