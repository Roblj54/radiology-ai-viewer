import fs from "fs";
import { chromium } from "playwright";

const logFile = process.argv[2];
const url = process.argv[3];

function write(line) { fs.appendFileSync(logFile, line + "\n"); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();

  page.on("console", msg => write(`[console:${msg.type()}] ${msg.text()}`));
  page.on("pageerror", err => write(`[pageerror] ${err && err.stack ? err.stack : String(err)}`));
  page.on("requestfailed", req => write(`[requestfailed] ${req.url()} ${req.failure() ? req.failure().errorText : ""}`));

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2000);

  await browser.close();
})();
