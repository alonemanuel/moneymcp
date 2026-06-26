# Stack

**This file is the single source of truth for the moneymcp tech stack.** Anything about the runtime, languages, dependencies, data sources, storage, secrets, testing, build, or deployment lives here. If any of it changes, this file must change in the same commit, and a decision should be logged in [decisions.md](./decisions.md) when the change is non-trivial.

Status legend: ✅ in use · 🟡 planned / not yet implemented · ❌ explicitly rejected (see decisions.md)

---

## Runtime & language

| Item | Choice | Status |
|------|--------|--------|
| Language | TypeScript | 🟡 |
| Runtime | Node.js (LTS) | 🟡 |
| Module system | ESM | 🟡 |
| Package manager | npm | 🟡 |

> The repo was bootstrapped from a Python PyCharm scaffold (`main.py`, `.idea/`). The project pivoted to TypeScript to match the Node-based scraping ecosystem (see [decisions.md](./decisions.md) → "Runtime: TypeScript over Python"). The Python scaffold is dead and slated for removal.

## Core dependencies

| Dependency | Role | Status |
|------------|------|--------|
| `@modelcontextprotocol/sdk` | MCP server implementation (exposes tools to agents) | 🟡 |
| `israeli-bank-scrapers` | Scrapes Israeli banks & credit-card companies (the data source) | 🟡 |
| Puppeteer | Headless browser driven by `israeli-bank-scrapers` (transitive dep) | 🟡 |

**moneyman** is *not* a runtime dependency. It is used only as a reference for account/config modeling. See [decisions.md](./decisions.md) → "Data source: israeli-bank-scrapers library over moneyman app".

## Transport

| Item | Choice | Status |
|------|--------|--------|
| MCP transport | stdio | 🟡 |

Clients (Claude Desktop, Claude Code, etc.) launch moneymcp as a subprocess and speak MCP over stdio.

## Data & storage

| Item | Choice | Status |
|------|--------|--------|
| Database | **None.** Data is scraped on demand and returned to the caller; nothing is persisted by default. | 🟡 |
| Caching | TBD (none yet) | 🟡 |

If a persistence layer is ever added, it must be recorded here and justified in decisions.md.

## Secrets & credentials

moneymcp handles real bank credentials. The rules:

- Credentials are supplied via **environment variables** (loaded from a local `.env`, git-ignored).
- Credentials are **never** committed, **never** logged, and **never** sent anywhere except the user's own financial institutions during scraping.
- An `.env.example` documents required variable names with no real values.

Per-institution variables follow `israeli-bank-scrapers` company identifiers. The concrete list is maintained here as institutions are added:

| Variable | Purpose | Status |
|----------|---------|--------|
| _(none yet)_ | | 🟡 |

## Testing

| Item | Choice | Status |
|------|--------|--------|
| Test runner | TBD | 🟡 |
| Strategy | Unit-test tool logic with the scraper mocked; never hit real banks in CI | 🟡 |

## Build & tooling

| Item | Choice | Status |
|------|--------|--------|
| Type checking | `tsc` | 🟡 |
| Linting / formatting | TBD | 🟡 |
| Build output | TBD | 🟡 |

## Deployment

| Item | Choice | Status |
|------|--------|--------|
| Distribution | Run locally as an MCP server subprocess of the agent client | 🟡 |
| Hosting | None — runs on the user's own machine (credentials never leave it) | 🟡 |

Running moneymcp as a hosted/remote service is intentionally **not** the model, because it would require centralizing users' bank credentials. Revisit only with a logged decision.
