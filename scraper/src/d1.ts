/**
 * Minimal Cloudflare D1 HTTP client. The scraper runs in GitHub Actions (not
 * on Cloudflare), so it writes to D1 over the REST API with an API token.
 * See: https://developers.cloudflare.com/api/operations/cloudflare-d1-query-database
 */

export interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

export function d1ConfigFromEnv(): D1Config {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID");
  const databaseId = required("CLOUDFLARE_D1_DATABASE_ID");
  const apiToken = required("CLOUDFLARE_API_TOKEN");
  return { accountId, databaseId, apiToken };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export interface D1Result {
  results: unknown[];
  success: boolean;
  meta: Record<string, unknown>;
}

/** Run one SQL statement with bound params against D1. */
export async function d1Query(
  cfg: D1Config,
  sql: string,
  params: unknown[] = []
): Promise<D1Result[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });
  const json = (await res.json()) as {
    success: boolean;
    errors?: unknown;
    result?: D1Result[];
  };
  if (!res.ok || !json.success) {
    throw new Error(`D1 query failed (${res.status}): ${JSON.stringify(json.errors ?? json)}`);
  }
  return json.result ?? [];
}
