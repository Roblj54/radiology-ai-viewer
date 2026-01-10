import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const outJson = process.argv[2];
const url = process.argv[3];
const dicomPath = process.argv[4];

function summarizeText() {
  const txt = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
  const slice = (txt.match(/Corte\s*\d+\s*\/\s*\d+/i) || [""])[0];
  const noSeries =
    /No series loaded yet/i.test(txt) ||
    /No series loaded/i.test(txt) ||
    /No hay series/i.test(txt);
  return { sliceText: slice, noSeries, textLen: txt.length };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const logs = [];
  page.on("console", (msg) => logs.push({ type: "console:" + msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => logs.push({ type: "pageerror", text: err && err.stack ? err.stack : String(err) }));
  page.on("requestfailed", (req) =>
    logs.push({ type: "requestfailed", text: req.url() + " " + (req.failure() ? req.failure().errorText : "") })
  );

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(800);

  const pre = await page.evaluate(summarizeText);

  const fileInputs = await page.locator('input[type="file"]').count();
  let fileSet = false;

  if (fileInputs > 0) {
    await page.setInputFiles('input[type="file"]', dicomPath);
    fileSet = true;
  } else {
    const btn = page.getByRole("button", { name: /Seleccionar archivos DICOM|Select DICOM/i });
    if ((await btn.count()) > 0) {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 8000 }),
        btn.first().click()
      ]);
      await chooser.setFiles(dicomPath);
      fileSet = true;
    }
  }

  await page.waitForTimeout(2500);

  const post = await page.evaluate(summarizeText);

  await browser.close();

  const errCount = logs.filter(x =>
    x.type === "pageerror" ||
    x.type === "requestfailed" ||
    x.type === "console:error"
  ).length;

  fs.writeFileSync(outJson, JSON.stringify({ url, dicomPath, fileInputs, fileSet, pre, post, errCount, logs }, null, 2), "utf8");
})();
