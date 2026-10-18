export type ShellResult = {
  stdout: string;
  stderr: string;
  outcome: { type: "exit"; exit_code: number } | { type: "timeout" };
};

export type SandboxWorkspace = {
  id: string;
  headSha: string;
  exec(
    commands: string[],
    options?: { timeoutMs?: number; maxOutputLength?: number },
  ): Promise<ShellResult[]>;
  destroy(): Promise<void>;
};

function getSandboxUrl(): string {
  const url = process.env.SANDBOX_URL?.trim();
  if (!url) throw new Error("SANDBOX_URL is not set.");
  return url.replace(/\/$/, "");
}

async function sandboxRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = process.env.SANDBOX_TOKEN?.trim();
  const response = await fetch(`${getSandboxUrl()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok) {
    throw new Error(
      `Sandbox ${method} ${path} failed (${response.status}): ${payload?.error ?? "unknown error"}`,
    );
  }
  return payload as T;
}

export async function createSandboxWorkspace({
  owner,
  repo,
  pullNumber,
  baseSha,
  githubToken,
}: {
  owner: string;
  repo: string;
  pullNumber: number;
  baseSha: string;
  githubToken?: string;
}): Promise<SandboxWorkspace> {
  const { id, headSha } = await sandboxRequest<{ id: string; headSha: string }>(
    "POST",
    "/workspaces",
    { owner, repo, pullNumber, baseSha, githubToken },
  );

  return {
    id,
    headSha,
    async exec(commands, options = {}) {
      const { results } = await sandboxRequest<{ results: ShellResult[] }>(
        "POST",
        `/workspaces/${id}/exec`,
        { commands, ...options },
      );
      return results;
    },
    async destroy() {
      await sandboxRequest("DELETE", `/workspaces/${id}`).catch((err) =>
        console.warn(`Failed to destroy sandbox workspace ${id}`, err),
      );
    },
  };
}
