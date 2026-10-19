const GITHUB_API_BASE = "https://api.github.com";
const MAX_FILES = 500;

export type GitHubPullRequest = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  draft: boolean;
  user: {
    login: string;
  };
  head: {
    sha: string;
    ref: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  additions: number;
  deletions: number;
  changed_files: number;
};

export type GitHubPullRequestFile = {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

export type PullRequestWithFiles = {
  pullRequest: GitHubPullRequest;
  files: GitHubPullRequestFile[];
};

function githubHeaders(): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "User-Agent": "grokreq-app",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function fetchGitHubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: githubHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `GitHub API request failed (${response.status}): ${responseText}`,
    );
  }

  return (await response.json()) as T;
}

export async function fetchPullRequestWithFiles(
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestWithFiles> {
  const pullRequest = await fetchGitHubJson<GitHubPullRequest>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${pullNumber}`,
  );

  const files: GitHubPullRequestFile[] = [];

  for (let page = 1; files.length < MAX_FILES; page += 1) {
    const batch = await fetchGitHubJson<GitHubPullRequestFile[]>(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
    );

    if (batch.length === 0) {
      break;
    }

    files.push(...batch);

    if (batch.length < 100) {
      break;
    }
  }

  return {
    pullRequest,
    files,
  };
}
