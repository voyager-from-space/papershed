// node --test test/checks.test.mjs : unit checks for the arXiv rule code. Limits are the ones on arXiv's pages (see site/checks.js).
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAbstract, findAbstracts, abstractReport, asciiFor, pastedForm, sizeReport, imageDims, ABSTRACT_MAX, SIZE_LIMIT } from "../site/checks.js";

const enc = (s) => new TextEncoder().encode(s);
const ids = (r) => r.issues.map((i) => i.id);

test("1920 characters passes, 1921 does not", () => {
  assert.equal(ABSTRACT_MAX, 1920);
  assert.ok(!ids(analyzeAbstract("x".repeat(1920))).includes("length"));
  const r = analyzeAbstract("x".repeat(1921));
  assert.ok(ids(r).includes("length") && r.chars === 1921 && r.problems === 1);
});
test("line breaks not followed by a space count as one space; indented lines keep their break", () => {
  assert.equal(pastedForm("a\nb"), "a b");
  assert.equal(pastedForm("a\n b"), "a\n b");
  assert.equal(analyzeAbstract("ab\ncd").chars, 5);
});
test("non-ASCII is a problem and suggests arXiv's own TeX forms", () => {
  const r = analyzeAbstract("caf\u00e9 \u201cq\u201d \u2014 \ufb01 \u0150 \u01ea \u00e5 \u00df \u0142");
  assert.ok(ids(r).includes("ascii") && r.problems === 1);
  const fix = Object.fromEntries(r.issues[0].examples.map((e) => [e.ch.split(" ")[0], e.fix]));
  assert.deepEqual([fix["\u00e9"], fix["\u201c"], fix["\u2014"], fix["\ufb01"], fix["\u0150"], fix["\u01ea"], fix["\u00e5"], fix["\u00df"], fix["\u0142"]],
    ["\\'e", "``", "---", "fi", "\\H{O}", "\\k{O}", "{\\aa}", "{\\ss}", "{\\l}"]);
  assert.equal(asciiFor("\u4e2d"), null);
});
test("ASCII-only abstract has no problems", () => {
  const r = analyzeAbstract("We show that $x^2$ grows. Accents are fine: caf\\'e, \\\"u, {\\ss}.");
  assert.equal(r.issues.length, 0);
});
test("rules arXiv names: Abstract word, tilde, backslash comma and space, font commands, leading space, blank lines", () => {
  const r = analyzeAbstract("Abstract. We~show a\\,b c\\ d \\emph{this} and {\\bf that}.\n  indented\n\nnext");
  for (const id of ["word", "texisms", "fonts", "indent", "blank"]) assert.ok(ids(r).includes(id), id);
  assert.ok(r.issues.filter((i) => i.level !== "problem").every((i) => ["advice", "note"].includes(i.level)));
  assert.ok(!ids(analyzeAbstract("A \\~n accent and \\textasciitilde")).includes("texisms"));
});
test("citations and own macros are a papershed note, not an arXiv rule", () => {
  const r = analyzeAbstract("See \\cite{a} and \\foo.", { macros: new Set(["foo"]) });
  const m = r.issues.find((i) => i.id === "macros");
  assert.equal(m.level, "note"); assert.equal(m.from, "papershed");
});
test("finds env, starred env and \\abstract{} with nested braces", () => {
  const f = findAbstracts([{ path: "a.tex", text: "\\begin{abstract}one\\end{abstract} \\abstract{two {nested} \\} still}" }, { path: "b.tex", text: "\\begin{abstract*}three\\end{abstract*}" }]);
  assert.deepEqual(f.map((x) => x.text), ["one", "two {nested} \\} still", "three"]);
});
test("abstractReport picks the main file first and reports none when absent", () => {
  const files = [{ path: "sec.tex", bytes: enc("\\begin{abstract}other\\end{abstract}") }, { path: "main.tex", bytes: enc("\\begin{abstract}mine\\end{abstract}") }];
  const r = abstractReport(files, "main.tex");
  assert.equal(r.path, "main.tex"); assert.equal(r.count, 2);
  assert.equal(abstractReport([{ path: "main.tex", bytes: enc("hi") }], "main.tex").found, false);
});
test("size: 50,000,000 bytes is the line; zip and unpacked are judged separately", () => {
  const f = (n) => ({ path: "a.bin", bytes: { length: n } });
  const rep = (zip, n) => sizeReport({ files: [f(n)], zipBytes: zip }, { files: [f(n)], zipBytes: zip });
  assert.equal(SIZE_LIMIT, 50_000_000);
  assert.equal(rep(49_999_999, 49_999_999).status, "ok");
  assert.equal(rep(50_000_000, 50_000_000).status, "ok");
  const over = rep(1000, 50_000_001);
  assert.equal(over.status, "over"); assert.equal(over.after.zipVerdict, "under"); assert.equal(over.after.unpackedVerdict, "over");
});
test("size: figure files above 2,000,000 bytes and images above 34 megapixels are listed", () => {
  const png = new Uint8Array(40); png.set([0x89, 0x50, 0x4e, 0x47], 0); png.set([0, 0, 0x17, 0x70], 16); png.set([0, 0, 0x17, 0x70], 20); // 6000 x 6000
  assert.deepEqual(imageDims("x.png", png), { w: 6000, h: 6000 });
  const r = sizeReport({ files: [], zipBytes: 0 }, { files: [{ path: "x.png", bytes: png }, { path: "big.pdf", bytes: { length: 2_000_001 } }, { path: "ok.pdf", bytes: { length: 2_000_000 } }, { path: "data.csv", bytes: { length: 9_000_000 } }], zipBytes: 1 });
  assert.deepEqual(r.after.bigFiles.map((x) => x.path), ["big.pdf"]);
  assert.equal(r.after.bigImages.length, 1); assert.equal(r.status, "watch");
});
