/**
 * moneymcp — remote MCP server (Cloudflare Worker, Streamable HTTP).
 *
 * Exposes READ-ONLY tools over the transactions stored in D1. Querying never
 * touches the bank — the scraper (separate, GitHub Actions) fills D1.
 *
 * Transport: MCP Streamable HTTP. A single endpoint handles JSON-RPC requests
 * over POST and returns application/json responses (stateless — no sessions,
 * no Durable Objects). Auth: a bearer token (MCP_AUTH_TOKEN).
 */

export interface Env {
  DB: D1Database;
  MCP_AUTH_TOKEN: string;
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

async function getTransactions(env: Env, args: Args) {
  const from = (args.from as string) ?? firstOfThisMonth();
  const to = (args.to as string) ?? today();
  const limit = Math.min(Number(args.limit) || 200, 1000);
  const { results } = await env.DB.prepare(
    `SELECT account, date, description, memo, amount, currency, status, type, category
       FROM transactions
      WHERE date >= ?1 AND date <= ?2
      ORDER BY date DESC
      LIMIT ?3`
  )
    .bind(from, to, limit)
    .all();
  return { from, to, count: results.length, transactions: results };
}

async function searchTransactions(env: Env, args: Args) {
  const conds: string[] = [];
  const binds: unknown[] = [];
  let i = 1;
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
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.min(Number(args.limit) || 200, 1000);
  binds.push(limit);
  const { results } = await env.DB.prepare(
    `SELECT account, date, description, memo, amount, currency, status, type, category
       FROM transactions ${where}
      ORDER BY date DESC
      LIMIT ?${i}`
  )
    .bind(...binds)
    .all();
  return { count: results.length, transactions: results };
}

async function getFinancialSummary(env: Env, args: Args) {
  const from = (args.from as string) ?? firstOfThisMonth();
  const to = (args.to as string) ?? today();
  const totals = await env.DB.prepare(
    `SELECT
        COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN amount < 0 THEN amount END), 0) AS total_out,
        COALESCE(SUM(amount), 0) AS net,
        COUNT(*) AS count
       FROM transactions
      WHERE date >= ?1 AND date <= ?2`
  )
    .bind(from, to)
    .first();
  const { results: byCategory } = await env.DB.prepare(
    `SELECT COALESCE(category, 'Uncategorized') AS category,
            ROUND(SUM(amount), 2) AS total,
            COUNT(*) AS count
       FROM transactions
      WHERE date >= ?1 AND date <= ?2 AND amount < 0
      GROUP BY category
      ORDER BY total ASC`
  )
    .bind(from, to)
    .all();
  return { from, to, totals, spend_by_category: byCategory };
}

async function getScrapeStatus(env: Env) {
  const last = await env.DB.prepare(
    `SELECT started_at, finished_at, success, inserted, error
       FROM scrape_runs ORDER BY id DESC LIMIT 1`
  ).first();
  const lastSuccess = await env.DB.prepare(
    `SELECT finished_at FROM scrape_runs WHERE success = 1 ORDER BY id DESC LIMIT 1`
  ).first<{ finished_at: string }>();
  return {
    last_run: last ?? null,
    last_successful_scrape: lastSuccess?.finished_at ?? null,
  };
}

async function callTool(env: Env, name: string, args: Args) {
  switch (name) {
    case "get_transactions":
      return getTransactions(env, args);
    case "search_transactions":
      return searchTransactions(env, args);
    case "get_financial_summary":
      return getFinancialSummary(env, args);
    case "get_scrape_status":
      return getScrapeStatus(env);
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

async function handleRpc(env: Env, msg: any): Promise<object | null> {
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
        const data = await callTool(env, name, args);
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    // Health check / friendly GET.
    if (request.method === "GET") {
      return new Response(JSON.stringify({ ok: true, server: SERVER_INFO }), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Auth: Bearer token.
    const auth = request.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!env.MCP_AUTH_TOKEN || token !== env.MCP_AUTH_TOKEN) {
      return new Response(JSON.stringify(rpcError(null, -32001, "Unauthorized")), {
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

    // Support JSON-RPC batches and single messages.
    if (Array.isArray(body)) {
      const responses = (await Promise.all(body.map((m) => handleRpc(env, m)))).filter(
        (r) => r !== null
      );
      return new Response(JSON.stringify(responses), {
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const response = await handleRpc(env, body);
    if (response === null) {
      // Notification — 202 with no body.
      return new Response(null, { status: 202, headers: CORS });
    }
    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json", ...CORS },
    });
  },
};
