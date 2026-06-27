import { CompanyTypes } from "israeli-bank-scrapers";

/**
 * A financial institution to scrape. `source` tags every transaction in D1 so
 * the agent can tell a bank charge from a specific credit card.
 *
 * Each provider gets its own persistent browser profile (some issuers, like
 * Hapoalim, trust a device after a one-time SMS login).
 */
export interface Provider {
  source: string;
  accountType: "bank" | "card";
  companyId: CompanyTypes;
  credentials: Record<string, string>;
  profileDir: string;
}

function has(...names: string[]): boolean {
  return names.every((n) => !!process.env[n]);
}

/**
 * Build the list of providers from env vars. A provider is included only if
 * all of its credential vars are present, so you can enable institutions
 * incrementally.
 */
export function providersFromEnv(): Provider[] {
  const base = process.env.PROFILES_DIR ?? "./.profiles";
  const providers: Provider[] = [];

  if (has("HAPOALIM_USER_CODE", "HAPOALIM_PASSWORD")) {
    providers.push({
      source: "hapoalim",
      accountType: "bank",
      companyId: CompanyTypes.hapoalim,
      credentials: {
        userCode: process.env.HAPOALIM_USER_CODE!,
        password: process.env.HAPOALIM_PASSWORD!,
      },
      // Keep the existing trusted-profile path for back-compat.
      profileDir: process.env.HAPOALIM_PROFILE_DIR ?? "./.hapoalim-profile",
    });
  }

  if (has("ISRACARD_ID", "ISRACARD_CARD6", "ISRACARD_PASSWORD")) {
    providers.push({
      source: "isracard",
      accountType: "card",
      companyId: CompanyTypes.isracard,
      credentials: {
        id: process.env.ISRACARD_ID!,
        card6Digits: process.env.ISRACARD_CARD6!,
        password: process.env.ISRACARD_PASSWORD!,
      },
      profileDir: process.env.ISRACARD_PROFILE_DIR ?? `${base}/isracard`,
    });
  }

  if (has("MAX_USERNAME", "MAX_PASSWORD")) {
    providers.push({
      source: "max",
      accountType: "card",
      companyId: CompanyTypes.max,
      credentials: {
        username: process.env.MAX_USERNAME!,
        password: process.env.MAX_PASSWORD!,
      },
      profileDir: process.env.MAX_PROFILE_DIR ?? `${base}/max`,
    });
  }

  return providers;
}
