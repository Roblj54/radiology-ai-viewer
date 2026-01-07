import fs from "fs";
import { chromium } from "playwright";

const outJson = process.argv[2];
const url1 = process.argv[3];
const url2 = process.argv[4];

async function probe(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on("pageerror", err => logs.push({ type: "pageerror", text: err && err.stack ? err.stack : String(err) }));
  page.on("requestfailed", req => logs.push({ type: "requestfailed", text: req.url() + " " + (req.failure() ? req.failure().errorText : "") }));

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => {
    const root = document.getElementById("root");
    const h = root ? root.getBoundingClientRect().height : 0;
    const txt = root ? (root.innerText || "").trim().length : 0;
    const cc = root ? root.children.length : 0;
    return { rootExists: !!root, childCount: cc, textLen: txt, height: h };
  });

  await browser.close();
  return { info, logs };
}

(async () => {
  const a = await probe(url1);
  const b = await probe(url2);
  fs.writeFileSync(outJson, JSON.stringify({ a, b }, null, 2), "utf8");
})();
