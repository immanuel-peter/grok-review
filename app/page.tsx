"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseGitHubPullUrl } from "@/lib/github-url";

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const parsed = parseGitHubPullUrl(url);
    if (!parsed) {
      setError("Enter a valid GitHub pull request URL.");
      return;
    }

    router.push(`/${parsed.owner}/${parsed.repo}/pull/${parsed.pullNumber}`);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <h1 className="mb-8 font-mono text-sm tracking-wider text-faint">
        Grok Review
      </h1>

      <form onSubmit={handleSubmit} className="flex w-full max-w-xl gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/owner/repo/pull/123"
          className="h-10 flex-1 rounded-md border border-[--line] bg-[--surface] px-3 font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-[--line-strong]"
        />
        <button
          type="submit"
          className="h-10 rounded-md bg-ink px-5 font-mono text-sm font-medium text-black transition-opacity hover:opacity-90"
        >
          Review
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </main>
  );
}
