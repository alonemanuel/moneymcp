# Design System

**This file is the single source of truth for moneymcp's visual design.** Colors, typography, spacing, iconography, tone — anything visual is defined here. If a visual choice changes anywhere in the project, it changes *here first* and the implementation follows. Code must never be the authority over this file.

> ℹ️ **Scope note.** moneymcp is currently a **headless MCP server** with no graphical UI — the "interface" is the set of tools an agent calls. So this file is mostly a placeholder until a surface that needs visual design exists (e.g. a setup/onboarding UI, a docs site, or a dashboard). The tokens below are *proposed defaults*, not yet implemented anywhere. Mark them ✅ once a real surface uses them.

Status legend: ✅ in use · 🟡 proposed · ❌ rejected

---

## Design principles

1. **Trust first.** This app touches people's money. Visuals should feel calm, precise, and secure — never flashy or "salesy."
2. **Clarity over decoration.** Financial data must be legible at a glance.
3. **Quiet by default.** Use color sparingly; reserve it for meaning (e.g. credit vs. debit), not ornament.

## Color palette 🟡

Proposed starting tokens. Names are semantic so implementations don't hardcode hex values.

| Token | Hex | Use |
|-------|-----|-----|
| `--color-bg` | `#0F1115` | App background (dark) |
| `--color-surface` | `#1A1D23` | Cards / panels |
| `--color-text` | `#E6E8EB` | Primary text |
| `--color-text-muted` | `#9AA0A6` | Secondary text |
| `--color-accent` | `#3B82F6` | Primary actions, links |
| `--color-positive` | `#22C55E` | Credits / income |
| `--color-negative` | `#EF4444` | Debits / expenses |
| `--color-border` | `#2A2E35` | Dividers, borders |

> Money convention: positive/green for money in, negative/red for money out. Keep this consistent everywhere amounts are shown.

## Typography 🟡

| Token | Value | Use |
|-------|-------|-----|
| `--font-sans` | system UI stack | Body & UI text |
| `--font-mono` | system mono stack | Amounts, account numbers, anything tabular |
| `--text-base` | 16px | Base body size |
| `--text-scale` | 1.25 (major third) | Modular scale for headings |

> Always render currency amounts in the **mono** font so digits align in columns.

## Spacing & layout 🟡

- Base unit: `4px`. Use multiples (`4 / 8 / 12 / 16 / 24 / 32 / 48`).
- Max content width for reading surfaces: `~720px`.

## Iconography & imagery 🟡

- TBD. Prefer a single consistent icon set when one is needed.

## Tone of voice

Applies to any user-facing copy (errors, tool descriptions, setup prompts):
- Plain, direct, reassuring. No jargon, no hype.
- Be explicit about anything touching credentials or money ("This will connect to your bank and read your last 30 days of transactions.").
