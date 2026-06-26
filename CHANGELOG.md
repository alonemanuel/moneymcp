# Changelog

All notable changes to moneymcp are recorded here. Newest first.

This project follows [Keep a Changelog](https://keepachangelog.com/) conventions and (once it ships) [Semantic Versioning](https://semver.org/). Until the first release, changes are grouped under **Unreleased**.

Categories: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

---

## [Unreleased]

### Added
- Project documentation set: `README.md`, `stack.md`, `design.md`, `decisions.md`, `CHANGELOG.md`, and `CLAUDE.md` with rules to keep them in sync. (2026-06-26)

### Changed
- Pivoted the project from the initial Python PyCharm scaffold to a TypeScript/Node.js MCP server. See [decisions.md](./decisions.md). (2026-06-26)

### Notes
- The original Python scaffold (`main.py`, `.idea/`) is dead and slated for removal; not yet deleted.
- No application code shipped yet — the MCP server, tools, and scraper integration are still to be implemented.
