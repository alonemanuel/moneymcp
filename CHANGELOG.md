# Changelog

All notable changes to moneymcp are recorded here. Newest first.

This project follows [Keep a Changelog](https://keepachangelog.com/) conventions and (once it ships) [Semantic Versioning](https://semver.org/). Until the first release, changes are grouped under **Unreleased**.

Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

---

## [Unreleased]

### Added
- **React + shadcn/ui dashboard** (`web/`, 2026-06-27): real Vite + React + Tailwind + shadcn app (dark, sidebar nav) served from the Worker as static assets at `/`. **Accounts view** groups Bank accounts vs Credit cards, showing each account/card **number**, balance, last transaction, and per-account sync history. **Transactions view** is a searchable table of all transactions. API/OAuth/MCP paths are worker-first; the SPA handles 401 by redirecting to `/app/login`. Replaces the old inline-HTML dashboard.
- **Balances + per-account history** (2026-06-27): scraper captures account balance snapshots (`balances` table); `get_balances` tool; dashboard shows balance + last-transaction per account and an expandable per-account sync history (rows/status/duration). Scrape cron reduced to once daily.
- **Web dashboard** (`/app`, 2026-06-27): Google-login-gated page showing connected institutions, per-account status + last sync, transaction count, and a **"Sync now"** button that triggers the scrape via GitHub `workflow_dispatch` (Worker → GitHub API). Live progress polled from `sync_runs`. Session via signed cookie + KV; reuses the existing Google client.
- **Sync engine**: `connections` (per-user linked institutions) + `sync_runs` (live progress) tables; scraper writes live per-account progress and finalizes done/error; new `get_connections` tool and `latest_sync` in `get_scrape_status`.
- **Multi-user via OAuth 2.1 (Google login), LIVE** (2026-06-27): MCP moved to `/mcp`, protected by `@cloudflare/workers-oauth-provider` (DCR + PKCE + discovery), identity delegated to Google. Verified email → `users` row (auto-provisioned on first login); every query scoped to `ctx.props.userId`. Per-user data isolation (`user_id` on transactions; existing data → `alon`). Supersedes the single-user `?key=` token. KV `OAUTH_KV` for tokens; Google client id/secret as Worker secrets.
- **Automatic Hapoalim refresh, LIVE** (`.github/workflows/scrape.yml`): GitHub Actions scrapes twice daily and writes to D1 — free, no hardware, no OTP. Trusted profile stored as base64-split GitHub secrets; `--no-sandbox` for CI Chrome. Verified end-to-end (28 txns written from CI). Doubles as a trust canary. (2026-06-27)
- **Multi-provider scraping** (`scraper/providers.ts`): Hapoalim + Isracard + Max, each enabled by its own env credentials, scraped into one D1 and tagged with a new `source` column. MCP tools now surface `source`, support a `source` filter, and the summary includes a by-source breakdown. (2026-06-26)
- **Isracard loaded** (86 transactions): required a visible browser (`SHOW_BROWSER=1`) + `--disable-blink-features=AutomationControlled` + logged-in profile to beat Akamai bot-protection. Generalized `login.ts` to bootstrap any provider's trusted session. See [decisions.md](./decisions.md). (2026-06-26)

### Changed
- **Major architecture pivot (2026-06-26):** from a local stdio live-scraper to a **cloud, free-tier, store-backed** design — GitHub Actions scraper → Cloudflare D1 (SQLite) → Cloudflare Workers MCP server (Streamable HTTP), reachable from the Claude mobile app as a custom connector, with a Telegram OTP relay for Hapoalim's SMS 2FA. Supersedes the local-only and stdio decisions. See [decisions.md](./decisions.md).
- Discovered Hapoalim enforces new-device SMS 2FA on every login (verified via a real scrape attempt + failure screenshot); credentials confirmed valid. This drove the decoupled scrape/store/query design.

### Added
- **Remote MCP server** (`worker/index.ts`): Cloudflare Worker speaking MCP Streamable HTTP (hand-rolled JSON-RPC, bearer-token auth), exposing read tools `get_transactions`, `search_transactions`, `get_financial_summary`, `get_scrape_status` backed by Cloudflare D1. Built and **verified locally** via `wrangler dev` + seeded local D1 (full MCP handshake + each tool). Not yet deployed. (2026-06-26)
- **D1 schema** (`worker/schema.sql`): `transactions` (dedupe-hash keyed) + `scrape_runs`; local seed data (`worker/seed.sql`). (2026-06-26)
- **Scraper** (`scraper/`): scheduled Hapoalim scraper that upserts into D1 over the D1 REST API, with a stable dedupe hash (unit-tested), a D1 HTTP client, and a one-time trusted-session login bootstrap (`scraper/src/login.ts`) for Hapoalim's SMS 2FA. Code-complete + typechecks; bank/D1 path not yet verified end-to-end. (2026-06-26)
- Dropped unused deps `@modelcontextprotocol/sdk` and `zod` (the Worker hand-rolls JSON-RPC); added `puppeteer`. npm scripts for scrape/login/worker. (2026-06-26)
- Repo restructured into `worker/` (Cloudflare Worker) and `scraper/` (Node scraper); removed dead Python scaffold `main.py`. (2026-06-26)
- **POC (superseded)** stdio MCP server scraping Hapoalim live — relocated to `scraper/` as the basis for the scheduled scraper. (2026-06-26)
- TypeScript project setup: `package.json`, `tsconfig.json`, build (`tsc`) / dev (`tsx`) scripts, `.env.example`. (2026-06-26)
- Dependencies: `@modelcontextprotocol/sdk`, `israeli-bank-scrapers`, `zod`. (2026-06-26)
- Project documentation set: `README.md`, `stack.md`, `design.md`, `decisions.md`, `CHANGELOG.md`, and `CLAUDE.md` with rules to keep them in sync. (2026-06-26)

### Changed
- Pivoted the project from the initial Python PyCharm scaffold to a TypeScript/Node.js MCP server. See [decisions.md](./decisions.md). (2026-06-26)
- Bumped required Node to ≥ 22.13.0 (`israeli-bank-scrapers@6` requirement). (2026-06-26)

### Notes
- Verified the server starts and registers `get_transactions` via a manual MCP handshake smoke test (no real bank call yet).
- The original Python scaffold (`main.py`, `.idea/`) is dead and slated for removal; not yet deleted.
