import postgres from "postgres";

type CacheRow = {
  cache_key: string;
  owner: string;
  repo: string;
  pull_number: number;
  head_sha: string;
  model: string;
  prompt_hash: string;
  review_markdown: string;
  created_at: Date;
  updated_at: Date;
};

export type CachedReview = {
  cacheKey: string;
  headSha: string;
  model: string;
  promptHash: string;
  reviewMarkdown: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CachedReviewInput = {
  cacheKey: string;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  model: string;
  promptHash: string;
  reviewMarkdown: string;
};

type SqlClient = ReturnType<typeof postgres>;

declare global {
  var __grokreqSqlClient: SqlClient | null | undefined;
  var __grokreqSchemaReadyPromise: Promise<void> | undefined;
}

function getDatabaseUrl(): string | null {
  const value = process.env.DATABASE_URL?.trim();
  return value ? value : null;
}

function resolveSqlSslOption(databaseUrl: string): "require" | false {
  try {
    const sslMode = new URL(databaseUrl).searchParams.get("sslmode")?.toLowerCase();
    if (
      sslMode === "disable" ||
      sslMode === "allow" ||
      sslMode === "prefer"
    ) {
      return false;
    }
  } catch {}

  return "require";
}

function loadSqlClient(): SqlClient | null {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  try {
    return postgres(databaseUrl, {
      prepare: false,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: resolveSqlSslOption(databaseUrl),
    });
  } catch (error) {
    console.error("Failed to create postgres client. Review cache disabled.", error);
    return null;
  }
}

function getSqlClient(): SqlClient | null {
  if (global.__grokreqSqlClient !== undefined) {
    return global.__grokreqSqlClient;
  }

  global.__grokreqSqlClient = loadSqlClient();
  return global.__grokreqSqlClient;
}

async function ensureSchema(): Promise<boolean> {
  const sql = getSqlClient();
  if (!sql) {
    return false;
  }

  if (!global.__grokreqSchemaReadyPromise) {
    global.__grokreqSchemaReadyPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS pr_review_cache (
          cache_key TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          repo TEXT NOT NULL,
          pull_number INTEGER NOT NULL,
          head_sha TEXT NOT NULL,
          model TEXT NOT NULL,
          prompt_hash TEXT NOT NULL,
          review_markdown TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE INDEX IF NOT EXISTS pr_review_cache_lookup_idx
        ON pr_review_cache (owner, repo, pull_number, head_sha, model)
      `;
    })().catch((error) => {
      // Allow a later request to retry schema setup if this attempt fails.
      global.__grokreqSchemaReadyPromise = undefined;
      throw error;
    });
  }

  await global.__grokreqSchemaReadyPromise;
  return true;
}

export async function getCachedReview(
  cacheKey: string,
): Promise<CachedReview | null> {
  try {
    const schemaReady = await ensureSchema();
    if (!schemaReady) {
      return null;
    }

    const sql = getSqlClient();
    if (!sql) {
      return null;
    }

    const rows = await sql<CacheRow[]>`
      SELECT
        cache_key,
        owner,
        repo,
        pull_number,
        head_sha,
        model,
        prompt_hash,
        review_markdown,
        created_at,
        updated_at
      FROM pr_review_cache
      WHERE cache_key = ${cacheKey}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      cacheKey: row.cache_key,
      headSha: row.head_sha,
      model: row.model,
      promptHash: row.prompt_hash,
      reviewMarkdown: row.review_markdown,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    console.error("Failed to read review cache", error);
    return null;
  }
}

export async function upsertCachedReview(input: CachedReviewInput): Promise<void> {
  try {
    const schemaReady = await ensureSchema();
    if (!schemaReady) {
      return;
    }

    const sql = getSqlClient();
    if (!sql) {
      return;
    }

    await sql`
      INSERT INTO pr_review_cache (
        cache_key,
        owner,
        repo,
        pull_number,
        head_sha,
        model,
        prompt_hash,
        review_markdown
      )
      VALUES (
        ${input.cacheKey},
        ${input.owner},
        ${input.repo},
        ${input.pullNumber},
        ${input.headSha},
        ${input.model},
        ${input.promptHash},
        ${input.reviewMarkdown}
      )
      ON CONFLICT (cache_key) DO UPDATE
      SET
        prompt_hash = EXCLUDED.prompt_hash,
        review_markdown = EXCLUDED.review_markdown,
        updated_at = NOW()
    `;
  } catch (error) {
    console.error("Failed to write review cache", error);
  }
}

export function isReviewCacheEnabled(): boolean {
  return Boolean(getDatabaseUrl());
}
