// measures what the compile check downloads from the live asset host: bytes on the wire per run.
// usage: PROFILE=<dir> [FILE=test/fixtures/sample-paper.zip] [BASE_URL=...] node scripts/measure-download.mjs
import { chromium } from "playwright";
const BASE = process.env.BASE_URL || "https://voyager-from-space.github.io/papershed/";
const FILE = process.env.FILE || "test/fixtures/sample-paper.zip";
const ctx = await chromium.launchPersistentContext(process.env.PROFILE, { executablePath: process.env.CHROME || "/opt/google/chrome/chrome", headless: true, viewport: { width: 1280, height: 900 } });
const page = ctx.pages()[0] || (await ctx.newPage());
let wire = 0, n = 0, byHost = {};
ctx.on("requestfinished", async (r) => {
  try { const s = await r.sizes(); const h = new URL(r.url()).host; wire += s.responseBodySize + s.responseHeadersSize; n++; byHost[h] = (byHost[h] || 0) + s.responseBodySize; } catch {}
});
await page.goto(BASE + "?cb=" + Date.now(), { waitUntil: "networkidle" });
await page.setInputFiles("#file", FILE);
await page.waitForSelector("#results:not([hidden]) #leaks li", { timeout: 180000 });
wire = 0; n = 0; byHost = {};
const t0 = Date.now();
await page.click("#build-btn");
await page.waitForSelector("#build-out:not([hidden]) [data-verdict]", { timeout: 20 * 60_000 });
await new Promise((r) => setTimeout(r, 1500));
const secs = (Date.now() - t0) / 1000;
console.log(JSON.stringify({ when: new Date().toISOString(), verdict: await page.getAttribute("#build-out [data-verdict]", "data-verdict"), secs, requests: n, wireBytes: wire, wireMB: +(wire / 1e6).toFixed(1), byHost, uiNote: (await page.textContent("#build-note")).slice(0, 200) }));
await ctx.close();
