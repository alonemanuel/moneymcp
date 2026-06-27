import { createHash } from "node:crypto";

/** A transaction as produced by israeli-bank-scrapers (only the fields we use). */
export interface ScrapedTxn {
  identifier?: string | number;
  date: string;
  processedDate?: string;
  description: string;
  memo?: string;
  chargedAmount: number;
  originalAmount?: number;
  originalCurrency?: string;
  status?: string;
  type?: string;
  category?: string;
  installments?: { number?: number; total?: number };
}

/** A row as stored in D1 (matches worker/schema.sql `transactions`). */
export interface TxnRow {
  hash: string;
  user_id: string;
  source: string;
  account: string;
  date: string;
  processed_date: string | null;
  description: string;
  memo: string | null;
  amount: number;
  original_amount: number | null;
  currency: string | null;
  identifier: string | null;
  installment_num: number | null;
  installment_total: number | null;
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
  userId: string,
  source: string,
  account: string,
  txn: ScrapedTxn,
  scrapedAt: string
): TxnRow {
  return {
    // Hash basis stays account-keyed (account numbers differ across providers
    // and people), so re-scrapes upsert cleanly and don't duplicate.
    hash: txnHash(account, txn),
    user_id: userId,
    source,
    account,
    date: txn.date,
    processed_date: txn.processedDate ?? null,
    description: txn.description,
    memo: txn.memo ?? null,
    amount: txn.chargedAmount,
    original_amount: txn.originalAmount ?? null,
    currency: txn.originalCurrency ?? null,
    identifier: txn.identifier != null ? String(txn.identifier) : null,
    installment_num: txn.installments?.number ?? null,
    installment_total: txn.installments?.total ?? null,
    status: txn.status ?? null,
    type: txn.type ?? null,
    category: txn.category ?? null,
    scraped_at: scrapedAt,
  };
}
