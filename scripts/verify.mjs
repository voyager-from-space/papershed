// acceptance checks for papershed in headless Chrome: real #file upload, real download, unzip and assert.
// local: node scripts/verify.mjs   live: BASE_URL=https://voyager-from-space.github.io/papershed/ SHOTS=screenshots/live node scripts/verify.mjs
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const PORT = 4182, LIVE = process.env.BASE_URL, BASE = LIVE || `http://127.0.0.1:${PORT}/`;
const SHOTS = root + (process.env.SHOTS || "screenshots/local"), OUT = root + "test/out";
const FIX = root + "test/fixtures/sample-paper.zip";
mkdirSync(SHOTS, { recursive: true }); mkdirSync(OUT, { recursive: true });
const JSZip = createRequire(import.meta.url)(root + "site/vendor/jszip.min.js");
const server = LIVE ? { kill() {} } : spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", root + "site"], { stdio: "ignore" });
const ASSETS_PORT = 4183, ASSETS_DIR = process.env.ASSETS_DIR || root + "../maketitle-assets";
const assetServer = LIVE ? { kill() {} } : spawn("node", [root + "scripts/serve-assets.mjs", ASSETS_DIR, String(ASSETS_PORT)], { stdio: "ignore" });
const ASSET_ORIGIN = LIVE ? "https://voyager-from-space.github.io/maketitle-assets/" : `http://127.0.0.1:${ASSETS_PORT}/`;
const QS = LIVE ? "" : `&assets=${encodeURIComponent(ASSET_ORIGIN)}`;
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
  const seen = []; p.on("request", (r) => seen.push(r.url()));
  await p.goto(`${BASE}?cb=${Date.now()}${QS}`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  return { p, ctx, errors, external, seen };
}
async function upload(p, file = FIX) {
  await p.setInputFiles("#file", file);
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


// ---------- new in this version: abstract, size, compressed PDF metadata, compile check ----------
const read = (zipBuf2, n) => JSZip.loadAsync(zipBuf2).then((zz) => zz.files[n] && zz.files[n].async("uint8array"));
const x = await open({ width: 1280, height: 900 });
await upload(x.p);
const xdl = await download(x.p, "sample-paper-clean-3.zip");
const xz = await JSZip.loadAsync(xdl);
const xtxt = async (n) => (xz.files[n] ? xz.files[n].async("string") : "");

// (g) abstract check
const mainTex = await xtxt("main.tex");
const absRaw = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/.exec(mainTex)[1].trim();
const expectChars = [...absRaw.replace(/\r?\n(?![ \t])/g, " ")].length;
const absSum = await x.p.textContent("#abs-sum");
ok(absSum.includes("main.tex") && absSum.includes(`${expectChars} of 1,920`), `(g) abstract found in main.tex, count matches an independent count of the unzipped output: ${expectChars} of 1,920 ("${absSum}")`);
const absRules = await x.p.$$eval("#abs-issues li", (els) => els.map((e) => `${e.dataset.rule}:${e.dataset.level}`));
ok(["abstract-ascii:problem", "abstract-texisms:advice", "abstract-macros:note"].every((r) => absRules.includes(r)) && absRules.length === 3, `(g) the planted curly quotes, tie and citation are flagged with the right level and nothing else (${absRules.join(", ")})`);
const asciiTxt = await x.p.$eval('#abs-issues li[data-rule="abstract-ascii"]', (e) => e.textContent);
ok(asciiTxt.includes("U+201C") && asciiTxt.includes("``") && asciiTxt.includes("U+201D") && asciiTxt.includes("''"), "(g) curly quotes are named with their code points and the TeX replacement from arXiv's page");
await x.p.fill("#abs-paste", "x".repeat(1920));
let ps = await x.p.textContent("#paste-sum"), pr = await x.p.$$eval("#paste-issues li", (e) => e.map((y) => y.dataset.rule));
ok(ps.includes("1,920 of 1,920") && !pr.includes("abstract-length"), `(g) exactly 1920 characters passes: "${ps}"`);
await x.p.fill("#abs-paste", "x".repeat(1921));
ps = await x.p.textContent("#paste-sum"); pr = await x.p.$$eval("#paste-issues li", (e) => e.map((y) => y.dataset.rule + ":" + y.dataset.level));
ok(ps.includes("1,921 of 1,920") && pr.includes("abstract-length:problem"), `(g) 1921 characters is a problem: "${ps}" ${pr.join(",")}`);
await x.p.fill("#abs-paste", "Abstract: We show that  \\em it works.\n  Indented line.\n\nCaf\u00e9 \ufb01nal.");
pr = await x.p.$$eval("#paste-issues li", (e) => e.map((y) => y.dataset.rule));
ok(["abstract-ascii", "abstract-word", "abstract-fonts", "abstract-indent", "abstract-blank"].every((r) => pr.includes(r)), `(g) pasted text: non-ASCII, leading "Abstract", font command, indented line, blank line all flagged (${pr.join(",")})`);
await x.p.fill("#abs-paste", "We show that it works on 3 datasets.");
ok((await x.p.textContent("#paste-issues")).includes("Nothing here breaks a rule"), "(g) clean pasted text says nothing breaks a rule, without promising acceptance");
ok((await x.p.textContent("#results")).includes("info.arxiv.org/help/prep.html") || (await x.p.$eval('#results a[href="https://info.arxiv.org/help/prep.html"]', (a) => a.href).catch(() => "")).includes("prep.html"), "(g) the rules link to arXiv's metadata page");

// (h) size check
const zipRow = await x.p.textContent('#size-rows [data-row="zip"]'), unRow = await x.p.textContent('#size-rows [data-row="unpacked"]');
let unpackedSum = 0; for (const n of Object.keys(xz.files)) if (!xz.files[n].dir && n !== "CLEAN-REPORT.txt") unpackedSum += (await xz.files[n].async("uint8array")).length;
const grp = (n) => n.toLocaleString("en-US");
ok(zipRow.includes(grp(xdl.length) + " bytes") && zipRow.includes(grp(fixtureBytes) + " bytes"), `(h) zip row shows the real downloaded size ${grp(xdl.length)} and the original ${grp(fixtureBytes)} bytes`);
ok(unRow.includes(grp(unpackedSum) + " bytes"), `(h) unpacked row matches the sum of the unzipped files, ${grp(unpackedSum)} bytes`);
ok((await x.p.getAttribute("#size-sum", "data-status")) === "ok", "(h) sample is under arXiv's limit");
for (const [file, label] of [["oversize.zip", "over"], ["bigimage.zip", "bigimage"]]) {
  execFileSync("python3", [root + "scripts/make-test-zips.py"], { stdio: "pipe" });
  await x.p.reload({ waitUntil: "networkidle" });
  await upload(x.p, `${OUT}/${file}`);
  if (label === "over") {
    const st = await x.p.getAttribute("#size-sum", "data-status");
    const big = await x.p.$$eval('#size-rows [data-row="bigfile"]', (e) => e.map((y) => y.textContent));
    const zr = await x.p.textContent('#size-rows [data-row="zip"]');
    ok(st === "over" && zr.includes("Over") && big.length === 1 && big[0].includes("figures/huge.pdf"), `(h) a 52,000,343-byte upload is reported over 50,000,000, with the big figure named (${st}; ${zr.slice(0, 70)})`);
  } else {
    const rows = await x.p.$$eval('#size-rows [data-row="bigimage-fixed"]', (e) => e.map((y) => y.textContent));
    ok(rows.length === 1 && rows[0].includes("36.0 megapixels") && rows[0].includes("resized"), `(h) a 36-megapixel PNG is named in the original and reported resized (${rows[0] || "none"})`);
  }
}

// (i) metadata in compressed object streams
const marker = "PLANTED-COMPRESSED-META";
const scanPdf = (buf) => {
  const s = Buffer.from(buf).toString("latin1"); let n = (s.match(new RegExp(marker, "g")) || []).length, inflated = 0;
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const a = m.index + m[0].length, b = s.indexOf("endstream", a);
    try { const d = zlib.inflateSync(Buffer.from(s.slice(a, b), "latin1")); const c = (d.toString("latin1").match(new RegExp(marker, "g")) || []).length; inflated += c; n += c; } catch { /* not flate */ }
  }
  return { n, inflated };
};
const origZipFile = async (n) => origZip.files[n].async("uint8array");
const origPdf = await origZipFile("sample-paper/figures/compressed.pdf");
const before = scanPdf(origPdf);
ok(before.n >= 3 && before.inflated >= 3, `(i) the input PDF hides the planted metadata in compressed streams (raw grep sees ${before.n - before.inflated}, inflating finds ${before.inflated}), so the scan below can see inside them`);
const outPdf = Buffer.from(await read(xdl, "figures/compressed.pdf"));
const after = scanPdf(outPdf);
ok(after.n === 0, `(i) after cleaning, 0 hits for the planted Info and XMP strings in the PDF, raw or inflated (before: ${before.n})`);
writeFileSync(`${OUT}/compressed-clean.pdf`, outPdf);
let info = "", infoOk = true;
try { info = execFileSync("pdfinfo", [`${OUT}/compressed-clean.pdf`], { stdio: "pipe" }).toString(); } catch { infoOk = false; }
ok(infoOk && /Pages:\s+1/.test(info) && !/PLANTED/.test(info) && /Metadata Stream:\s+no/.test(info) && !/^(Title|Author|Creator|Producer):/m.test(info), `(i) poppler's pdfinfo opens the cleaned PDF (1 page) and shows no Title, Author, Creator, Producer or XMP stream`);
let renderOk = true; try { execFileSync("pdftoppm", ["-r", "30", "-png", `${OUT}/compressed-clean.pdf`, `${OUT}/compressed-clean`], { stdio: "pipe" }); } catch { renderOk = false; }
ok(renderOk && existsSync(`${OUT}/compressed-clean-1.png`), "(i) poppler renders the cleaned PDF page");
const pdfRow = await x.p.$$eval('#leaks li[data-rule="pdf-meta"]', (e) => e.map((y) => y.textContent)).catch(() => []);
await x.p.reload({ waitUntil: "networkidle" });
await upload(x.p);
const pdfRows = await x.p.$$eval('#leaks li[data-rule="pdf-meta"]', (e) => e.map((y) => y.textContent));
ok(pdfRows.some((t) => t.includes("compressed.pdf") && t.includes("rewritten")) && pdfRows.some((t) => t.includes("plot.pdf") && t.includes("Blanked")), "(i) the report says compressed.pdf was rewritten and plot.pdf (uncompressed) was blanked in place");
const plotAfter = Buffer.from(await read(xdl, "figures/plot.pdf")), plotBefore = Buffer.from(await origZipFile("sample-paper/figures/plot.pdf"));
ok(plotAfter.length === plotBefore.length, `(i) the uncompressed PDF is still blanked in place, same length (${plotAfter.length} bytes)`);
ok(x.seen.some((u) => u.endsWith("vendor/pdf-lib.min.js")), "(i) the PDF library loaded for the file that needed it");
const y = await open({ width: 1280, height: 900 });
await upload(y.p, `${OUT}/break-clean.zip`);
ok(!y.seen.some((u) => /pdf-lib|compile\.js|compile-worker/.test(u)), "(i) zips without such PDFs never load the PDF library, and nothing loads the compile code until asked");
await y.ctx.close();
ok(!x.seen.some((u) => /compile\.js|compile-worker|maketitle-assets|127\.0\.0\.1:4183/.test(u)), "(j) before clicking the check, no compile code and no TeX Live request");
await x.ctx.close();

// (j) compile check, in a profile that keeps TeX Live between runs (set VERIFY_PROFILE to a fresh dir to measure the first download)
const profile = process.env.VERIFY_PROFILE || `${OUT}/profile`;
const cc = await (await import("playwright")).chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME || "/opt/google/chrome/chrome", headless: true, acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const cp = cc.pages()[0] || (await cc.newPage());
const cerr = [], creq = [];
cp.on("pageerror", (e) => cerr.push(e.message));
cp.on("request", (r) => creq.push(r.url()));
async function runBuild(file, label) {
  await cp.goto(`${BASE}?cb=${Date.now()}${QS}`, { waitUntil: "networkidle" });
  await cp.setInputFiles("#file", file);
  await cp.waitForSelector("#results:not([hidden]) #leaks li", { timeout: 180000 });
  const t0 = Date.now();
  await cp.click("#build-btn");
  await cp.waitForSelector("#build-out:not([hidden]) [data-verdict]", { timeout: 20 * 60_000 });
  const secs = (Date.now() - t0) / 1000;
  const verdict = await cp.getAttribute("#build-out [data-verdict]", "data-verdict");
  const text = await cp.textContent("#build-out");
  console.log(`      ${label}: ${verdict} in ${secs.toFixed(1)} s wall: ${text.slice(0, 260)}`);
  return { verdict, text, secs };
}
const b1 = await runBuild(FIX, "sample");
ok(b1.verdict === "builds", `(j) the cleaned sample paper builds in the browser: ${b1.text.slice(0, 160)}`);
const pdfHref = await cp.getAttribute("#build-pdf", "href");
const builtBytes = Buffer.from(await cp.evaluate(async (u) => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())), pdfHref));
writeFileSync(`${OUT}/built.pdf`, builtBytes);
const bi = execFileSync("pdfinfo", [`${OUT}/built.pdf`], { stdio: "pipe" }).toString();
const shownPages = Number((/came out at (\d+) page/.exec(b1.text) || [])[1]);
ok(builtBytes.slice(0, 5).toString() === "%PDF-" && Number((/Pages:\s+(\d+)/.exec(bi) || [])[1]) === shownPages && shownPages >= 1, `(j) the built PDF opens in poppler and its page count matches the page: ${shownPages} pages, ${builtBytes.length} bytes`);
const pdfText = execFileSync("pdftotext", [`${OUT}/built.pdf`, "-"], { stdio: "pipe" }).toString();
ok(pdfText.includes("A sample paper") && pdfText.includes("Introduction") && pdfText.includes("12% on the benchmark") && !pdfText.includes("PLANTED"), "(j) the built PDF contains the paper's title, section and text, and none of the removed comment text");
const foreign = creq.filter((u) => !u.startsWith(BASE) && !u.startsWith(ASSET_ORIGIN) && !u.startsWith("blob:") && !u.startsWith("data:"));
ok(foreign.length === 0, `(j) during the check the only outside requests go to the assets host (${creq.filter((u) => u.startsWith(ASSET_ORIGIN)).length} requests; ${foreign.length} elsewhere${foreign.length ? ": " + foreign[0] : ""})`);
const b2 = await runBuild(`${OUT}/break-clean.zip`, "break-clean");
ok(b2.verdict === "fails" && b2.text.includes("numbers.dat is missing") && b2.text.includes("Your original zip builds"), "(j) a project that builds as given but loses a data file in cleaning is reported as failing, with the original shown to build");
const b3 = await runBuild(`${OUT}/broken.zip`, "broken");
ok(b3.verdict === "fails" && b3.text.includes("Undefined control sequence") && b3.text.includes("fails too"), "(j) a project that never built is reported as failing, and not blamed on cleaning");
ok(cerr.length === 0, `(j) no page errors during the compile checks (${cerr.join(" | ")})`);
await cp.screenshot({ path: `${SHOTS}/desktop-build-fail.png`, fullPage: false });
await cc.close();

// (f) denylist: repo tree (check-identity.sh) and the served HTML/JS/CSS/sample
const denyFile = root + ".identity-denylist";
const deny = existsSync(denyFile) ? readFileSync(denyFile, "utf8").split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean) : [];
ok(deny.length > 0, `(f) denylist loaded (${deny.length} patterns)`);
let repoOk = true;
try { execFileSync("sh", [root + "scripts/check-identity.sh"], { stdio: "pipe" }); } catch { repoOk = false; }
ok(repoOk, "(f) check-identity.sh: 0 hits over the repo");
const served = ["", "app.js", "clean.js", "checks.js", "pdfscrub.js", "compile.js", "compile-worker.js", "image.js", "styles.css", "favicon.svg", "vendor/pdf-lib.min.js", "sample/sample-paper.zip"];
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
assetServer.kill();
console.log(`\n${pass}/${pass + fail} passed${LIVE ? " (live " + BASE + ")" : " (local)"}`);
process.exit(fail ? 1 : 0);
