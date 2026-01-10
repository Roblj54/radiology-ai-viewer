import fs from "fs";
import { chromium } from "playwright";

const outJson  = process.argv[2];
const url      = process.argv[3];
const listJson = process.argv[4];

const dicomFiles = JSON.parse(fs.readFileSync(listJson, "utf8"));

function summarizeText() {
  const txt = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
  const slice =
    (txt.match(/Corte\s*\d+\s*\/\s*\d+/i) || txt.match(/Slice\s*\d+\s*\/\s*\d+/i) || [""])[0];

  const noSeries =
    /No series loaded/i.test(txt) ||
    /No series loaded yet/i.test(txt) ||
    /No hay series/i.test(txt);

  let denom = 0;
  const m = slice.match(/(\d+)\s*\/\s*(\d+)/);
  if (m) denom = parseInt(m[2], 10) || 0;

  return { sliceText: slice, denom, noSeries, textLen: txt.length };
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
    await page.setInputFiles('input[type="file"]', dicomFiles);
    fileSet = true;
  } else {
    const btn = page.getByRole("button", { name: /Seleccionar archivos DICOM|Select DICOM/i });
    if ((await btn.count()) > 0) {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 12000 }),
        btn.first().click()
      ]);
      await chooser.setFiles(dicomFiles);
      fileSet = true;
    }
  }

  // Wait up to 90s for UI to reflect loaded series
  let post = await page.evaluate(summarizeText);
  for (let i = 0; i < 90; i++) {
    if (!post.noSeries && post.denom >= 1) break;
    await page.waitForTimeout(1000);
    post = await page.evaluate(summarizeText);
  }

  await browser.close();

  const errCount = logs.filter(x =>
    x.type === "pageerror" ||
    x.type === "requestfailed" ||
    x.type === "console:error"
  ).length;

  fs.writeFileSync(outJson, JSON.stringify({
    url,
    fileInputs,
    fileSet,
    fileCount: dicomFiles.length,
    firstFile: dicomFiles[0],
    pre,
    post,
    errCount,
    logs
  }, null, 2), "utf8");
})();