#!/usr/bin/env node
/**
 * moneymcp scraper — runs on a schedule (GitHub Actions), scrapes Bank Hapoalim
 * via israeli-bank-scrapers, and upserts transactions into Cloudflare D1.
 *
 * 2FA: uses a PERSISTENT browser profile (BROWSER_PROFILE_DIR) so Hapoalim
 * keeps treating this as a trusted device. The profile is established once by
 * `npm run login` (see login.ts) and, in CI, restored from an encrypted secret
 * before this runs. If Hapoalim still challenges, the scrape fails and is
 * recorded; the Telegram relay (separate) notifies the user to re-bootstrap.
 *
 * All sensitive values come from env (GitHub Actions secrets) — never logged.
 */
import { createScraper, CompanyTypes } from "israeli-bank-scrapers";
import { d1ConfigFromEnv, d1Query, type D1Config } from "./d1.js";
import { txnToRow, type ScrapedTxn, type TxnRow } from "./transform.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function startDate(daysBack: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d;
}

const UPSERT_SQL = `
INSERT INTO transactions
  (hash, account, date, description, memo, amount, currency, status, type, category, scraped_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(hash) DO UPDATE SET
  status = excluded.status,
  memo = excluded.memo,
  category = excluded.category,
  scraped_at = excluded.scraped_at`;

async function upsertRows(cfg: D1Config, rows: TxnRow[]): Promise<void> {
  for (const r of rows) {
    await d1Query(cfg, UPSERT_SQL, [
      r.hash, r.account, r.date, r.description, r.memo, r.amount,
      r.currency, r.status, r.type, r.category, r.scraped_at,
    ]);
  }
}

async function recordRun(
  cfg: D1Config,
  startedAt: string,
  success: boolean,
  inserted: number,
  error: string | null
): Promise<void> {
  await d1Query(
    cfg,
    `INSERT INTO scrape_runs (started_at, finished_at, success, inserted, error)
     VALUES (?,?,?,?,?)`,
    [startedAt, new Date().toISOString(), success ? 1 : 0, inserted, error]
  );
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const userCode = required("HAPOALIM_USER_CODE");
  const password = required("HAPOALIM_PASSWORD");
  const profileDir = process.env.BROWSER_PROFILE_DIR ?? "./.hapoalim-profile";
  const daysBack = Number(process.env.DAYS_BACK ?? 10);
  // In dry-run we only scrape + print — no D1 write, so no cloud creds needed.
  const cfg = dryRun ? null : d1ConfigFromEnv();

  const startedAt = new Date().toISOString();
  console.error(`[scraper] scraping Hapoalim, ${daysBack} days back, profile=${profileDir}`);

  const scraper = createScraper({
    companyId: CompanyTypes.hapoalim,
    startDate: startDate(daysBack),
    combineInstallments: false,
    showBrowser: false,
    timeout: 90000,
    // Persistent profile keeps Hapoalim's device-trust between runs.
    args: [`--user-data-dir=${profileDir}`],
  });

  const result = await scraper.scrape({ userCode, password });

  if (!result.success) {
    const msg = `${result.errorType}: ${result.errorMessage ?? ""}`.trim();
    console.error(`[scraper] FAILED: ${msg}`);
    if (cfg) {
      await recordRun(cfg, startedAt, false, 0, msg).catch((e) =>
        console.error("[scraper] failed to record run:", e)
      );
    }
    process.exit(1);
  }

  const scrapedAt = new Date().toISOString();
  const rows: TxnRow[] = (result.accounts ?? []).flatMap((acc) =>
    (acc.txns ?? []).map((t) => txnToRow(acc.accountNumber, t as unknown as ScrapedTxn, scrapedAt))
  );

  if (!cfg) {
    console.error(`[scraper] DRY RUN — scraped ${rows.length} transactions (not writing to D1):`);
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.error(`[scraper] upserting ${rows.length} transactions to D1...`);
  await upsertRows(cfg, rows);
  await recordRun(cfg, startedAt, true, rows.length, null);
  console.error(`[scraper] done: ${rows.length} transactions.`);
}

main().catch((err) => {
  console.error("[scraper] fatal:", err);
  process.exit(1);
});
