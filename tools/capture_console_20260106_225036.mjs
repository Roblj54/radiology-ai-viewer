import fs from "fs";
import { chromium } from "playwright";

const logFile = process.argv[2];
const url = process.argv[3];

function write(line) { fs.appendFileSync(logFile, line + "\n"); }

(async () => {
  try {
    const browser = await chromium.launch({
      headless: false,
      args: ["--proxy-server=direct://", "--proxy-bypass-list=*"]
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    page.on("console", msg => write(`[console:${msg.type()}] ${msg.text()}`));
    page.on("pageerror", err => write(`[pageerror] ${err && err.stack ? err.stack : String(err)}`));
    page.on("requestfailed", req => write(`[requestfailed] ${req.url()} ${req.failure() ? req.failure().errorText : ""}`));

    await page.goto(url, { waitUntil: "commit", timeout: 120000 });
    try { await page.waitForLoadState("domcontentloaded", { timeout: 120000 }); } catch {}
    await page.waitForTimeout(1500);

    console.log("Browser opened. Click around. Press ENTER in PowerShell to stop capture.");
    process.stdin.resume();
    await new Promise(res => process.stdin.once("data", res));

    await browser.close();
  } catch (e) {
    write(`[fatal] ${e && e.stack ? e.stack : String(e)}`);
    throw e;
  }
})();
