import fs from "fs";
import { chromium } from "playwright";

const outJson = process.argv[2];
const url1 = process.argv[3];
const url2 = process.argv[4];
const shot1 = process.argv[5];
const shot2 = process.argv[6];

async function probe(page, url, shotPath) {
  const logs = [];
  page.on("console", msg => logs.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", err => logs.push({ type: "pageerror", text: err && err.stack ? err.stack : String(err) }));
  page.on("requestfailed", req => logs.push({ type: "requestfailed", text: req.url() + " " + (req.failure() ? req.failure().errorText : "") }));

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const root = document.getElementById("root");
    const body = document.body;
    const style = root ? window.getComputedStyle(root) : null;
    return {
      url: location.href,
      title: document.title || "",
      rootExists: !!root,
      rootChildCount: root ? root.children.length : 0,
      rootTextLen: root ? (root.innerText || "").trim().length : 0,
      rootHtmlLen: root ? (root.innerHTML || "").length : 0,
      rootDisplay: style ? style.display : "",
      rootVisibility: style ? style.visibility : "",
      rootHeight: root ? root.getBoundingClientRect().height : 0,
      bodyHeight: body ? body.getBoundingClientRect().height : 0
    };
  });

  await page.screenshot({ path: shotPath, fullPage: true });
  return { info, logs };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const pageA = await context.newPage();
  const a = await probe(pageA, url1, shot1);

  const pageB = await context.newPage();
  const b = await probe(pageB, url2, shot2);

  await browser.close();

  fs.writeFileSync(outJson, JSON.stringify({ a, b }, null, 2), "utf8");
})();
