# Stack

**This file is the single source of truth for the moneymcp tech stack.** Anything about the runtime, languages, dependencies, data sources, storage, secrets, testing, build, or deployment lives here. If any of it changes, this file must change in the same commit, and a decision should be logged in [decisions.md](./decisions.md) when the change is non-trivial.

Status legend: ✅ in use · 🟡 planned / in progress · ❌ explicitly rejected (see decisions.md)

---

## Architecture (the big picture)

moneymcp is **all cloud, all free-tier**, and split into three decoupled parts so that querying never touches the bank:

```
iPhone / any Claude client
   → Anthropic cloud
   → [ MCP server ]  (Cloudflare Worker, Streamable HTTP + token auth)  ── reads ──┐
                                                                                    │
   [ scraper ]  (GitHub Actions cron, Puppeteer + israeli-bank-scrapers)            │
        │  upsert + dedupe                                                          │
        ▼                                                                           │
   [ Cloudflare D1 ]  (SQLite)  ◄──────────────────────────────────────────────────┘
        ▲
        └─ Telegram bot ⇄ user  (only when Hapoalim needs an SMS OTP)
```

- **Scrape** runs on a schedule (GitHub Actions), writes transactions to D1.
- **Query** is a Cloudflare Worker MCP server that only reads D1 — instant, never contacts the bank.
- The whole thing is reachable from Anthropic's cloud (so the iPhone Claude app works) via the Worker's public HTTPS URL, gated by a token.

See [decisions.md](./decisions.md) → "Architecture: scheduled-scrape-into-store + remote MCP (cloud, free-tier)".

## Runtime & language

| Item | Choice | Status |
|------|--------|--------|
| Language | TypeScript | ✅ |
| Scraper runtime | Node.js **≥ 22.13.0** (required by `israeli-bank-scrapers@6`) | ✅ |
| MCP server runtime | Cloudflare Workers (V8 isolate, not Node) | 🟡 |
| Module system | ESM | ✅ |
| Package manager | npm | ✅ |

## Components & hosting (all free tier)

| Component | Tech | Hosting (free) | Status |
|-----------|------|----------------|--------|
| MCP server | TS, Streamable-HTTP JSON-RPC (hand-rolled, no Durable Objects) | **Cloudflare Workers** | ✅ **deployed**: `https://moneymcp.alonemanuel95.workers.dev` (auth via `?key=` or Bearer) |
| Store | SQLite (schema `worker/schema.sql`) | **Cloudflare D1** | ✅ **provisioned** (`moneymcp`, id `d6e10474…`); loaded with real data |
| Scraper | Node + Puppeteer + `israeli-bank-scrapers`; multi-provider (`scraper/providers.ts`) | run manually on Mac (cloud cron deferred) | ✅ Hapoalim + Isracard verified, loaded to D1; Max parked; 🟡 no scheduled cron yet |
| OTP relay / notifications | Telegram Bot API | **Telegram** (free) | 🟡 |
| Client connector | Custom connector (remote MCP) | **Claude app** (Free/Pro/Max) | 🟡 |

No service requires a credit card.

## MCP transport

| Item | Choice | Status |
|------|--------|--------|
| Transport | **Streamable HTTP** (SSE is being deprecated by Anthropic) | 🟡 |
| Auth | Bearer token (later: OAuth) — only the user's Claude account can reach the endpoint | 🟡 |

> ❌ stdio transport was the POC approach; rejected for the product because the iPhone Claude app cannot launch a local process. Anthropic's cloud connects to the server over HTTPS. See decisions.md.

## Tools exposed (read-only, served from D1)

| Tool | Purpose | Status |
|------|---------|--------|
| `get_transactions` | List transactions in a date range / window | ✅ built + locally tested |
| `search_transactions` | Free-text / merchant / amount search | ✅ built + locally tested |
| `get_financial_summary` | Totals, by-category, in vs out for a period | ✅ built + locally tested |
| `get_scrape_status` | Last successful scrape time + freshness | ✅ built + locally tested |

The **agent** decides what is "significant" — tools return data, not judgments. (Tool surface borrows from `glekner/il-bank-mcp`.)

## Data source

| Dependency | Role | Status |
|------------|------|--------|
| `israeli-bank-scrapers` (`^6.7`) | Scrapes Israeli banks & credit cards (used by the scraper only) | ✅ |
| Puppeteer (`^24`) | Headless browser driven by the scraper (downloads Chromium) | ✅ |

**moneyman** is *not* a dependency — reference only for patterns. The POC `@modelcontextprotocol/sdk` dependency is being dropped: the Worker hand-rolls Streamable HTTP, and the scraper doesn't speak MCP.

## Data & storage

| Item | Choice | Status |
|------|--------|--------|
| Database | **Cloudflare D1** (SQLite). Schema: a `transactions` table keyed by a dedupe hash (account + date + amount + identifier). | 🟡 |
| Freshness | A `scrape_runs` / metadata row records last successful scrape time. | 🟡 |

## Secrets & credentials

Everything sensitive lives as **cloud secrets**, never in code or logs:

| Secret | Where | Purpose | Status |
|--------|-------|---------|--------|
| `HAPOALIM_USER_CODE`/`PASSWORD`; `ISRACARD_ID`/`CARD6`/`PASSWORD`; `MAX_USERNAME`/`PASSWORD` | env / GitHub Actions secrets | Per-provider login (scraper only). A provider scrapes only if all its vars are set. | ✅ used locally |
| Trusted browser profile (cookies/localStorage) | Encrypted GitHub secret / Actions cache | Keeps Hapoalim treating the scraper as a known device → fewer OTP challenges | 🟡 |
| `D1` write credentials (Cloudflare API token + account/DB id) | GitHub Actions secrets | Scraper writes to D1 via the D1 HTTP API | 🟡 |
| `MCP_AUTH_TOKEN` | Cloudflare Worker secret | Gates the MCP endpoint | 🟡 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | GitHub Actions secrets | OTP relay / notifications | 🟡 |

> **Accepted trade-off:** because there is no home box, the bank password lives in GitHub Actions secrets (cloud). Mitigated by least-privilege secrets and never logging them. See decisions.md → "Cloud-only execution; credentials in cloud secrets".

## Build & tooling

| Item | Choice | Status |
|------|--------|--------|
| Worker dev/deploy | `wrangler` (`wrangler dev` locally with local D1; `wrangler deploy`) | 🟡 |
| Scraper build | `tsc` / `tsx` | ✅ |
| Type checking | `tsc --noEmit` | ✅ |
| Linting / formatting | TBD | 🟡 |

## Testing

| Item | Choice | Status |
|------|--------|--------|
| Worker/tools | Test against local D1 seeded with sample transactions; verify via MCP handshake | 🟡 |
| Scraper | Unit-test transform/dedupe with the scraper mocked; never hit real banks in CI | 🟡 |

## Deployment

| Item | Choice | Status |
|------|--------|--------|
| MCP server | `wrangler deploy` → Cloudflare Workers (public HTTPS URL) | 🟡 |
| Scraper | GitHub Actions scheduled workflow (e.g. twice daily) | 🟡 |
| Client | Added to the Claude app as a custom connector (remote MCP) | 🟡 |
