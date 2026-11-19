import { cleanProject, reportText, fmtBytes, mask } from './clean.js';
import { shrink } from './image.js';
import { analyzeAbstract, definedMacros, sizeReport, ABSTRACT_MAX, SIZE_LIMIT } from './checks.js';

const $ = (id) => document.getElementById(id);
const status = (m) => { $('status').textContent = m; };
const FIXED_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0)); // every entry gets the same timestamp: same input, same zip
let url = null, ctx = null, check = null, pdfUrl = null;
const n0 = (n) => n.toLocaleString('en-US');
const deepPdf = async (bytes) => (await import('./pdfscrub.js')).deepScrubPdf(bytes);

function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
const plural = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;

async function readZip(buf) {
  const zip = await window.JSZip.loadAsync(buf);
  const files = [];
  for (const e of Object.values(zip.files)) if (!e.dir) files.push({ path: e.name, bytes: await e.async('uint8array') });
  return files;
}

async function writeZip(files, extra) {
  const zip = new window.JSZip();
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) zip.file(f.path, f.bytes, { date: FIXED_DATE, createFolders: false });
  zip.file(extra.path, extra.text, { date: FIXED_DATE, createFolders: false });
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' });
}

function redacted(kind, text) {
  const shown = mask(kind, text);
  const wrap = el('span', 'mono');
  if (!shown.endsWith('…')) { wrap.textContent = shown; return wrap; }
  const keep = shown.slice(0, -1);
  wrap.append(keep);
  const bar = el('span', 'redact');
  bar.style.width = `${Math.min(14, Math.max(3, text.length - keep.length)) * 0.6}em`;
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', 'rest hidden');
  wrap.append(bar);
  return wrap;
}

function render(name, zipBytes, res, blob, outName, rawFiles) {
  const r = res.report;
  const gpsImgs = r.images.filter((i) => i.gps);
  const serious = r.leaks.filter((l) => l.kind === 'credential' || l.kind === 'cloud link');
  const seriousCount = serious.length + gpsImgs.length + r.pdfs.filter((p) => p.keys.length || p.xmp).length;
  $('res-title').textContent = `${fmtBytes(zipBytes)} in, ${fmtBytes(blob.size)} out`;
  $('res-sub').textContent = `${plural(seriousCount, 'possible leak')} to look at in ${name}. ${plural(r.comments + r.commentEnvs + r.iffalse, 'comment')} and ${plural(res.removed.length, 'file')} removed.`;
  const a = $('download');
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(blob);
  a.href = url; a.download = outName; a.textContent = `Download ${outName}`;
  a.dataset.bytes = String(blob.size);

  const stats = [
    ['Comments removed', r.comments + r.commentEnvs + r.iffalse, `${r.comments} %, ${r.commentEnvs} comment env, ${r.iffalse} \\iffalse`],
    ['Files removed', res.removed.length],
    ['Images with location', gpsImgs.length],
    ['Project size', fmtBytes(res.afterBytes), `was ${fmtBytes(res.beforeBytes)}`],
  ];
  $('stats').replaceChildren(...stats.map(([k, v, t]) => { const d = el('div'); const dd = el('dd', null, String(v)); d.dataset.stat = k; d.append(el('dt', null, k), dd); if (t) d.append(el('dd', 'small', t)); return d; }));

  const items = [];
  for (const i of gpsImgs) items.push({ serious: true, rule: 'gps', label: 'Photo with GPS position', where: i.path, val: i.gps.lat != null ? `${i.gps.lat.toFixed(4)}, ${i.gps.lon.toFixed(4)}` : 'position present', status: 'Removed from the copy in your zip' });
  for (const p of r.pdfs) if (p.keys.length || p.xmp) items.push({ serious: true, rule: 'pdf-meta', label: 'PDF figure metadata', where: p.path, val: [...p.keys, p.xmp ? 'XMP' : ''].filter(Boolean).join(', '), status: p.deep ? 'Removed from your zip (the file was rewritten without it)' : 'Blanked in your zip' });
  else if (p.compressedOnly) items.push({ serious: false, rule: 'pdf-meta', label: 'PDF figure metadata (compressed)', where: p.path, val: 'not scrubbed', status: p.deepError ? `Could not scrub it: ${p.deepError}. Re-export this figure to be sure` : 'Re-export this figure to be sure', kept: true });
  const order = { credential: 0, 'cloud link': 1, email: 2, leftover: 3 };
  for (const l of [...r.leaks].sort((x, y) => order[x.kind] - order[y.kind])) {
    items.push({ serious: l.kind === 'credential' || l.kind === 'cloud link', rule: l.rule, label: l.label, where: `${l.file}:${l.line}`, val: l, status: l.status === 'still in the file' ? 'Still in the file. Edit it yourself if it shouldn\u2019t be public.' : l.status[0].toUpperCase() + l.status.slice(1), kept: l.status === 'still in the file' });
  }
  items.sort((a, b) => Number(b.serious) - Number(a.serious));
  $('leaks').replaceChildren(...(items.length ? items.map((it) => {
    const li = el('li', `leak${it.serious ? ' serious' : ''}`);
    li.dataset.rule = it.rule;
    const head = el('div', 'leak-head');
    head.append(el('span', 'leak-label', it.label), el('span', 'where mono', it.where));
    const val = el('p', 'leak-val');
    val.append(typeof it.val === 'string' ? el('span', 'mono', it.val) : redacted(it.val.kind, it.val.match));
    li.append(head, val, el('p', `leak-status${it.kept ? ' kept' : ''}`, it.status));
    return li;
  }) : [el('li', 'leak', 'Nothing matched. That is not proof there is nothing there.')]));

  const imgRows = [...r.images.map((i) => ({ p: i.path, b: `${fmtBytes(i.before)} → ${fmtBytes(i.after)}`, why: [i.meta.length ? `stripped ${i.meta.join(', ')}` : 'no metadata found', i.resized ? `resized ${i.resized}` : ''].filter(Boolean).join('; ') })),
    ...r.pdfs.map((p) => ({ p: p.path, b: p.deep ? `${fmtBytes(p.before)} → ${fmtBytes(p.after)}` : '', why: p.compressedOnly ? `metadata is compressed; not scrubbed${p.deepError ? ` (${p.deepError})` : ''}` : `${p.deep ? 'removed, file rewritten' : 'blanked'} ${[...p.keys, p.xmp ? 'XMP' : ''].filter(Boolean).join(', ')}` }))];
  $('images').replaceChildren(...imgRows.map((x) => { const li = el('li', 'row'); li.append(el('span', 'p mono', x.p), el('span', 'b mono', x.b), el('span', 'why', x.why)); return li; }));
  $('removed').replaceChildren(...res.removed.map((f) => { const li = el('li', 'row'); li.dataset.path = f.path; li.append(el('span', 'p mono', f.path), el('span', 'b mono', fmtBytes(f.size)), el('span', 'why', f.why)); return li; }));
  const m = $('macro');
  m.hidden = !r.macroRefs.length;
  if (r.macroRefs.length) m.textContent = `${plural(r.macroRefs.length, 'reference')} built from a macro (for example \\${r.macroRefs[0].cmd}{${r.macroRefs[0].name}}). papershed can't follow those, so it kept every figure.`;
  ctx = { name, rawFiles, res, zipBytes, blob, macros: definedMacros(res.files) };
  renderAbstract(r.abstract);
  renderSize(rawFiles, zipBytes, res, blob);
  resetBuild();
  $('results').hidden = false;
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}


// ---------- arXiv checks ----------
const LEVEL = { problem: 'arXiv rejects this', advice: 'arXiv asks for this', note: 'papershed note' };
function issueItem(i) {
  const li = el('li', `leak${i.level === 'problem' ? ' serious' : ''}`);
  li.dataset.rule = `abstract-${i.id}`; li.dataset.level = i.level;
  const head = el('div', 'leak-head');
  head.append(el('span', 'leak-label', i.title), el('span', 'from', LEVEL[i.level]));
  li.append(head, el('p', 'leak-val', i.detail));
  if (i.examples && i.examples.length) {
    const ex = el('p', 'issue-ex');
    i.examples.forEach((e, k) => { if (k) ex.append(', '); ex.append(el('span', 'mono', e.ch)); if (e.fix) ex.append(' becomes ', el('span', 'mono', e.fix)); });
    li.append(ex);
  }
  return li;
}
function showAbstract(sumEl, listEl, a, where) {
  sumEl.replaceChildren();
  const count = el('b', null, n0(a.chars));
  sumEl.append(...(where ? [`Found in ${where}: `] : []), count, ` of ${n0(a.max)} characters.`);
  listEl.replaceChildren(...(a.issues.length ? a.issues.map(issueItem) : [el('li', 'leak', 'Nothing here breaks a rule on arXiv\u2019s page. That is not a promise that arXiv will accept it.')]));
}
function renderAbstract(a) {
  const sum = $('abs-sum'), list = $('abs-issues');
  if (!a || !a.found) {
    sum.textContent = 'No \\begin{abstract} or \\abstract{\u2026} in the files papershed kept. If your abstract comes from a macro, paste it below.';
    list.replaceChildren();
  } else {
    showAbstract(sum, list, a, a.path);
    if (a.count > 1) sum.append(` ${a.count} abstracts found; this is the first.`);
  }
  $('abs-paste').value = '';
  $('paste-sum').textContent = ''; $('paste-issues').replaceChildren();
}
$('abs-paste').addEventListener('input', (e) => {
  const v = e.target.value;
  if (!v.trim()) { $('paste-sum').textContent = ''; $('paste-issues').replaceChildren(); return; }
  showAbstract($('paste-sum'), $('paste-issues'), analyzeAbstract(v, { macros: ctx ? ctx.macros : new Set() }), null);
});

function renderSize(rawFiles, zipBytes, res, blob) {
  const strip = (fs) => fs.filter((f) => !/(^|\/)(__MACOSX|\.git)\//.test(f.path)).map((f) => ({ path: f.path, bytes: f.bytes }));
  const s = sizeReport({ files: strip(rawFiles), zipBytes }, { files: res.files, zipBytes: blob.size });
  const rows = [];
  const row = (p, b, why, cls) => { const li = el('li', 'row'); if (cls) li.dataset.row = cls; li.append(el('span', 'p', p), el('span', 'b mono', b), el('span', 'why', why)); rows.push(li); };
  row('The zip you upload', `${n0(s.after.zip)} bytes`, `${s.after.zipVerdict === 'over' ? 'Over' : 'Under'} arXiv\u2019s 50,000,000. It was ${n0(s.before.zip)} bytes.`, 'zip');
  row('Unpacked', `${n0(s.after.unpacked)} bytes`, `${s.after.unpackedVerdict === 'over' ? 'Over' : 'Under'} 50,000,000. It was ${n0(s.before.unpacked)} bytes.`, 'unpacked');
  for (const f of s.after.bigFiles) row(f.path, `${n0(f.bytes)} bytes`, 'arXiv suggests 2,000,000 bytes or less per figure file. A suggestion, not a limit.', 'bigfile');
  for (const f of s.after.bigImages) row(f.path, `${f.mp.toFixed(1)} megapixels`, 'arXiv warns about images above 34 megapixels.', 'bigimage');
  for (const f of s.before.bigImages) if (!s.after.bigImages.some((x) => x.path === f.path)) row(f.path, `${f.mp.toFixed(1)} megapixels`, 'Above arXiv\u2019s 34 megapixel warning in your original. papershed resized it.', 'bigimage-fixed');
  $('size-rows').replaceChildren(...rows);
  const sum = $('size-sum');
  sum.dataset.status = s.status;
  sum.textContent = s.status === 'over' ? 'Over arXiv\u2019s 50 MB limit. Shrink the largest files below, or ask arXiv for a size exception.'
    : s.status === 'watch' ? 'Under arXiv\u2019s 50 MB limit. Some files are worth a look.' : 'Under arXiv\u2019s 50 MB limit, as a zip and unpacked.';
}

// ---------- compile check ----------
const mbDec = (n) => (n / 1e6).toFixed(0) + ' MB';
function resetBuild() {
  if (check) { check.stop(); check = null; }
  if (pdfUrl) { URL.revokeObjectURL(pdfUrl); pdfUrl = null; }
  $('build-btn').disabled = false; $('build-btn').textContent = 'Check that it builds';
  $('build-stop').hidden = true; $('build-status').textContent = ''; $('build-out').hidden = true; $('build-out').replaceChildren();
}
function buildItem(r, extra) {
  const li = el('div', `leak ${r.ok ? 'verdict-ok' : 'serious'}`);
  li.dataset.verdict = r.ok ? 'builds' : r.noMain ? 'no-main' : 'fails';
  const head = el('div', 'leak-head');
  head.append(el('span', 'leak-label', r.ok ? 'It builds' : r.noMain ? 'No main file found' : 'It does not build'), el('span', 'where mono', r.main || ''));
  li.append(head);
  if (r.noMain) { li.append(el('p', 'leak-val', 'papershed looks for a .tex file with \\documentclass and \\begin{document}. There was none, so nothing was compiled.')); return li; }
  const secs = (r.ms / 1000).toFixed(1);
  li.append(el('p', 'leak-val', r.ok
    ? `${r.main} built with ${r.engine} in ${secs} s${r.pages ? ` and came out at ${plural(r.pages, 'page')}` : ''}. TeX gave ${plural(r.warnings, 'warning')}${r.undefinedRefs ? `, ${plural(r.undefinedRefs, 'of them an undefined reference or citation', 'of them undefined references or citations')}` : ''}. Bibliography: ${r.bib}.`
    : `${r.engine} stopped with ${plural(r.errors.length, 'error')} after ${secs} s.`));
  if (!r.ok && r.errors.length) { const ol = el('p', 'issue-ex'); r.errors.slice(0, 3).forEach((e, k) => { if (k) ol.append('; '); ol.append(el('span', 'mono', `${e.file || '?'}${e.line ? ':' + e.line : ''}`), ` ${e.msg}`); }); li.append(ol); }
  if (!r.ok && r.exception) li.append(el('p', 'issue-ex', r.exception.slice(0, 300)));
  if (extra) li.append(el('p', 'leak-status', extra));
  return li;
}
$('build-btn').addEventListener('click', async () => {
  if (!ctx) return;
  const btn = $('build-btn'), out = $('build-out'), st = $('build-status');
  btn.disabled = true; btn.textContent = 'Checking\u2026'; $('build-stop').hidden = false; out.hidden = true; out.replaceChildren();
  let note = 'Starting TeX in this tab', net = 0;
  const say = () => { st.textContent = net > 1e6 ? `${note}. Downloaded ${mbDec(net)} so far.` : `${note}.`; };
  const mine = new (await import('./compile.js')).Check({ onStatus: (m) => { note = m; say(); }, onNet: (n) => { net = n; say(); } });
  check = mine;
  try {
    say();
    await mine.start();
    const cleaned = await mine.build(ctx.res.files, 'cleaned');
    if (mine.stopped) return;
    let extra = null, orig = null;
    if (!cleaned.ok && !cleaned.noMain) {
      st.textContent = 'It failed. Building your original zip to see whether cleaning caused it\u2026';
      orig = await mine.build(ctx.rawFiles, 'original');
      extra = orig.ok ? 'Your original zip builds, so something cleaning removed or changed is needed. Compare the error with the files listed under Removed files.' : 'Your original zip fails too, so this was not caused by cleaning. It can also be a package this TeX Live set lacks.';
    }
    if (cleaned.ok) { pdfUrl = URL.createObjectURL(new Blob([cleaned.pdf], { type: 'application/pdf' })); }
    const item = buildItem(cleaned, extra);
    if (cleaned.ok) {
      const p = el('p', 'leak-status'); const a = el('a', null, 'Open the built PDF'); a.href = pdfUrl; a.target = '_blank'; a.rel = 'noopener'; a.id = 'build-pdf';
      p.append(a, ` (${fmtBytes(cleaned.pdfBytes)}). Built here, so arXiv\u2019s own TeX Live can still differ.`); item.append(p);
    }
    if (mine.engine && mine.engine.net) item.append(el('p', 'note', `TeX Live data downloaded this time: ${mbDec(mine.engine.net)}.${cleaned.retried ? ' The larger package set was needed.' : ''}`));
    if (!cleaned.ok && cleaned.tail) { const d = el('details'); d.append(el('summary', null, 'Last lines of the TeX log'), el('pre', null, cleaned.tail)); item.append(d); }
    out.replaceChildren(item); out.hidden = false;
    st.textContent = cleaned.ok ? 'Done.' : 'Done. See the errors above.';
    document.body.dataset.build = cleaned.ok ? 'ok' : 'fail';
  } catch (err) {
    if (!mine.stopped) st.textContent = `The check could not run: ${err.message}`;
  } finally {
    if (!mine.stopped) { mine.stop(); if (check === mine) check = null; }
    btn.disabled = false; btn.textContent = 'Check again'; $('build-stop').hidden = true;
  }
});
$('build-stop').addEventListener('click', () => { if (check) { check.stop(); check = null; } $('build-status').textContent = 'Stopped.'; $('build-btn').disabled = false; $('build-btn').textContent = 'Check that it builds'; $('build-stop').hidden = true; });

async function handle(name, buf) {
  const t0 = performance.now();
  status(`Reading ${name} (${fmtBytes(buf.byteLength)})…`);
  try {
    const files = await readZip(buf);
    const res = await cleanProject(files, { shrink, deepPdf, onProgress: status });
    const text = reportText(name, res, buf.byteLength);
    const blob = await writeZip(res.files, { path: 'CLEAN-REPORT.txt', text });
    const outName = name.replace(/\.zip$/i, '') + '-clean.zip';
    render(name, buf.byteLength, res, blob, outName, files);
    status(`Cleaned ${plural(files.length, 'file')} in ${Math.round(performance.now() - t0)} ms, in this tab.`);
  } catch (err) {
    $('results').hidden = true;
    status(`Could not read that file as a zip (${err.message}).`);
  }
}

$('file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) f.arrayBuffer().then((b) => handle(f.name, b)); });
const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) f.arrayBuffer().then((b) => handle(f.name, b)); });
$('download').addEventListener('click', (e) => { const a = e.currentTarget; status(`Downloading ${a.download} (${fmtBytes(Number(a.dataset.bytes))}).`); });
$('sample').addEventListener('click', async () => {
  status('Loading the sample paper…');
  const r = await fetch('sample/sample-paper.zip');
  handle('sample-paper.zip', await r.arrayBuffer());
});
