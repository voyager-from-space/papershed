// node --test test/pdf.test.mjs : PDF metadata scrubbing, both the in-place pass and the library pass, without a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import zlib from "node:zlib";
import { cleanProject } from "../site/clean.js";
import { deepScrubPdf } from "../site/pdfscrub.js";

const lib = createRequire(import.meta.url)("../site/vendor/pdf-lib.min.js");
const MARK = "PLANTED-NODE-TEST";
import { writeFileSync, readFileSync } from "node:fs";
const make = () => { const f = `/tmp/_pdftest-${process.pid}.pdf`; execFileSync("python3", [new URL("../scripts/make-pdf-fixture.py", import.meta.url).pathname, f, MARK]); return new Uint8Array(readFileSync(f)); };
const count = (buf) => {
  const s = Buffer.from(buf).toString("latin1"); let n = s.split(MARK).length - 1;
  for (const m of s.matchAll(/stream\r?\n/g)) { const a = m.index + m[0].length, b = s.indexOf("endstream", a); try { n += zlib.inflateSync(Buffer.from(s.slice(a, b), "latin1")).toString("latin1").split(MARK).length - 1; } catch { /* not flate */ } }
  return n;
};
const asLib = (bytes) => deepScrubPdf(bytes, lib);

test("planted strings sit in compressed streams: raw grep misses them, inflating finds them", () => {
  const raw = make();
  assert.equal(Buffer.from(raw).toString("latin1").includes(MARK), false);
  assert.ok(count(raw) >= 6);
});
test("library pass removes Info and XMP and leaves a valid one-page PDF", async () => {
  const r = await asLib(make());
  assert.equal(r.error, undefined);
  assert.equal(count(r.bytes), 0);
  assert.deepEqual(r.found.keys.sort(), ["Author", "CreationDate", "Creator", "Keywords", "Producer", "Subject", "Title"]);
  assert.ok(r.found.xmp);
  const f = `/tmp/_pdftest-out-${process.pid}.pdf`; writeFileSync(f, r.bytes);
  const info = execFileSync("pdfinfo", [f]).toString();
  assert.match(info, /Pages:\s+1/); assert.doesNotMatch(info, /Title:|Author:|Producer:|Creator:/); assert.match(info, /Metadata Stream:\s+no/);
});
test("cleanProject uses the library pass only when asked, and reports honestly when it cannot", async () => {
  const pdf = make();
  const files = () => [{ path: "main.tex", bytes: new TextEncoder().encode("\\documentclass{article}\\begin{document}\\includegraphics{f}\\end{document}") }, { path: "f.pdf", bytes: pdf.slice() }];
  const without = await cleanProject(files());
  assert.equal(without.report.pdfs[0].compressedOnly, true);
  assert.equal(count(without.files.find((f) => f.path === "f.pdf").bytes) > 0, true);
  const withLib = await cleanProject(files(), { deepPdf: asLib });
  assert.equal(withLib.report.pdfs[0].deep, true); assert.equal(withLib.report.pdfs[0].compressedOnly, false);
  assert.equal(count(withLib.files.find((f) => f.path === "f.pdf").bytes), 0);
  const broken = new TextEncoder().encode("%PDF-1.5\n/ObjStm garbage that no reader can parse");
  const bad = await cleanProject([files()[0], { path: "f.pdf", bytes: broken }], { deepPdf: asLib });
  assert.equal(bad.report.pdfs[0].compressedOnly, true); assert.ok(bad.report.pdfs[0].deepError);
  assert.deepEqual([...bad.files.find((f) => f.path === "f.pdf").bytes], [...broken]);
});
