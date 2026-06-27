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
  GITHUB_TOKEN: string;
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
      "Report this user's data freshness: transaction count, when it was last updated, and the latest sync run's live status (running/done/error with per-account detail). Use this to judge freshness or whether a refresh is in progress.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_connections",
    description:
      "List the financial institutions this user has connected (source, status, last sync time, last transaction date, current balance). An empty list means no accounts are connected yet.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_balances",
    description:
      "Current account balances (latest snapshot per account), captured at each sync. Use for 'how much do I have' / net worth questions.",
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
  const lastSync = await env.DB.prepare(
    `SELECT status, detail, inserted, started_at, finished_at
       FROM sync_runs WHERE user_id = ?1 ORDER BY id DESC LIMIT 1`
  )
    .bind(userId)
    .first();
  return {
    transaction_count: count,
    last_updated: mine?.last_updated ?? null,
    account_sources: mine?.account_sources ?? 0,
    latest_sync: lastSync ?? null,
    note:
      count === 0
        ? "No transactions for this account yet — no financial sources are connected/scraped for this user."
        : "Data is refreshed by the scheduled scraper.",
  };
}

async function getConnections(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT c.source, c.status, c.last_sync_at, c.last_error,
            (SELECT MAX(t.date) FROM transactions t
               WHERE t.user_id = c.user_id AND t.source = c.source) AS last_transaction,
            (SELECT b.balance FROM balances b
               WHERE b.user_id = c.user_id AND b.source = c.source
               ORDER BY b.id DESC LIMIT 1) AS balance
       FROM connections c
      WHERE c.user_id = ?1 ORDER BY c.source`
  )
    .bind(userId)
    .all();
  return { count: results.length, connections: results };
}

async function getBalances(env: Env, userId: string) {
  // Latest balance snapshot per source/account.
  const { results } = await env.DB.prepare(
    `SELECT source, account, balance, scraped_at FROM balances b
      WHERE user_id = ?1 AND id IN (
        SELECT MAX(id) FROM balances WHERE user_id = ?1 GROUP BY source, account
      ) ORDER BY source`
  )
    .bind(userId)
    .all();
  return { count: results.length, balances: results };
}

async function getSyncHistory(env: Env, userId: string, source: string) {
  const { results } = await env.DB.prepare(
    `SELECT source, status, inserted, started_at, finished_at
       FROM sync_runs WHERE user_id = ?1 AND source = ?2
      ORDER BY id DESC LIMIT 20`
  )
    .bind(userId, source)
    .all();
  return results;
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
    case "get_connections":
      return getConnections(env, userId);
    case "get_balances":
      return getBalances(env, userId);
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

// ---------- web dashboard: session (cookie + KV) + GitHub dispatch ----------

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days

function getCookie(request: Request, name: string): string | null {
  const c = request.headers.get("Cookie") ?? "";
  const m = c.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? m[1] : null;
}
async function getSession(
  request: Request,
  env: Env
): Promise<{ userId: string; email: string } | null> {
  const sid = getCookie(request, "mm_session");
  if (!sid) return null;
  const raw = await env.OAUTH_KV.get(`sess:${sid}`);
  return raw ? JSON.parse(raw) : null;
}
async function createSession(env: Env, userId: string, email: string): Promise<string> {
  const sid = crypto.randomUUID();
  await env.OAUTH_KV.put(`sess:${sid}`, JSON.stringify({ userId, email }), {
    expirationTtl: SESSION_TTL,
  });
  return sid;
}
function redirectToGoogleLogin(env: Env, origin: string): Response {
  const g = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  g.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  g.searchParams.set("redirect_uri", origin + GOOGLE_CALLBACK_PATH);
  g.searchParams.set("response_type", "code");
  g.searchParams.set("scope", "openid email");
  g.searchParams.set("prompt", "select_account");
  g.searchParams.set("state", b64urlEncode(JSON.stringify({ w: 1 }))); // web-login marker
  return Response.redirect(g.toString(), 302);
}
/** Trigger the per-user scrape via GitHub Actions workflow_dispatch. */
async function dispatchScrape(env: Env, userId: string): Promise<boolean> {
  const res = await fetch(
    "https://api.github.com/repos/alonemanuel/moneymcp/actions/workflows/scrape.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "moneymcp-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { user_id: userId } }),
    }
  );
  return res.status === 204;
}

const DASHBOARD_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>moneymcp</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;color:#1a1d23;background:#fff}
  h1{font-size:1.4rem;margin-bottom:.2rem}.muted{color:#6b7280;font-size:.85rem}
  .acct{border:1px solid #e5e7eb;border-radius:10px;margin:.6rem 0;overflow:hidden}
  .hdr{padding:.9rem 1rem;display:flex;justify-content:space-between;align-items:center;cursor:pointer}
  .hdr:hover{background:#f9fafb}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:.5rem}
  .ok{background:#22c55e}.err{background:#ef4444}.none{background:#9ca3af}
  .bal{font-variant-numeric:tabular-nums;font-weight:600}
  .detail{padding:0 1rem;border-top:1px solid #f0f0f0}
  table{width:100%;border-collapse:collapse;font-size:.82rem;margin:.4rem 0}
  th,td{text-align:left;padding:.35rem .3rem;border-bottom:1px solid #f3f4f6}
  th{color:#6b7280;font-weight:500}
  button{background:#2563eb;color:#fff;border:0;border-radius:8px;padding:.6rem 1rem;font-size:1rem;cursor:pointer;margin-top:.5rem}
  button:disabled{opacity:.5;cursor:default}
  #status{margin-top:.8rem;font-size:.9rem;color:#374151;min-height:1.2em}
</style></head><body>
<h1>moneymcp</h1>
<div class="muted" id="who"></div>
<div id="conns"></div>
<button id="sync" onclick="doSync()">Sync now</button>
<div id="status"></div>
<script>
var $=function(id){return document.getElementById(id);};
var expanded={};
function fmt(t){ if(!t) return '—'; var d=new Date(t); return isNaN(d)?t:d.toLocaleString(); }
function money(n){ return (n==null)?'—':'₪'+Number(n).toLocaleString(undefined,{maximumFractionDigits:2}); }
function esc(s){ return String(s).replace(/[<>&]/g,function(c){return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c];}); }
async function load(){
  var r=await fetch('/app/api/status'); if(!r.ok){ $('status').textContent='Session expired — reload the page.'; return; }
  var d=await r.json();
  $('who').textContent=d.email;
  var html='';
  if(!d.connections||d.connections.length===0){
    html='<div class="acct"><div class="hdr"><span><span class="dot none"></span>No accounts connected yet</span></div></div>';
  } else {
    d.connections.forEach(function(c){
      var cls=c.status==='connected'?'ok':(c.status==='error'?'err':'none');
      html+='<div class="acct"><div class="hdr" onclick="toggle(\\''+c.source+'\\')">'
        +'<span><span class="dot '+cls+'"></span><b>'+esc(c.source)+'</b></span>'
        +'<span class="bal">'+money(c.balance)+' <span class="muted">· last txn '+fmt(c.last_transaction)+'</span></span>'
        +'</div><div class="detail" id="d_'+c.source+'"></div></div>';
    });
  }
  $('conns').innerHTML=html;
  Object.keys(expanded).forEach(function(s){ if(expanded[s]) loadSyncs(s); });
  var s=d.latest_sync, line='';
  if(s){ line = s.status==='running' ? ('⏳ syncing '+(s.source||'')+'…') : (s.status==='done' ? '✓ synced' : '⚠️ '+(s.detail||s.status)); }
  $('status').textContent=(line?line+' · ':'')+(d.transaction_count||0)+' transactions';
  $('sync').disabled = !!(s && s.status==='running');
}
function toggle(src){ expanded[src]=!expanded[src]; if(expanded[src]) loadSyncs(src); else { var e=$('d_'+src); if(e) e.innerHTML=''; } }
async function loadSyncs(src){
  var el=$('d_'+src); if(!el) return; if(!el.innerHTML) el.innerHTML='<div class="muted">loading…</div>';
  var r=await fetch('/app/api/syncs?source='+encodeURIComponent(src)); var a=await r.json();
  if(!a.length){ el.innerHTML='<div class="muted" style="padding:.5rem 0">no syncs yet</div>'; return; }
  var t='<table><tr><th>started</th><th>rows</th><th>status</th><th>duration</th></tr>';
  a.forEach(function(x){
    var dur=(x.started_at&&x.finished_at)?Math.max(0,Math.round((new Date(x.finished_at)-new Date(x.started_at))/1000))+'s':'—';
    t+='<tr><td>'+fmt(x.started_at)+'</td><td>'+(x.inserted==null?'—':x.inserted)+'</td><td>'+esc(x.status)+'</td><td>'+dur+'</td></tr>';
  });
  el.innerHTML=t+'</table>';
}
async function doSync(){ $('sync').disabled=true; $('status').textContent='Queued… (a scrape takes ~1–2 min to start)'; await fetch('/app/sync',{method:'POST'}); poll(); }
function poll(){ load(); setTimeout(poll,4000); }
poll();
</script></body></html>`;

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
      const decoded = JSON.parse(b64urlDecode(state));

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

      // Web-dashboard login (state marker {w:1}) → set a session cookie.
      if (decoded.w === 1) {
        const sid = await createSession(env, userId, claims.email);
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/app",
            "Set-Cookie": `mm_session=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL}`,
          },
        });
      }

      // Otherwise it's the MCP OAuth flow (decoded is the AuthRequest).
      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: decoded,
        userId,
        metadata: { email: claims.email },
        scope: decoded.scope ?? ["read"],
        props: { userId, email: claims.email },
      });
      return Response.redirect(redirectTo, 302);
    }

    // ----- web dashboard -----
    if (url.pathname === "/app") {
      const sess = await getSession(request, env);
      if (!sess) return redirectToGoogleLogin(env, url.origin);
      return new Response(DASHBOARD_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/app/api/status") {
      const sess = await getSession(request, env);
      if (!sess) return new Response("unauthorized", { status: 401 });
      const conns = await getConnections(env, sess.userId);
      const status = await getScrapeStatus(env, sess.userId);
      return new Response(JSON.stringify({ email: sess.email, ...conns, ...status }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/app/api/syncs") {
      const sess = await getSession(request, env);
      if (!sess) return new Response("unauthorized", { status: 401 });
      const source = url.searchParams.get("source") ?? "";
      const history = await getSyncHistory(env, sess.userId, source);
      return new Response(JSON.stringify(history), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/app/sync" && request.method === "POST") {
      const sess = await getSession(request, env);
      if (!sess) return new Response("unauthorized", { status: 401 });
      const ok = await dispatchScrape(env, sess.userId);
      return new Response(JSON.stringify({ dispatched: ok }), {
        status: ok ? 202 : 502,
        headers: { "Content-Type": "application/json" },
      });
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
