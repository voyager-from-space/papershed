// acceptance checks for papershed in headless Chrome: real #file upload, real download, unzip and assert.
// local: node scripts/verify.mjs   live: BASE_URL=https://voyager-from-space.github.io/papershed/ SHOTS=screenshots/live node scripts/verify.mjs
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const root = new URL("..", import.meta.url).pathname;
const PORT = 4182, LIVE = process.env.BASE_URL, BASE = LIVE || `http://127.0.0.1:${PORT}/`;
const SHOTS = root + (process.env.SHOTS || "screenshots/local"), OUT = root + "test/out";
const FIX = root + "test/fixtures/sample-paper.zip";
mkdirSync(SHOTS, { recursive: true }); mkdirSync(OUT, { recursive: true });
const JSZip = createRequire(import.meta.url)(root + "site/vendor/jszip.min.js");
const server = LIVE ? { kill() {} } : spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", root + "site"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let pass = 0, fail = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); c ? pass++ : fail++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/google/chrome/chrome" });

async function open(viewport) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, deviceScaleFactor: viewport.width < 500 ? 2 : 1 });
  const p = await ctx.newPage();
  const errors = [], external = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  p.on("request", (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith("blob:") && !r.url().startsWith("data:")) external.push(r.url()); });
  await p.goto(`${BASE}?cb=${Date.now()}`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  return { p, ctx, errors, external };
}
async function upload(p) {
  await p.setInputFiles("#file", FIX);
  await p.waitForSelector("#results:not([hidden]) #leaks li", { timeout: 90000 });
}
async function download(p, name) {
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#download")]);
  const path = `${OUT}/${name}`;
  await dl.saveAs(path);
  return readFileSync(path);
}
const sha = (b) => createHash("sha256").update(b).digest("hex");
const fixtureBytes = readFileSync(FIX).length;

// (a) page loads, title has the name
const d = await open({ width: 1280, height: 860 });
ok((await d.p.title()).includes("papershed"), `(a) title has the name: "${await d.p.title()}"`);
await d.p.screenshot({ path: `${SHOTS}/desktop-start.png` });

// (b) real upload shows the report
await upload(d.p);
const title = await d.p.textContent("#res-title"), sub = await d.p.textContent("#res-sub");
ok(title.includes((fixtureBytes / 1024 / 1024).toFixed(1) + " MB in"), `(b) report shows the measured input size (${fixtureBytes} bytes): "${title}"`);
ok(/possible leak/.test(sub), `(b) report summary: "${sub}"`);
await d.p.waitForTimeout(400);
await d.p.screenshot({ path: `${SHOTS}/desktop-result.png` });
await d.p.screenshot({ path: `${SHOTS}/desktop-result-full.png`, fullPage: true });

// (c) cleaned zip downloads; unzip and inspect
const zipBuf = await download(d.p, "sample-paper-clean.zip");
const shownBytes = Number(await d.p.getAttribute("#download", "data-bytes"));
ok(zipBuf.length === shownBytes && zipBuf.length > 0, `(c) downloaded zip is ${zipBuf.length} bytes, page says ${shownBytes}`);
const z = await JSZip.loadAsync(zipBuf);
const names = Object.keys(z.files).filter((n) => !z.files[n].dir).sort();
const txt = async (n) => (z.files[n] ? z.files[n].async("string") : "");
const bin = async (n) => (z.files[n] ? z.files[n].async("uint8array") : new Uint8Array());
const tex = (await txt("main.tex")) + "\n" + (await txt("sections/intro.tex"));
const planted = ["PLANTED-JOIN-COMMENT", "PLANTED-INLINE", "PLANTED-FIGURE-COMMENT", "PLANTED-INTRO", "TODO: answer reviewer", "hunter2-EXAMPLE", "AKIAIOSFODNN7EXAMPLE", "docs.google.com"];
const left = planted.filter((s) => tex.includes(s));
ok(left.length === 0, `(c) no % comment text from the fixture in the .tex files (${planted.length} planted strings, ${left.length} left${left.length ? ": " + left.join(", ") : ""})`);
ok(!tex.includes("PLANTED-COMMENT-ENV") && !tex.includes("PLANTED-IFFALSE") && !/\\begin\{comment\}|\\iffalse/.test(tex), "(c) no comment env or \\iffalse content left");
const keepers = ["KEEP-LSTLISTING-PERCENT", "KEEP-VERBATIM-PERCENT", "12\\% on the benchmark", "\\title{A sample paper}%", "\\includegraphics[width=.8\\linewidth]{field-site}%"];
const lost = keepers.filter((s) => !tex.includes(s));
ok(lost.length === 0, `(c) escaped \\%, verbatim/lstlisting % and line-joining % survive (${keepers.length - lost.length}/${keepers.length})${lost.length ? ": lost " + lost.join(", ") : ""}`);
const unused = ["sections/old-draft.tex", "refs-old.bib", "figures/unused-photo.jpg", "figures/scratch.png", "notes.txt", "main.pdf"];
ok(unused.every((n) => !names.includes(n)), `(c) unused files gone (${unused.filter((n) => !names.includes(n)).length}/${unused.length})`);
const used = ["main.tex", "sections/intro.tex", "mystyle.sty", "refs.bib", "main.bbl", "figures/field-site.jpg", "figures/pipeline.png", "figures/plot.pdf", "CLEAN-REPORT.txt"];
ok(used.every((n) => names.includes(n)), `(c) used files present (${used.filter((n) => names.includes(n)).length}/${used.length}); zip has ${names.length} files: ${names.join(" ")}`);
const junk = names.filter((n) => /__MACOSX|\.DS_Store|\.(aux|log|out|fls|fdb_latexmk|synctex\.gz)$|^sample-paper\//.test(n));
ok(junk.length === 0, `(c) junk files gone and top folder flattened (${junk.length} left)`);
const jpg = await bin("figures/field-site.jpg");
let app1 = false;
for (let i = 2; i + 4 < jpg.length && jpg[i] === 0xff && jpg[i + 1] !== 0xda; i += 2 + ((jpg[i + 2] << 8) | jpg[i + 3])) if (jpg[i + 1] === 0xe1) app1 = true;
const hasGpsTag = Buffer.from(jpg).includes(Buffer.from([0x88, 0x25]));
const origZip = await JSZip.loadAsync(readFileSync(FIX));
const origJpg = await origZip.files["sample-paper/figures/field-site.jpg"].async("uint8array");
const w = (jpg[0] === 0xff) ? (() => { for (let i = 2; i + 9 < jpg.length;) { const m = jpg[i + 1], len = (jpg[i + 2] << 8) | jpg[i + 3]; if (m >= 0xc0 && m <= 0xc2) return [(jpg[i + 7] << 8) | jpg[i + 8], (jpg[i + 5] << 8) | jpg[i + 6]]; i += 2 + len; } })() : null;
ok(jpg.length > 0 && !app1 && !Buffer.from(jpg).includes(Buffer.from("Exif\0")), `(c) JPEG has no EXIF/APP1 segment (GPS IFD tag bytes present: ${hasGpsTag ? "pattern in image data only" : "no"})`);
ok(w && Math.max(...w) <= 2000 && jpg.length < origJpg.length, `(c) oversized JPEG capped: ${w?.join("×")} px, ${origJpg.length} -> ${jpg.length} bytes`);
const png = Buffer.from(await bin("figures/pipeline.png"));
const chunks = []; for (let i = 8; i + 8 <= png.length;) { const len = png.readUInt32BE(i); chunks.push(png.toString("latin1", i + 4, i + 8)); i += 12 + len; }
ok(png.length > 0 && !chunks.some((c) => ["tEXt", "iTXt", "zTXt", "eXIf"].includes(c)), `(c) PNG has no text chunks (chunks: ${chunks.join(",")})`);
const pdf = Buffer.from(await bin("figures/plot.pdf")).toString("latin1");
ok(pdf.startsWith("%PDF") && !pdf.includes("A. Fake Student") && !pdf.includes("fakeuser"), "(c) PDF figure Info/XMP author strings blanked");
const rep = await txt("CLEAN-REPORT.txt");
ok(rep.length > 0 && !/hunter2|AKIAIOSFODNN7EXAMPLE|ghp_FAKE|48\.85/.test(rep), "(c) CLEAN-REPORT.txt has no secret values or coordinates");

// determinism: the same upload again gives the same bytes
await d.p.reload({ waitUntil: "networkidle" });
await upload(d.p);
const again = await download(d.p, "sample-paper-clean-2.zip");
ok(sha(again) === sha(zipBuf), `(c) same input, same zip (sha256 ${sha(zipBuf).slice(0, 12)})`);

// (d) report flags the fake credential, the cloud link and the GPS image
const rules = await d.p.$$eval("#leaks li", (els) => els.map((e) => e.dataset.rule));
ok(rules.includes("password") && rules.includes("aws-key"), `(d) fake password and AWS-style key flagged (${rules.filter((r) => r === "password" || r === "aws-key").length})`);
ok(rules.filter((r) => r === "cloud-link").length >= 2, `(d) cloud links flagged (${rules.filter((r) => r === "cloud-link").length}: dropbox, drive/docs, overleaf)`);
const gpsText = await d.p.$eval('#leaks li[data-rule="gps"]', (e) => e.textContent).catch(() => "");
ok(gpsText.includes("field-site.jpg"), `(d) GPS image flagged: "${gpsText.slice(0, 80)}"`);
const pageText = await d.p.textContent("body");
ok(!pageText.includes("hunter2-EXAMPLE") && !pageText.includes("AKIAIOSFODNN7EXAMPLE"), "(d) on-page report masks secret values");
ok((await d.p.textContent("#results")).includes("heuristic"), "(d) copy says the secret scan is a heuristic");
const stats = await d.p.$$eval("#stats div", (els) => Object.fromEntries(els.map((e) => [e.dataset.stat, [...e.querySelectorAll("dd")].map((x) => x.textContent).join(" ")])));
console.log("      measured:", JSON.stringify(stats), "leak rows:", rules.length, "rules:", rules.join(","));
ok(d.errors.length === 0, `no console errors (${d.errors.join(" | ")})`);
ok(d.external.length === 0, `no requests outside the site (${d.external.length})`);

// sample button works too
await d.p.reload({ waitUntil: "networkidle" });
await d.p.click("#sample");
await d.p.waitForSelector("#results:not([hidden]) #leaks li", { timeout: 90000 });
ok((await d.p.textContent("#res-sub")).includes("sample-paper.zip"), "try-a-sample loads and cleans the sample zip");
await d.ctx.close();

// (e) mobile renders without horizontal overflow
const m = await open({ width: 390, height: 844 });
const over = () => m.p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const o1 = await over();
await m.p.screenshot({ path: `${SHOTS}/mobile-start.png` });
await upload(m.p);
await m.p.waitForTimeout(400);
const o2 = await over();
await m.p.screenshot({ path: `${SHOTS}/mobile-result.png` });
ok(o1 <= 0 && o2 <= 0, `(e) 390 px wide: no horizontal overflow (start ${o1}px, after result ${o2}px)`);
await m.ctx.close();

// (f) denylist: repo tree (check-identity.sh) and the served HTML/JS/CSS/sample
const denyFile = root + ".identity-denylist";
const deny = existsSync(denyFile) ? readFileSync(denyFile, "utf8").split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean) : [];
ok(deny.length > 0, `(f) denylist loaded (${deny.length} patterns)`);
let repoOk = true;
try { execFileSync("sh", [root + "scripts/check-identity.sh"], { stdio: "pipe" }); } catch { repoOk = false; }
ok(repoOk, "(f) check-identity.sh: 0 hits over the repo");
const served = ["", "app.js", "clean.js", "image.js", "styles.css", "favicon.svg", "sample/sample-paper.zip"];
let hits = [];
for (const f of served) {
  const r = await fetch(BASE + f);
  const body = Buffer.from(await r.arrayBuffer());
  let s = body.toString("latin1").toLowerCase();
  if (f.endsWith(".zip")) { const sz = await JSZip.loadAsync(body); for (const n of Object.keys(sz.files)) s += n.toLowerCase() + (await sz.files[n].async("string")).toLowerCase(); }
  for (const pat of deny) if (s.includes(pat)) hits.push(`${f || "index.html"}`);
}
ok(hits.length === 0, `(f) denylist grep over ${served.length} served files at ${LIVE ? "live" : "local"} URL: ${hits.length} hits`);

await browser.close();
server.kill();
console.log(`\n${pass}/${pass + fail} passed${LIVE ? " (live " + BASE + ")" : " (local)"}`);
process.exit(fail ? 1 : 0);
