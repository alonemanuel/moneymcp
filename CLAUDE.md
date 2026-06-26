# moneymcp — project instructions

moneymcp is an MCP server that lets AI agents interact with the user's money. Because Israel has no Plaid-equivalent, financial data is reached by scraping via `israeli-bank-scrapers` (the library moneyman is built on). The server is TypeScript/Node.js and runs locally.

## Ground-truth documents (READ BEFORE YOU ACT)

This repo keeps four ground-truth docs plus a changelog. They are authoritative: **the docs describe how things must be, and code follows them — not the other way around.** Before doing related work, read the relevant doc; after making a change, update it in the **same commit**.

| Doc | Authoritative for | Read it before… | Update it when… |
|-----|-------------------|-----------------|-----------------|
| [stack.md](./stack.md) | Runtime, languages, dependencies, data source, storage, secrets, testing, build, deployment | Touching deps, build, infra, or data flow | You add/remove/upgrade a dependency, change runtime/tooling, change how data is stored or secrets are handled, or change deployment |
| [design.md](./design.md) | All visual design — colors, typography, spacing, tone | Building or changing any user-facing surface | You introduce or change any color, font, spacing token, icon, or user-facing copy convention |
| [decisions.md](./decisions.md) | The "why" behind significant choices | Proposing a non-trivial change (so you don't re-litigate or contradict a past decision) | You make any architectural / dependency / data-model / security decision, or reverse a prior one (add a superseding entry; never delete history) |
| [CHANGELOG.md](./CHANGELOG.md) | Human-readable history of notable changes | — | You ship any notable change (Added/Changed/Deprecated/Removed/Fixed/Security) |
| [README.md](./README.md) | Outward-facing intro: what it is, how to install/configure/run | — | You change anything that affects how a newcomer installs, configures, or runs the project |

## Hard rules

1. **Docs and code change together.** A PR/commit that changes the stack but not `stack.md`, or adds a UI color not in `design.md`, is incomplete. Never let code silently become the source of truth.
2. **Check before you contradict.** Before introducing a dependency, runtime change, or architectural shift, read `decisions.md`. If your change contradicts a logged decision, you must add a new superseding decision explaining why — don't quietly diverge.
3. **Log decisions as you make them.** Any non-trivial choice gets an entry in `decisions.md` with what / why / alternatives, dated. Convert relative dates to absolute.
4. **Keep stack.md status flags honest.** Items are ✅ in use, 🟡 planned, or ❌ rejected. Don't mark something ✅ until it actually ships.
5. **Update the changelog under `[Unreleased]`** for any notable change, grouped by category.
6. **If two ground-truth docs disagree, stop and flag it** rather than guessing which is correct.

## Security rules (this app touches real money)

- **Never** commit, log, or transmit bank credentials. They live only in local environment variables / `.env` (git-ignored).
- Credentials must never leave the user's machine except to authenticate with the user's own financial institutions.
- Do not add a persistence layer or a hosted/remote deployment without a logged decision in `decisions.md` — both change the security posture materially (see the local-only decision there).
- Never write real credentials or real scraped financial data into tests, fixtures, or docs.

## Working style

- TypeScript with types on all public functions; async/await for I/O.
- When implementing tools, mock the scraper in tests — never hit real banks in CI.
- Keep `README.md` runnable: if `npm run start` (or any documented command) changes, update the README.
