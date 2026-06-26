# Changelog

All notable changes to moneymcp are recorded here. Newest first.

This project follows [Keep a Changelog](https://keepachangelog.com/) conventions and (once it ships) [Semantic Versioning](https://semver.org/). Until the first release, changes are grouped under **Unreleased**.

Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

---

## [Unreleased]

### Changed
- **Major architecture pivot (2026-06-26):** from a local stdio live-scraper to a **cloud, free-tier, store-backed** design — GitHub Actions scraper → Cloudflare D1 (SQLite) → Cloudflare Workers MCP server (Streamable HTTP), reachable from the Claude mobile app as a custom connector, with a Telegram OTP relay for Hapoalim's SMS 2FA. Supersedes the local-only and stdio decisions. See [decisions.md](./decisions.md).
- Discovered Hapoalim enforces new-device SMS 2FA on every login (verified via a real scrape attempt + failure screenshot); credentials confirmed valid. This drove the decoupled scrape/store/query design.

### Added
- **Remote MCP server** (`worker/index.ts`): Cloudflare Worker speaking MCP Streamable HTTP (hand-rolled JSON-RPC, bearer-token auth), exposing read tools `get_transactions`, `search_transactions`, `get_financial_summary`, `get_scrape_status` backed by Cloudflare D1. Built and **verified locally** via `wrangler dev` + seeded local D1 (full MCP handshake + each tool). Not yet deployed. (2026-06-26)
- **D1 schema** (`worker/schema.sql`): `transactions` (dedupe-hash keyed) + `scrape_runs`; local seed data (`worker/seed.sql`). (2026-06-26)
- Repo restructured into `worker/` (Cloudflare Worker) and `scraper/` (Node scraper, WIP); removed dead Python scaffold `main.py`. (2026-06-26)
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
