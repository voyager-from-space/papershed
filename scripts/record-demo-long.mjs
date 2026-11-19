#!/usr/bin/env node
// Headless Playwright demo against the live page. No browser chrome, no desktop capture.
// Usage: BASE_URL=https://voyager-from-space.github.io/papershed/ node scripts/record-demo.mjs
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE_URL || "https://voyager-from-space.github.io/papershed/";
const ZIP = root + "test/fixtures/sample-paper.zip";
const OUT_DIR = process.env.OUT_DIR || "/workspace/anon-shipper/share/papershed-demo";
const VIEW = { width: 1280, height: 720 };
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/google/chrome/chrome", args: ["--hide-scrollbars"] });
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, recordVideo: { dir: OUT_DIR, size: VIEW }, acceptDownloads: true, reducedMotion: "reduce" });
await context.addInitScript(() => {
  const orig = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () { orig.call(this, { block: "start", behavior: "instant" }); };
});
const page = await context.newPage();
const glide = (dy, steps = 30) => page.evaluate(async ([dy, steps]) => {
  const y0 = window.scrollY;
  for (let i = 1; i <= steps; i++) { window.scrollTo(0, y0 + (dy * i) / steps); await new Promise((r) => setTimeout(r, 33)); }
}, [dy, steps]);

await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);
await page.evaluate(() => document.getElementById("drop").classList.add("over")); // the drop target lighting up
await page.waitForTimeout(700);
await page.setInputFiles("#file", ZIP);
await page.evaluate(() => document.getElementById("drop").classList.remove("over"));
await page.waitForSelector("#results:not([hidden]) #leaks li", { timeout: 90000 });
await page.evaluate(() => window.scrollTo(0, document.getElementById("results").offsetTop - 16));
await page.waitForTimeout(4000);                  // result: bytes in/out, leaks count, download button
await glide(330); await page.waitForTimeout(2500); // GPS photo, PDF metadata, password
await glide(330); await page.waitForTimeout(2500); // key, token, cloud links
await glide(330); await page.waitForTimeout(2000);
const toId = (id, pad = 90) => page.evaluate(([id, pad]) => window.scrollTo(0, document.getElementById(id).getBoundingClientRect().top + window.scrollY - pad), [id, pad]);
const ease = async (id, pad = 90) => { const dy = await page.evaluate(([id, pad]) => document.getElementById(id).getBoundingClientRect().top - pad, [id, pad]); await glide(dy, 36); };
await ease("abs-sum", 110); await page.waitForTimeout(4500);   // abstract check against arXiv's rules
await ease("abs-paste", 150); await page.waitForTimeout(600);
await page.click("#abs-paste");
await page.keyboard.type("We study caf\u00e9 queues. Abstract: results are ~10% better.", { delay: 45 });
await page.waitForTimeout(800);
await glide(160, 16); await page.waitForTimeout(3500);          // pasted text checked the same way
await ease("size-sum", 110); await page.waitForTimeout(4500);   // size against arXiv's limit, with sources
await ease("build-btn", 200); await page.waitForTimeout(1200);
await page.click("#build-btn");                                 // lazy-loads TeX Live, builds in the tab
await page.waitForSelector("#build-out:not([hidden]) [data-verdict]", { timeout: 300000 });
await page.waitForTimeout(3500);
await ease("images", 90); await page.waitForTimeout(2500);
await glide(300); await page.waitForTimeout(1800);
await page.evaluate(() => window.scrollTo(0, document.getElementById("results").offsetTop - 16));
await page.waitForTimeout(1200);
await page.hover("#download"); await page.waitForTimeout(500);
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#download")]);
await dl.saveAs(OUT_DIR + "/downloaded-clean.zip");
await page.waitForTimeout(3500);
await context.close();
await browser.close();
const vid = readdirSync(OUT_DIR).find((f) => f.endsWith(".webm"));
renameSync(`${OUT_DIR}/${vid}`, "/workspace/anon-shipper/share/papershed-launch-demo.webm");
console.log("saved /workspace/anon-shipper/share/papershed-launch-demo.webm");
