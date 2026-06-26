# Decisions

A log of significant decisions made over the life of this repo. Each entry records **what** was decided, **why**, and **what alternatives** were considered and rejected. Newest first.

When you make a non-trivial decision (architecture, dependency, data model, security posture, anything that constrains future work), add an entry here. Reversing a past decision means adding a *new* entry that supersedes the old one — don't delete history; mark the old one superseded.

---

## 2026-06-26 — Multi-provider scraping; Isracard requires a visible browser

**Decision:** The scraper supports multiple institutions (Hapoalim bank + Isracard & Max cards), each enabled by its own env credentials and scraped into the same D1, tagged with a `source` column. **Isracard must be scraped with a visible browser** (`SHOW_BROWSER=1`) plus `--disable-blink-features=AutomationControlled` and a logged-in profile.

**Why:**
- One unified store across bank + cards lets the agent answer "how much on my Isracard this month" and compare sources.
- Isracard sits behind Akamai bot-protection: headless scraping returned `403` on the login page and `Failed to fetch` on the data call. A **visible** browser with the automation fingerprint hidden, reusing a manually-logged-in profile, scraped successfully (verified: 86 transactions).

**Consequences:**
- Isracard cannot run headless → it also can't run on a headless cloud runner as-is. For now data is loaded manually (visible browser on the Mac). Revisit for automation.
- `source` column added to `transactions`; dedupe hash stays account-keyed (account numbers differ across providers), so re-scrapes upsert cleanly.

**Status:** Hapoalim ✅ live, Isracard ✅ loaded, Max ⏸️ parked (login `TIMEOUT` — likely needs the same one-time browser login, deferred at user's request).

---

## 2026-06-26 — Architecture: scheduled-scrape-into-store + remote MCP (cloud, free-tier)

**Decision:** Split moneymcp into three decoupled cloud parts: (1) a **scraper** that runs on a schedule and writes transactions into (2) a **store**, which (3) a **remote MCP server** reads to answer queries. Querying never touches the bank. Concrete free-tier stack: **GitHub Actions** (scraper cron) + **Cloudflare D1** (SQLite store) + **Cloudflare Workers** (MCP server, Streamable HTTP) + **Telegram** (OTP relay). The Claude app reaches it as a custom connector.

**Why:**
- The user's actual goal is to ask from the **iPhone Claude app, anywhere** — which requires a remote MCP server reachable from Anthropic's cloud, not a local stdio process.
- Live-scrape-per-query is the worst case: ~30–60s latency *and* a Hapoalim SMS challenge on *every* question. Decoupling makes queries instant and confines 2FA to scrape time (a couple times a day).
- This is moneyman's proven model (scrape on a schedule → store → read), and matches `glekner/il-bank-mcp` (SQLite + read tools).
- Must be **free**: GitHub Actions, Cloudflare Workers/D1, and Telegram all have no-credit-card free tiers.

**Alternatives considered:**
- *Keep live-scrape-per-query (the POC / `mottibec/israeli-bank-mcp`):* rejected — latency + OTP on every query.
- *Neon Postgres as the store:* rejected in favor of **Cloudflare D1** — D1 is read natively by the Worker and keeps everything in one provider (one fewer account/service), still free.
- *Single always-on home box + tunnel:* rejected by the user — they don't want to run any hardware.
- *Oracle Cloud Always Free VM (persistent profile → best 2FA story):* kept as the **upgrade path** if free/ephemeral CI re-auth becomes too painful; not chosen now because signup needs a credit card and VM ops.

**Known weak spot:** GitHub Actions runners are ephemeral with datacenter IPs — the worst case for Hapoalim's new-device check. Mitigated by persisting an encrypted trusted browser profile and a Telegram OTP relay, but re-challenges will be more frequent than on a persistent box, and OTP-during-CI is awkward. Accepted as the cost of "free + cloud + Hapoalim."

**Supersedes:** "Local-only execution; no hosted service, no central credential store" and the stdio transport choice (both below).

---

## 2026-06-26 — Cloud-only execution; credentials in cloud secrets

**Decision:** All components run in the cloud. Bank credentials and the trusted browser profile live as **GitHub Actions secrets**; the MCP endpoint is gated by a token secret in Cloudflare. Nothing runs on user hardware.

**Why:**
- The user explicitly does not want a home box; "everything on the cloud."
- Without a local machine, the only place for credentials is cloud secret storage.

**Trade-off accepted:** centralizing the bank password in cloud secrets raises the stakes if that account is compromised. Mitigations: least-privilege scoping, never logging secrets, single-user endpoint behind a token. This reverses the prior security posture deliberately, at the user's direction.

**Alternatives considered:**
- *Local/home credential custody (prior decision):* rejected by the user.

**Supersedes:** "Local-only execution; no hosted service, no central credential store" (below).

---

## 2026-06-26 — Transport: Streamable HTTP over stdio

**Decision:** The MCP server speaks **Streamable HTTP** with token auth, not stdio.

**Why:**
- Custom connectors require a remote HTTPS endpoint; Anthropic's cloud connects to it on the client's behalf (including the mobile apps). stdio can only serve a locally-launched process.
- Anthropic is deprecating SSE in favor of Streamable HTTP, so we target Streamable HTTP directly.

**Supersedes:** the POC's stdio transport.

---

## 2026-06-26 — POC: tool returns raw transactions; the agent judges "significance"

**Decision:** The first tool, `get_transactions`, scrapes and returns the raw transaction list. It does **not** compute or filter for "significant" transactions. The calling agent (Claude) reasons over the list to surface notable items.

**Why:**
- Fastest path to the target POC ("what are some significant transactions this month") — no need to define or build a significance heuristic.
- "Significant" is subjective and context-dependent; an LLM does this well from raw data, and the user can steer it conversationally.
- Keeps the server a thin, testable data-access layer.

**Alternatives considered:**
- *Server-side significance scoring (thresholds, anomaly detection):* deferred — premature for a POC and bakes in a definition the user hasn't specified.

**Revisit if:** we want deterministic/repeatable significance flags independent of the agent, or to reduce tokens by pre-filtering large histories.

---

## 2026-06-26 — POC institution: Bank Hapoalim, single hard-coded company

**Decision:** The POC targets **Bank Hapoalim** only, with credentials from two env vars (`BANK_USER_CODE`, `BANK_PASSWORD`) and `CompanyTypes.hapoalim` hard-coded in the tool.

**Why:**
- A single concrete institution is the shortest path to a working end-to-end demo.
- Multi-institution support means a config/credential abstraction that isn't needed to prove the concept.

**Alternatives considered:**
- *Multi-institution from day one:* deferred — generalizing the credential model is the natural next step after the POC works, and should be logged when done.

**Note:** Hapoalim may require an OTP on new sessions, which would complicate full automation; revisit credential/2FA handling if it blocks the demo.

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

## 2026-06-26 — Local-only execution; no hosted service, no central credential store  ⛔ SUPERSEDED

> **Superseded same day** by "Architecture: scheduled-scrape-into-store + remote MCP (cloud, free-tier)" and "Cloud-only execution; credentials in cloud secrets" (above). The user opted for a fully-cloud, no-hardware setup and queries from the iPhone Claude app, which this local-only posture cannot serve. Kept for history.

**Decision:** moneymcp runs locally as a subprocess of the agent's MCP client. Bank credentials live only in local environment variables and never leave the user's machine except to authenticate with their own bank. There is no persistent database by default.

**Why:**
- Handling real bank credentials centrally would make moneymcp a high-value attack target and a serious liability.
- Local-only execution keeps the trust boundary at the user's own machine — the same posture moneyman uses.
- On-demand scraping with no persistence minimizes how much sensitive financial data exists at rest.

**Alternatives considered:**
- *Hosted/remote MCP service:* rejected for now — requires centralizing credentials. Revisit only with a new superseding decision and a concrete secrets-custody plan.
- *Persisting scraped data in a DB:* deferred — adds data-at-rest risk with no current need. Add only when a feature requires it, and log it here.
