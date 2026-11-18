import { cleanProject, reportText, fmtBytes, mask } from './clean.js';
import { shrink } from './image.js';

const $ = (id) => document.getElementById(id);
const status = (m) => { $('status').textContent = m; };
const FIXED_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0)); // every entry gets the same timestamp: same input, same zip
let url = null;

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

function render(name, zipBytes, res, blob, outName) {
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
  for (const p of r.pdfs) if (p.keys.length || p.xmp) items.push({ serious: true, rule: 'pdf-meta', label: 'PDF figure metadata', where: p.path, val: [...p.keys, p.xmp ? 'XMP' : ''].filter(Boolean).join(', '), status: 'Blanked in your zip' });
  else if (p.compressedOnly) items.push({ serious: false, rule: 'pdf-meta', label: 'PDF figure metadata (compressed)', where: p.path, val: 'not scrubbed', status: 'Re-export this figure to be sure', kept: true });
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
    ...r.pdfs.map((p) => ({ p: p.path, b: '', why: p.compressedOnly ? 'metadata is compressed; not scrubbed' : `blanked ${[...p.keys, p.xmp ? 'XMP' : ''].filter(Boolean).join(', ')}` }))];
  $('images').replaceChildren(...imgRows.map((x) => { const li = el('li', 'row'); li.append(el('span', 'p mono', x.p), el('span', 'b mono', x.b), el('span', 'why', x.why)); return li; }));
  $('removed').replaceChildren(...res.removed.map((f) => { const li = el('li', 'row'); li.dataset.path = f.path; li.append(el('span', 'p mono', f.path), el('span', 'b mono', fmtBytes(f.size)), el('span', 'why', f.why)); return li; }));
  const m = $('macro');
  m.hidden = !r.macroRefs.length;
  if (r.macroRefs.length) m.textContent = `${plural(r.macroRefs.length, 'reference')} built from a macro (for example \\${r.macroRefs[0].cmd}{${r.macroRefs[0].name}}). papershed can't follow those, so it kept every figure.`;
  $('results').hidden = false;
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handle(name, buf) {
  const t0 = performance.now();
  status(`Reading ${name} (${fmtBytes(buf.byteLength)})…`);
  try {
    const files = await readZip(buf);
    const res = await cleanProject(files, { shrink, onProgress: status });
    const text = reportText(name, res, buf.byteLength);
    const blob = await writeZip(res.files, { path: 'CLEAN-REPORT.txt', text });
    const outName = name.replace(/\.zip$/i, '') + '-clean.zip';
    render(name, buf.byteLength, res, blob, outName);
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
