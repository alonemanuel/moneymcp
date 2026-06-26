# moneymcp

Interact with your money through AI agents.

moneymcp is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes your Israeli bank and credit-card data as tools an AI agent can call. Ask an agent "how much did I spend on groceries last month?" or "what's my current balance across all accounts?" and it answers by calling moneymcp tools — which scrape your financial institutions on demand.

Israel has no Plaid-style aggregator, so moneymcp reaches your data the same way [moneyman](https://github.com/daniel-hh/moneyman) does: via [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers), a headless-browser scraping library that supports most Israeli banks and credit-card companies.

> ⚠️ **Early stage.** This project is in initial setup. Tools and behavior described here are the intended design and may not all be implemented yet — check [CHANGELOG.md](./CHANGELOG.md) for what actually ships.

## How it works

```
AI agent (Claude, etc.)
        │  MCP protocol (stdio)
        ▼
   moneymcp server  ──►  israeli-bank-scrapers  ──►  Puppeteer (headless browser)  ──►  your bank
```

The agent connects to moneymcp over MCP. When it needs financial data it calls a tool; moneymcp launches a headless browser session against the relevant institution, scrapes the data, and returns structured results.

## Requirements

- Node.js (LTS)
- Credentials for the bank/credit-card accounts you want to query

See [stack.md](./stack.md) for exact versions and dependencies.

## Installation

```bash
npm install
```

## Configuration

moneymcp needs credentials for each financial institution. These are provided via environment variables and are **never** committed. See [stack.md](./stack.md) for the secrets model and the full list of supported variables.

```bash
cp .env.example .env   # then fill in your credentials
```

## Running

As a standalone MCP server (stdio):

```bash
npm run start
```

To use it from an MCP client (e.g. Claude Desktop / Claude Code), register moneymcp as a server in the client's MCP config. Exact wiring is documented in [stack.md](./stack.md).

## Security

moneymcp handles real bank credentials and real financial data. Credentials live only in environment variables / local secret storage, are never logged, and never leave your machine except to authenticate with your bank. See [decisions.md](./decisions.md) for the reasoning behind the security model.

## Project documentation

This repo keeps a small set of **ground-truth** documents. If you change the project, the matching doc must change in the same commit (see [CLAUDE.md](./CLAUDE.md)):

| Doc | Purpose |
|-----|---------|
| [stack.md](./stack.md) | Ground truth for the tech stack — runtime, deps, DB, deployment, tests. |
| [design.md](./design.md) | Ground truth for visual/design decisions (colors, typography, etc.). |
| [decisions.md](./decisions.md) | Log of significant decisions, with rationale and alternatives. |
| [CHANGELOG.md](./CHANGELOG.md) | Human-readable history of notable changes. |

## License

TBD.