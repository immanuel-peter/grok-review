import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, rm, chown } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const PORT = Number(process.env.PORT || 8080);
const WORK_ROOT = process.env.SANDBOX_WORK_ROOT || "/work";
const AUTH_TOKEN = process.env.SANDBOX_TOKEN?.trim() || "";
const WORKSPACE_TTL_MS = 30 * 60_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_OUTPUT_CHARS = 16_000;
const MAX_OUTPUT_CHARS = 64_000;
const CLONE_TIMEOUT_MS = 180_000;
const UID_BASE = 20_000;
const UID_RANGE = 10_000;

// Each workspace gets its own uid so commands can't read other workspaces or
// the server's /proc entry. Requires the server to run as root.
const isRoot = process.getuid?.() === 0;
const workspaces = new Map();
let nextUid = 0;

function allocateUid() {
  const inUse = new Set([...workspaces.values()].map((w) => w.uid));
  for (let i = 0; i < UID_RANGE; i++) {
    const uid = UID_BASE + ((nextUid + i) % UID_RANGE);
    if (!inUse.has(uid)) {
      nextUid = (nextUid + i + 1) % UID_RANGE;
      return uid;
    }
  }
  throw new Error("No free sandbox uids");
}

function commandEnv(home) {
  return {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    LANG: "C.UTF-8",
    PAGER: "cat",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function run(argv, { cwd, uid, env, timeoutMs, maxChars }) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...(isRoot && uid ? { uid, gid: uid } : {}),
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;

    const append = (current, chunk) => {
      if (current.length >= maxChars) {
        truncated = true;
        return current;
      }
      const next = current + chunk.toString("utf8");
      if (next.length > maxChars) {
        truncated = true;
        return next.slice(0, maxChars);
      }
      return next;
    };

    child.stdout.on("data", (chunk) => (stdout = append(stdout, chunk)));
    child.stderr.on("data", (chunk) => (stderr = append(stderr, chunk)));

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, timeoutMs);

    const finish = (exitCode) => {
      clearTimeout(timer);
      if (truncated) stdout += `\n[output truncated at ${maxChars} chars]`;
      resolve({
        stdout,
        stderr,
        outcome: timedOut ? { type: "timeout" } : { type: "exit", exit_code: exitCode },
      });
    };

    child.on("error", (err) => {
      stderr += err.message;
      finish(127);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

async function git(workspace, args, extraConfig = []) {
  const configArgs = extraConfig.flatMap((c) => ["-c", c]);
  const result = await run(["git", ...configArgs, ...args], {
    cwd: workspace.dir,
    uid: workspace.uid,
    env: commandEnv(workspace.home),
    timeoutMs: CLONE_TIMEOUT_MS,
    maxChars: 8_000,
  });
  if (result.outcome.type !== "exit" || result.outcome.exit_code !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.outcome.type}`);
  }
  return result.stdout;
}

const SHA_RE = /^[0-9a-f]{40}$/;
const NAME_RE = /^[A-Za-z0-9_.-]+$/;

async function createWorkspace(body) {
  const { owner, repo, pullNumber, baseSha, githubToken } = body ?? {};
  if (!NAME_RE.test(owner ?? "") || !NAME_RE.test(repo ?? "")) throw new HttpError(400, "invalid owner/repo");
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) throw new HttpError(400, "invalid pullNumber");
  if (!SHA_RE.test(baseSha ?? "")) throw new HttpError(400, "invalid baseSha");

  const id = randomUUID();
  const root = path.join(WORK_ROOT, id);
  const workspace = {
    id,
    uid: isRoot ? allocateUid() : undefined,
    root,
    dir: path.join(root, "repo"),
    home: path.join(root, "home"),
    createdAt: Date.now(),
  };
  workspaces.set(id, workspace);

  try {
    await mkdir(workspace.dir, { recursive: true, mode: 0o700 });
    await mkdir(workspace.home, { recursive: true, mode: 0o700 });
    if (isRoot) {
      for (const p of [root, workspace.dir, workspace.home]) await chown(p, workspace.uid, workspace.uid);
    }

    // The token is passed per-command and never written to .git/config.
    const auth = githubToken
      ? [`http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${githubToken}`).toString("base64")}`]
      : [];

    await git(workspace, ["init", "-q"]);
    await git(workspace, ["config", "core.symlinks", "false"]);
    await git(workspace, ["remote", "add", "origin", `https://github.com/${owner}/${repo}.git`]);
    await git(
      workspace,
      ["fetch", "-q", "--depth=1", "--no-tags", "origin", `+refs/pull/${pullNumber}/head:refs/heads/pr`, `+${baseSha}:refs/heads/base`],
      auth,
    );
    await git(workspace, ["checkout", "-q", "pr"]);
    const headSha = (await git(workspace, ["rev-parse", "HEAD"])).trim();

    return { id, headSha };
  } catch (err) {
    await destroyWorkspace(id);
    throw err;
  }
}

async function execInWorkspace(workspace, body) {
  const commands = body?.commands;
  if (!Array.isArray(commands) || commands.length === 0 || !commands.every((c) => typeof c === "string")) {
    throw new HttpError(400, "commands must be a non-empty string array");
  }
  const timeoutMs = Math.min(Number(body.timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxChars = Math.min(Number(body.maxOutputLength) || DEFAULT_OUTPUT_CHARS, MAX_OUTPUT_CHARS);

  const results = [];
  for (const command of commands) {
    results.push(
      await run(["/bin/sh", "-c", command], {
        cwd: workspace.dir,
        uid: workspace.uid,
        env: commandEnv(workspace.home),
        timeoutMs,
        maxChars,
      }),
    );
  }
  return { results };
}

async function destroyWorkspace(id) {
  const workspace = workspaces.get(id);
  if (!workspace) return;
  workspaces.delete(id);
  await rm(workspace.root, { recursive: true, force: true });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authorized(req) {
  if (!AUTH_TOKEN) return true;
  const header = req.headers.authorization ?? "";
  const expected = `Bearer ${AUTH_TOKEN}`;
  return header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new HttpError(413, "body too large");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function send(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://sandbox");
    if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true, workspaces: workspaces.size });
    if (!authorized(req)) return send(res, 401, { error: "unauthorized" });

    if (req.method === "POST" && url.pathname === "/workspaces") {
      return send(res, 201, await createWorkspace(await readJson(req)));
    }

    const match = url.pathname.match(/^\/workspaces\/([0-9a-f-]{36})(\/exec)?$/);
    const workspace = match && workspaces.get(match[1]);
    if (!workspace) return send(res, 404, { error: "workspace not found" });

    if (req.method === "POST" && match[2]) return send(res, 200, await execInWorkspace(workspace, await readJson(req)));
    if (req.method === "DELETE" && !match[2]) {
      await destroyWorkspace(workspace.id);
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: "method not allowed" });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    send(res, status, { error: err instanceof Error ? err.message : String(err) });
  }
});

setInterval(() => {
  const cutoff = Date.now() - WORKSPACE_TTL_MS;
  for (const workspace of workspaces.values()) {
    if (workspace.createdAt < cutoff) void destroyWorkspace(workspace.id);
  }
}, 60_000).unref();

await rm(WORK_ROOT, { recursive: true, force: true }).catch(() => {});
await mkdir(WORK_ROOT, { recursive: true });

server.listen(PORT, () => {
  console.log(`sandbox listening on :${PORT} (per-workspace uids: ${isRoot})`);
});
