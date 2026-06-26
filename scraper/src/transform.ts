import { createHash } from "node:crypto";

/** A transaction as produced by israeli-bank-scrapers (only the fields we use). */
export interface ScrapedTxn {
  identifier?: string | number;
  date: string;
  description: string;
  memo?: string;
  chargedAmount: number;
  originalCurrency?: string;
  status?: string;
  type?: string;
  category?: string;
}

/** A row as stored in D1 (matches worker/schema.sql `transactions`). */
export interface TxnRow {
  hash: string;
  source: string;
  account: string;
  date: string;
  description: string;
  memo: string | null;
  amount: number;
  currency: string | null;
  status: string | null;
  type: string | null;
  category: string | null;
  scraped_at: string;
}

/**
 * Stable dedupe key. Combines the account, date, amount and the bank's own
 * identifier (falling back to description) so re-scrapes of the same window
 * don't create duplicates.
 */
export function txnHash(account: string, txn: ScrapedTxn): string {
  const id = txn.identifier ?? txn.description;
  const basis = `${account}|${txn.date}|${txn.chargedAmount}|${id}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 24);
}

export function txnToRow(
  source: string,
  account: string,
  txn: ScrapedTxn,
  scrapedAt: string
): TxnRow {
  return {
    // Hash basis stays account-keyed (account numbers differ across providers),
    // so re-scrapes upsert cleanly and don't duplicate.
    hash: txnHash(account, txn),
    source,
    account,
    date: txn.date,
    description: txn.description,
    memo: txn.memo ?? null,
    amount: txn.chargedAmount,
    currency: txn.originalCurrency ?? null,
    status: txn.status ?? null,
    type: txn.type ?? null,
    category: txn.category ?? null,
    scraped_at: scrapedAt,
  };
}
