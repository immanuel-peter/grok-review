export type ParsedPullRequestUrl = {
  owner: string;
  repo: string;
  pullNumber: number;
};

const PULL_URL_PATTERN =
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i;

export function parseGitHubPullUrl(
  value: string,
): ParsedPullRequestUrl | null {
  const trimmedValue = value.trim();
  const match = trimmedValue.match(PULL_URL_PATTERN);

  if (!match) {
    return null;
  }

  const pullNumber = Number.parseInt(match[3], 10);
  if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2],
    pullNumber,
  };
}
