import fs from "fs";
import { chromium } from "playwright";

const logFile = process.argv[2];
const url = process.argv[3];
function write(line) { fs.appendFileSync(logFile, line + "\n"); }

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

page.on("console", msg => write([console:] ));
page.on("pageerror", err => write([pageerror] ));
page.on("requestfailed", req => write([requestfailed]  ));

await page.goto(url, { waitUntil: "domcontentloaded" });

console.log("Browser opened. Click AI Findings buttons too. Press ENTER in PowerShell to stop capture.");
process.stdin.resume();
await new Promise(res => process.stdin.once("data", res));

await browser.close();
