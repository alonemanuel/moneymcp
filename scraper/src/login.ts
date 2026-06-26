#!/usr/bin/env node
/**
 * One-time trusted-session bootstrap for Bank Hapoalim.
 *
 * Hapoalim sends an SMS code on every NEW-device login. The library's
 * automated scrape() can't type a code that arrives on your phone — so we do
 * the login ONCE here, by hand, in a visible browser using a PERSISTENT
 * profile. After this, the scraper reuses that profile headlessly and Hapoalim
 * treats it as a known device (no OTP, until it eventually re-challenges).
 *
 * Run locally:  BROWSER_PROFILE_DIR=./.hapoalim-profile npm run login
 * Then archive the profile dir and store it as the encrypted GitHub secret the
 * scraper restores in CI (see stack.md / provisioning).
 */
import puppeteer from "puppeteer";

const profileDir = process.env.BROWSER_PROFILE_DIR ?? "./.hapoalim-profile";
const LOGIN_URL = "https://login.bankhapoalim.co.il/";

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
}

async function main(): Promise<void> {
  console.log(`\nOpening a browser using profile: ${profileDir}`);
  console.log("1) Log in to Bank Hapoalim and complete the SMS code.");
  console.log("2) Reach your account overview (so the device is trusted).");
  console.log("3) Come back here and press Enter to save the session and close.\n");

  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: profileDir,
    defaultViewport: null,
    args: ["--start-maximized"],
  });
  const [page] = await browser.pages();
  await (page ?? (await browser.newPage())).goto(LOGIN_URL, {
    waitUntil: "domcontentloaded",
  });

  await waitForEnter();
  await browser.close();

  console.log(`\nSaved. Trusted profile persisted at: ${profileDir}`);
  console.log("Next: archive it and store as the GitHub secret the scraper restores.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
