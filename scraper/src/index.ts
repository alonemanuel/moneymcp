#!/usr/bin/env node
/**
 * moneymcp scraper — scrapes each configured provider (Hapoalim bank + credit
 * cards) via israeli-bank-scrapers and upserts transactions into Cloudflare D1,
 * tagging each with its `source`.
 *
 * Providers are read from env (see providers.ts); a provider is scraped only if
 * its credentials are present. 2FA-trusted providers (Hapoalim) reuse a
 * persistent browser profile established once by `npm run login`.
 *
 * `--dry-run` scrapes + prints without writing to D1 (no cloud creds needed).
 * All sensitive values come from env — never logged.
 */
import { createScraper } from "israeli-bank-scrapers";
import { d1ConfigFromEnv, d1Query, type D1Config } from "./d1.js";
import { providersFromEnv, type Provider } from "./providers.js";
import { txnToRow, type ScrapedTxn, type TxnRow } from "./transform.js";

function startDate(daysBack: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d;
}

const UPSERT_SQL = `
INSERT INTO transactions
  (hash, user_id, source, account, date, description, memo, amount, currency, status, type, category, scraped_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(hash) DO UPDATE SET
  user_id = excluded.user_id,
  source = excluded.source,
  status = excluded.status,
  memo = excluded.memo,
  category = excluded.category,
  scraped_at = excluded.scraped_at`;

async function upsertRows(cfg: D1Config, rows: TxnRow[]): Promise<void> {
  for (const r of rows) {
    await d1Query(cfg, UPSERT_SQL, [
      r.hash, r.user_id, r.source, r.account, r.date, r.description, r.memo,
      r.amount, r.currency, r.status, r.type, r.category, r.scraped_at,
    ]);
  }
}

// --- per-user sync status (drives the dashboard's live progress) ---

async function syncStart(cfg: D1Config, userId: string): Promise<number> {
  const res = await d1Query(
    cfg,
    `INSERT INTO sync_runs (user_id, status, detail, started_at) VALUES (?,?,?,?)`,
    [userId, "running", "starting", new Date().toISOString()]
  );
  return Number((res[0]?.meta as any)?.last_row_id ?? 0);
}

async function syncUpdate(cfg: D1Config, id: number, detail: string): Promise<void> {
  await d1Query(cfg, `UPDATE sync_runs SET detail = ?1 WHERE id = ?2`, [detail, id]);
}

async function syncFinish(
  cfg: D1Config,
  id: number,
  status: "done" | "error",
  inserted: number,
  detail: string
): Promise<void> {
  await d1Query(
    cfg,
    `UPDATE sync_runs SET status=?1, inserted=?2, detail=?3, finished_at=?4 WHERE id=?5`,
    [status, inserted, detail, new Date().toISOString(), id]
  );
}

async function upsertConnection(
  cfg: D1Config,
  userId: string,
  source: string,
  status: string,
  lastSyncAt: string | null,
  error: string | null
): Promise<void> {
  await d1Query(
    cfg,
    `INSERT INTO connections (user_id, source, status, last_sync_at, last_error)
     VALUES (?1,?2,?3,?4,?5)
     ON CONFLICT(user_id, source) DO UPDATE SET
       status = excluded.status,
       last_sync_at = COALESCE(excluded.last_sync_at, connections.last_sync_at),
       last_error = excluded.last_error`,
    [userId, source, status, lastSyncAt, error]
  );
}

/** Scrape one provider into rows. Throws on failure. */
async function scrapeProvider(provider: Provider, userId: string, daysBack: number): Promise<TxnRow[]> {
  console.error(`[scraper] ${provider.source}: scraping ${daysBack} days back...`);
  const args = [
    `--user-data-dir=${provider.profileDir}`,
    "--disable-blink-features=AutomationControlled",
  ];
  // CI/Linux runners (e.g. GitHub Actions) have no Chrome sandbox available.
  if (process.env.NO_SANDBOX === "1") {
    args.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  const scraper = createScraper({
    companyId: provider.companyId,
    startDate: startDate(daysBack),
    combineInstallments: false,
    // Some issuers (Isracard/Akamai) block headless + automation fingerprints.
    // SHOW_BROWSER=1 runs a visible browser; the AutomationControlled flag
    // hides navigator.webdriver — together they get past the bot check.
    showBrowser: process.env.SHOW_BROWSER === "1",
    timeout: 120000,
    args,
  });

  // Credentials are validated per-provider in providers.ts; the library's
  // scrape() takes a per-company credential union, so cast the generic shape.
  const result = await scraper.scrape(
    provider.credentials as unknown as Parameters<typeof scraper.scrape>[0]
  );
  if (!result.success) {
    throw new Error(`${result.errorType}: ${result.errorMessage ?? ""}`.trim());
  }

  const scrapedAt = new Date().toISOString();
  const rows = (result.accounts ?? []).flatMap((acc) =>
    (acc.txns ?? []).map((t) =>
      txnToRow(userId, provider.source, acc.accountNumber, t as unknown as ScrapedTxn, scrapedAt)
    )
  );
  console.error(`[scraper] ${provider.source}: ${rows.length} transactions`);
  return rows;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const daysBack = Number(process.env.DAYS_BACK ?? 10);
  const userId = process.env.USER_ID ?? "alon";
  const providers = providersFromEnv();
  if (providers.length === 0) {
    throw new Error("No providers configured — set credentials for at least one (see providers.ts).");
  }
  console.error(`[scraper] providers: ${providers.map((p) => p.source).join(", ")}`);
  const cfg = dryRun ? null : d1ConfigFromEnv();

  // Open a sync_runs row so the dashboard can show live progress.
  const syncId = cfg ? await syncStart(cfg, userId) : 0;

  // Scrape each provider independently so one failure doesn't lose the others.
  const allRows: TxnRow[] = [];
  const failures: string[] = [];
  const details: string[] = [];
  for (const provider of providers) {
    try {
      const rows = await scrapeProvider(provider, userId, daysBack);
      allRows.push(...rows);
      details.push(`${provider.source}: ${rows.length}`);
      if (cfg) {
        await upsertConnection(cfg, userId, provider.source, "connected", new Date().toISOString(), null);
        await syncUpdate(cfg, syncId, details.join(" | "));
      }
    } catch (err: any) {
      const msg = `${provider.source}: ${err?.message ?? String(err)}`;
      console.error(`[scraper] FAILED ${msg}`);
      failures.push(msg);
      details.push(`${provider.source}: FAILED`);
      if (cfg) {
        await upsertConnection(cfg, userId, provider.source, "error", null, err?.message ?? String(err));
        await syncUpdate(cfg, syncId, details.join(" | "));
      }
    }
  }

  if (!cfg) {
    console.error(`[scraper] DRY RUN — scraped ${allRows.length} transactions (not writing to D1):`);
    console.log(JSON.stringify(allRows, null, 2));
    if (failures.length) console.error(`[scraper] failures: ${failures.join(" | ")}`);
    return;
  }

  console.error(`[scraper] upserting ${allRows.length} transactions to D1...`);
  await upsertRows(cfg, allRows);
  const ok = failures.length === 0;
  await syncFinish(cfg, syncId, ok ? "done" : "error", allRows.length, details.join(" | "));
  console.error(`[scraper] done: ${allRows.length} transactions; ${failures.length} provider failure(s).`);
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error("[scraper] fatal:", err);
  process.exit(1);
});
