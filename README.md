# moneymcp

Interact with your money through AI agents — from your phone, anywhere.

moneymcp is a **remote [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server** that exposes your Israeli bank and credit-card transactions as tools an AI agent can call. Add it to the Claude app as a custom connector and ask things like *"what are some significant transactions I had this month?"* — from your iPhone, your laptop, wherever.

Israel has no Plaid-style aggregator, so moneymcp gets your data the way [moneyman](https://github.com/daniel-hauser/moneyman) does: by scraping your institutions with [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers).

> ⚠️ **In active development.** The architecture below is the target; check [CHANGELOG.md](./CHANGELOG.md) for what actually ships, and [stack.md](./stack.md) for build status of each piece.

## How it works

moneymcp **decouples scraping from querying** so that asking a question is instant and never logs into your bank:

```
iPhone / any Claude client
   → Anthropic cloud
   → MCP server (Cloudflare Worker, HTTPS + token)  ── reads ──┐
                                                                │
   scraper (GitHub Actions cron, Puppeteer)                     │
        │  upsert + dedupe                                      │
        ▼                                                       │
   Cloudflare D1 (SQLite)  ◄────────────────────────────────────┘
        ▲
        └─ Telegram bot ⇄ you  (only when your bank needs an SMS code)
```

- A scheduled **scraper** logs into your bank a couple of times a day and writes transactions to a database.
- The **MCP server** only ever *reads* that database — so Claude answers instantly and your bank is never contacted while you're chatting.
- It's reachable from your phone because Anthropic's cloud connects to the server's public HTTPS endpoint (gated by a token).

Everything runs on **free tiers** (Cloudflare, GitHub Actions, Telegram) — no servers to pay for, no hardware to run.

## The 2FA reality

Some banks (e.g. Bank Hapoalim) send an **SMS code on every new-device login**. moneymcp handles this by keeping a trusted browser session and, when the bank still asks, pinging you on **Telegram** for the code. This happens at scrape time (rarely), never while you're asking a question. It's the unavoidable cost of bank-imposed 2FA — see [decisions.md](./decisions.md).

## Setup

Setup is a one-time guided process (Cloudflare + GitHub + Telegram accounts, secrets, and a one-time login to establish the trusted session). Detailed steps live in [stack.md](./stack.md) and will be expanded here as the pieces land.

## Security

moneymcp handles real bank credentials. They live only as **cloud secrets** (GitHub Actions), are never committed or logged, and are used only to log into your own bank. The MCP endpoint is gated by a token so only your Claude account can reach it. The reasoning and trade-offs (including hosting credentials in the cloud) are documented in [decisions.md](./decisions.md).

## Project documentation

This repo keeps a small set of **ground-truth** documents. If you change the project, the matching doc must change in the same commit (see [CLAUDE.md](./CLAUDE.md)):

| Doc | Purpose |
|-----|---------|
| [stack.md](./stack.md) | Ground truth for the tech stack — architecture, components, hosting, secrets, deployment. |
| [design.md](./design.md) | Ground truth for visual/design decisions. |
| [decisions.md](./decisions.md) | Log of significant decisions, with rationale and alternatives. |
| [CHANGELOG.md](./CHANGELOG.md) | Human-readable history of notable changes. |

## Prior art

- [moneyman](https://github.com/daniel-hauser/moneyman) — scheduled scraper → storage (the model we follow).
- [glekner/il-bank-mcp](https://github.com/glekner/il-bank-mcp) — SQLite-backed MCP server (close to our design; tool surface borrowed).
- [mottibec/israeli-bank-mcp](https://github.com/mottibec/israeli-bank-mcp) — live-scrape MCP server.

## License

TBD.
