/**
 * moneymcp — remote MCP server (Cloudflare Worker).
 *
 * Multi-user: protected by OAuth 2.1 (@cloudflare/workers-oauth-provider) with
 * Google as the identity provider. Each request runs as the authenticated user
 * (ctx.props.userId); all D1 queries are scoped to that user. MCP is served at
 * /mcp (Streamable HTTP JSON-RPC); the bank is never touched here — the scraper
 * (GitHub Actions) fills D1.
 */
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { WorkerEntrypoint } from "cloudflare:workers";

export interface Env {
  DB: D1Database;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: any; // injected by OAuthProvider; offers parseAuthRequest/completeAuthorization/etc.
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
}

const SERVER_INFO = { name: "moneymcp", version: "0.1.0" };
const DEFAULT_PROTOCOL = "2025-06-18";

// ---------- tool definitions ----------

const TOOLS = [
  {
    name: "get_transactions",
    description:
      "List the user's bank transactions in a date range, newest first. Amounts are in the account currency; negative = money out, positive = money in. The agent decides which are 'significant'.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date (ISO, e.g. 2026-06-01). Default: first of the current month." },
        to: { type: "string", description: "End date (ISO). Default: today." },
        source: { type: "string", description: "Filter to one institution: hapoalim | isracard | max. Omit for all." },
        limit: { type: "integer", minimum: 1, maximum: 1000, description: "Max rows (default 200)." },
      },
    },
  },
  {
    name: "search_transactions",
    description:
      "Search transactions by free text (matches description/memo) and/or amount range, within an optional date range. Newest first.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to match in description or memo." },
        minAmount: { type: "number", description: "Minimum amount (use negatives for spend, e.g. -1000 finds charges >= 1000 out)." },
        maxAmount: { type: "number", description: "Maximum amount." },
        from: { type: "string", description: "Start date (ISO)." },
        to: { type: "string", description: "End date (ISO)." },
        source: { type: "string", description: "Filter to one institution: hapoalim | isracard | max. Omit for all." },
        limit: { type: "integer", minimum: 1, maximum: 1000, description: "Max rows (default 200)." },
      },
    },
  },
  {
    name: "get_financial_summary",
    description:
      "Summarize a period: total in, total out, net, transaction count, and spend grouped by category (largest first).",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date (ISO). Default: first of the current month." },
        to: { type: "string", description: "End date (ISO). Default: today." },
      },
    },
  },
  {
    name: "get_scrape_status",
    description:
      "Report when transactions were last refreshed from the bank (last successful scrape time) and whether the most recent run succeeded. Use this to judge data freshness.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ---------- helpers ----------

function firstOfThisMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Args = Record<string, unknown>;

async function getTransactions(env: Env, userId: string, args: Args) {
  const from = (args.from as string) ?? firstOfThisMonth();
  const to = (args.to as string) ?? today();
  const limit = Math.min(Number(args.limit) || 200, 1000);
  const source = args.source as string | undefined;
  const { results } = await env.DB.prepare(
    `SELECT source, account, date, description, memo, amount, currency, status, type, category
       FROM transactions
      WHERE user_id = ?1 AND date >= ?2 AND date <= ?3 AND (?4 IS NULL OR source = ?4)
      ORDER BY date DESC
      LIMIT ?5`
  )
    .bind(userId, from, to, source ?? null, limit)
    .all();
  return { from, to, source: source ?? "all", count: results.length, transactions: results };
}

async function searchTransactions(env: Env, userId: string, args: Args) {
  const conds: string[] = [`user_id = ?1`];
  const binds: unknown[] = [userId];
  let i = 2;
  if (args.query) {
    conds.push(`(description LIKE ?${i} OR memo LIKE ?${i})`);
    binds.push(`%${args.query}%`);
    i++;
  }
  if (args.minAmount !== undefined) {
    conds.push(`amount >= ?${i++}`);
    binds.push(Number(args.minAmount));
  }
  if (args.maxAmount !== undefined) {
    conds.push(`amount <= ?${i++}`);
    binds.push(Number(args.maxAmount));
  }
  if (args.from) {
    conds.push(`date >= ?${i++}`);
    binds.push(args.from);
  }
  if (args.to) {
    conds.push(`date <= ?${i++}`);
    binds.push(args.to);
  }
  if (args.source) {
    conds.push(`source = ?${i++}`);
    binds.push(args.source);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.min(Number(args.limit) || 200, 1000);
  binds.push(limit);
  const { results } = await env.DB.prepare(
    `SELECT source, account, date, description, memo, amount, currency, status, type, category
       FROM transactions ${where}
      ORDER BY date DESC
      LIMIT ?${i}`
  )
    .bind(...binds)
    .all();
  return { count: results.length, transactions: results };
}

async function getFinancialSummary(env: Env, userId: string, args: Args) {
  const from = (args.from as string) ?? firstOfThisMonth();
  const to = (args.to as string) ?? today();
  const totals = await env.DB.prepare(
    `SELECT
        COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN amount < 0 THEN amount END), 0) AS total_out,
        COALESCE(SUM(amount), 0) AS net,
        COUNT(*) AS count
       FROM transactions
      WHERE user_id = ?1 AND date >= ?2 AND date <= ?3`
  )
    .bind(userId, from, to)
    .first();
  const { results: byCategory } = await env.DB.prepare(
    `SELECT COALESCE(category, 'Uncategorized') AS category,
            ROUND(SUM(amount), 2) AS total,
            COUNT(*) AS count
       FROM transactions
      WHERE user_id = ?1 AND date >= ?2 AND date <= ?3 AND amount < 0
      GROUP BY category
      ORDER BY total ASC`
  )
    .bind(userId, from, to)
    .all();
  const { results: bySource } = await env.DB.prepare(
    `SELECT COALESCE(source, 'unknown') AS source,
            ROUND(SUM(CASE WHEN amount > 0 THEN amount END), 2) AS total_in,
            ROUND(SUM(CASE WHEN amount < 0 THEN amount END), 2) AS total_out,
            COUNT(*) AS count
       FROM transactions
      WHERE user_id = ?1 AND date >= ?2 AND date <= ?3
      GROUP BY source
      ORDER BY total_out ASC`
  )
    .bind(userId, from, to)
    .all();
  return { from, to, totals, spend_by_category: byCategory, by_source: bySource };
}

async function getScrapeStatus(env: Env, userId: string) {
  // Per-user freshness: derived from THIS user's own rows, so a user with no
  // connected accounts correctly sees "no data" rather than another user's scrape.
  const mine = await env.DB.prepare(
    `SELECT COUNT(*) AS transaction_count,
            MAX(scraped_at) AS last_updated,
            COUNT(DISTINCT source) AS account_sources
       FROM transactions WHERE user_id = ?1`
  )
    .bind(userId)
    .first<{ transaction_count: number; last_updated: string | null; account_sources: number }>();
  const count = mine?.transaction_count ?? 0;
  return {
    transaction_count: count,
    last_updated: mine?.last_updated ?? null,
    account_sources: mine?.account_sources ?? 0,
    note:
      count === 0
        ? "No transactions for this account yet — no financial sources are connected/scraped for this user."
        : "Data is refreshed by the scheduled scraper.",
  };
}

async function callTool(env: Env, userId: string, name: string, args: Args) {
  switch (name) {
    case "get_transactions":
      return getTransactions(env, userId, args);
    case "search_transactions":
      return searchTransactions(env, userId, args);
    case "get_financial_summary":
      return getFinancialSummary(env, userId, args);
    case "get_scrape_status":
      return getScrapeStatus(env, userId);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------- JSON-RPC / MCP plumbing ----------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

function rpcResult(id: unknown, result: unknown): object {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id: unknown, code: number, message: string): object {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleRpc(env: Env, userId: string, msg: any): Promise<object | null> {
  const { id, method, params } = msg ?? {};
  // Notifications (no id) — acknowledge with no response body.
  if (id === undefined || id === null) return null;

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = params?.name as string;
      const args = (params?.arguments ?? {}) as Args;
      try {
        const data = await callTool(env, userId, name, args);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        });
      } catch (err: any) {
        return rpcResult(id, {
          isError: true,
          content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }],
        });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

// ---------- MCP API handler (only reached with a valid OAuth token) ----------

/** The MCP endpoint. The OAuthProvider validates the token before this runs and
 *  passes the grant's props (incl. userId) via ctx.props. */
class McpApiHandler extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const env = this.env;
    const props = ((this.ctx as unknown as { props?: { userId?: string } }).props) ?? {};
    const userId = props.userId;

    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method === "GET") {
      return new Response("SSE stream not supported", { status: 405, headers: CORS });
    }
    if (!userId) {
      return new Response(JSON.stringify(rpcError(null, -32001, "No user in token")), {
        status: 401,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify(rpcError(null, -32700, "Parse error")), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    if (Array.isArray(body)) {
      const responses = (await Promise.all(body.map((m) => handleRpc(env, userId, m)))).filter(
        (r) => r !== null
      );
      return new Response(JSON.stringify(responses), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const response = await handleRpc(env, userId, body);
    if (response === null) return new Response(null, { status: 202, headers: CORS });
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
}

// ---------- OAuth login UI (delegates identity to Google) ----------

function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}
/** Decode a JWT payload (we trust it: it came directly from Google's token endpoint over TLS). */
function jwtPayload(jwt: string): any {
  return JSON.parse(b64urlDecode(jwt.split(".")[1]));
}

/** Map a verified Google email to a stable moneymcp user id (creating one on first login). */
async function resolveUser(env: Env, email: string): Promise<string> {
  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1`)
    .bind(email)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, created_at) VALUES (?1, ?2, datetime('now'))`
  )
    .bind(id, email)
    .run();
  return id;
}

const GOOGLE_CALLBACK_PATH = "/callback/google";

const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Step 1: Claude sends the user here. Bounce to Google to sign in.
    if (url.pathname === "/authorize") {
      let authReq: any;
      try {
        authReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      } catch {
        return new Response("Invalid authorization request (unknown or unregistered client)", {
          status: 400,
        });
      }
      const g = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      g.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
      g.searchParams.set("redirect_uri", url.origin + GOOGLE_CALLBACK_PATH);
      g.searchParams.set("response_type", "code");
      g.searchParams.set("scope", "openid email");
      g.searchParams.set("prompt", "select_account");
      g.searchParams.set("state", b64urlEncode(JSON.stringify(authReq)));
      return Response.redirect(g.toString(), 302);
    }

    // Step 2: Google redirects back. Verify identity, then issue our auth code.
    if (url.pathname === GOOGLE_CALLBACK_PATH) {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) return new Response("Missing code/state", { status: 400 });
      const authReq = JSON.parse(b64urlDecode(state));

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: url.origin + GOOGLE_CALLBACK_PATH,
          grant_type: "authorization_code",
        }),
      });
      const tokenJson = (await tokenRes.json()) as { id_token?: string; error?: string };
      if (!tokenJson.id_token) {
        return new Response(`Google token exchange failed: ${tokenJson.error ?? "unknown"}`, {
          status: 502,
        });
      }
      const claims = jwtPayload(tokenJson.id_token);
      if (!claims.email || claims.email_verified === false) {
        return new Response("Google email not verified", { status: 403 });
      }

      const userId = await resolveUser(env, claims.email);
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: authReq,
        userId,
        metadata: { email: claims.email },
        scope: authReq.scope ?? ["read"],
        props: { userId, email: claims.email },
      });
      return Response.redirect(redirectTo, 302);
    }

    if (url.pathname === "/") {
      return new Response(JSON.stringify({ ok: true, server: SERVER_INFO }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: McpApiHandler as any,
  defaultHandler: defaultHandler as any,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["read"],
});
