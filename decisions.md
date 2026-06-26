# Decisions

A log of significant decisions made over the life of this repo. Each entry records **what** was decided, **why**, and **what alternatives** were considered and rejected. Newest first.

When you make a non-trivial decision (architecture, dependency, data model, security posture, anything that constrains future work), add an entry here. Reversing a past decision means adding a *new* entry that supersedes the old one — don't delete history; mark the old one superseded.

---

## 2026-06-26 — Data source: `israeli-bank-scrapers` library over `moneyman` app

**Decision:** Reach financial data by depending on the [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers) library directly. Use [moneyman](https://github.com/daniel-hh/moneyman) only as a reference for account/config modeling, not as a runtime dependency.

**Why:**
- An MCP server is on-demand and call-driven: an agent invokes a tool, we scrape, we return. That maps cleanly onto the library's function-call API.
- moneyman is built as a *scheduled batch app* with opinions about storage (Google Sheets, Azure, etc.), dedup, and run cadence — all of which we'd have to strip out or fight.
- We can still borrow moneyman's patterns for modeling accounts and credentials.

**Alternatives considered:**
- *Wrap moneyman as a whole (subprocess/CLI):* rejected — designed to run on a cron, not to be called per-request; opinionated storage gets in the way.
- *Build our own scraping:* rejected — `israeli-bank-scrapers` already supports most Israeli institutions and is the maintained standard.

**Context:** Israel has no Plaid-equivalent aggregator, so scraping is the only viable path.

---

## 2026-06-26 — Runtime: TypeScript over Python

**Decision:** Build the MCP server in TypeScript on Node.js, replacing the initial Python scaffold.

**Why:**
- Both `israeli-bank-scrapers` and moneyman are Node/TypeScript. TypeScript lets us call the scraper **in-process** — no cross-runtime subprocess/JSON marshalling.
- `@modelcontextprotocol/sdk` (TypeScript) is the reference MCP implementation and the best-supported one.
- The cost of switching was ~zero: the repo only contained a PyCharm sample `main.py`.

**Alternatives considered:**
- *Python (keep the scaffold, MCP Python SDK, call moneyman as a subprocess):* rejected — would only win if we had real Python to reuse (we don't), and it adds permanent cross-runtime glue to reach a Node-only scraping library.

---

## 2026-06-26 — Local-only execution; no hosted service, no central credential store

**Decision:** moneymcp runs locally as a subprocess of the agent's MCP client. Bank credentials live only in local environment variables and never leave the user's machine except to authenticate with their own bank. There is no persistent database by default.

**Why:**
- Handling real bank credentials centrally would make moneymcp a high-value attack target and a serious liability.
- Local-only execution keeps the trust boundary at the user's own machine — the same posture moneyman uses.
- On-demand scraping with no persistence minimizes how much sensitive financial data exists at rest.

**Alternatives considered:**
- *Hosted/remote MCP service:* rejected for now — requires centralizing credentials. Revisit only with a new superseding decision and a concrete secrets-custody plan.
- *Persisting scraped data in a DB:* deferred — adds data-at-rest risk with no current need. Add only when a feature requires it, and log it here.
