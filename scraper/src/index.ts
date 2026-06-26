#!/usr/bin/env node
/**
 * moneymcp — MCP server exposing the user's bank transactions as a tool.
 *
 * POC scope: a single tool, `get_transactions`, that scrapes Bank Hapoalim
 * via israeli-bank-scrapers and returns raw transactions. It deliberately does
 * NOT decide what is "significant" — the calling agent reasons over the list.
 *
 * IMPORTANT: this is an MCP stdio server. Nothing may be written to stdout
 * except the MCP protocol itself — all logging goes to stderr (console.error).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createScraper, CompanyTypes } from "israeli-bank-scrapers";

const BANK_USER_CODE = process.env.BANK_USER_CODE;
const BANK_PASSWORD = process.env.BANK_PASSWORD;

/** First day of the month `monthsBack` months before today. */
function startOfMonthsAgo(monthsBack: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
}

const server = new McpServer({ name: "moneymcp", version: "0.1.0" });

server.tool(
  "get_transactions",
  "Fetch the user's recent Bank Hapoalim transactions by scraping the bank. " +
    "Returns raw transactions (date, description, amount, currency, status). " +
    "The caller decides which transactions are 'significant' — this tool does not filter. " +
    "Note: scraping drives a headless browser and may take 30-60 seconds.",
  {
    monthsBack: z
      .number()
      .int()
      .min(0)
      .max(12)
      .optional()
      .describe(
        "How many months back to start from. 0 = since the 1st of the current month (default)."
      ),
  },
  async ({ monthsBack = 0 }) => {
    if (!BANK_USER_CODE || !BANK_PASSWORD) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: "Missing credentials: set BANK_USER_CODE and BANK_PASSWORD in the server environment.",
          },
        ],
      };
    }

    const startDate = startOfMonthsAgo(monthsBack);
    console.error(
      `[moneymcp] scraping Hapoalim from ${startDate.toISOString().slice(0, 10)} ...`
    );

    const scraper = createScraper({
      companyId: CompanyTypes.hapoalim,
      startDate,
      combineInstallments: false,
      showBrowser: false,
    });

    const result = await scraper.scrape({
      userCode: BANK_USER_CODE,
      password: BANK_PASSWORD,
    });

    if (!result.success) {
      console.error(
        `[moneymcp] scrape failed: ${result.errorType} ${result.errorMessage ?? ""}`
      );
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Scrape failed (${result.errorType}): ${result.errorMessage ?? "unknown error"}`,
          },
        ],
      };
    }

    const transactions = (result.accounts ?? []).flatMap((account) =>
      (account.txns ?? []).map((txn) => ({
        account: account.accountNumber,
        date: txn.date,
        description: txn.description,
        memo: txn.memo ?? null,
        amount: txn.chargedAmount,
        currency: txn.originalCurrency,
        status: txn.status,
        type: txn.type,
      }))
    );

    console.error(`[moneymcp] fetched ${transactions.length} transactions`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              startDate: startDate.toISOString().slice(0, 10),
              accountCount: result.accounts?.length ?? 0,
              transactionCount: transactions.length,
              transactions,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[moneymcp] server running on stdio");
}

main().catch((err) => {
  console.error("[moneymcp] fatal error:", err);
  process.exit(1);
});
