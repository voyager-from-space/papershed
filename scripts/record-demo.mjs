#!/usr/bin/env node
// Short demo (20-40 s): drop the zip, the report, the leak flags, then the build check.
// Headless Playwright recordVideo against the live URL. No glides: each view is an instant jump, then a wait,
// so the encoder never sees a scroll in progress.
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE_URL || "https://voyager-from-space.github.io/papershed/";
const ZIP = root + "test/fixtures/sample-paper.zip";
const OUT_DIR = process.env.OUT_DIR || "/tmp/papershed-demo-short";
const FINAL = process.env.FINAL || "/workspace/anon-shipper/share/papershed-launch-demo.webm";
const VIEW = { width: 1280, height: 720 };
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/google/chrome/chrome", args: ["--hide-scrollbars"] });
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1, recordVideo: { dir: OUT_DIR, size: VIEW }, reducedMotion: "reduce" });
const page = await context.newPage();
const view = async (sel, pad, ms) => {
  await page.evaluate(([sel, pad]) => { const y = document.querySelector(sel).getBoundingClientRect().top + window.scrollY - pad; window.scrollTo({ top: y, behavior: "instant" }); }, [sel, pad]);
  await page.waitForTimeout(500);                       // let the compositor settle before the held shot
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(ms);
};

await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200);
await page.evaluate(() => document.getElementById("drop").classList.add("over"));
await page.waitForTimeout(600);
await page.setInputFiles("#file", ZIP);
await page.evaluate(() => document.getElementById("drop").classList.remove("over"));
await page.waitForSelector("#results:not([hidden]) #leaks li", { timeout: 90000 });
await view("#results", 16, 3200);                       // 4.6 MB in, 1.3 MB out, download button
await view("#leaks", 40, 3800);                         // GPS photo, PDF metadata, password, keys
await view("#abs-sum", 120, 3200);                      // abstract check
await view("#build-btn", 230, 900);
await page.click("#build-btn");                         // loads TeX Live, builds in the tab
await page.waitForSelector("#build-out:not([hidden]) [data-verdict]", { timeout: 300000 });
await page.waitForTimeout(600);
await view("#build-out", 330, 3600);                    // it builds, 2 pages
await context.close();
await browser.close();
const vid = readdirSync(OUT_DIR).find((f) => f.endsWith(".webm"));
renameSync(`${OUT_DIR}/${vid}`, FINAL);
console.log("saved " + FINAL);
