CREATE TABLE IF NOT EXISTS pr_review_cache (
  cache_key      TEXT PRIMARY KEY,
  owner          TEXT        NOT NULL,
  repo           TEXT        NOT NULL,
  pull_number    INTEGER     NOT NULL,
  head_sha       TEXT        NOT NULL,
  model          TEXT        NOT NULL,
  prompt_hash    TEXT        NOT NULL,
  review_markdown TEXT       NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pr_review_cache_lookup_idx
  ON pr_review_cache (owner, repo, pull_number, head_sha, model);
