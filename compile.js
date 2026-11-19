// "Does the cleaned zip still build?" Compiles the project in the browser with BusyTeX (TeX Live in WebAssembly, AGPL-3.0, from the
// maketitle-assets repository) in a Web Worker. Loaded only when the user asks for the check, because the first run downloads
// TeX Live (about 167 MB, then kept in the browser's storage). Nothing is uploaded: the files go from this page to the worker.
import { isJunk, normalizePaths, isText, stripComments } from './clean.js';

const dec = new TextDecoder();
export const ASSETS = 'https://voyager-from-space.github.io/maketitle-assets/';
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const assetsBase = () => (local && new URL(location.href).searchParams.get('assets')) || ASSETS;
const DRIVER = { pdf: 'pdftex_bibtex8', xe: 'xetex_bibtex8_dvipdfmx', lua: 'luahbtex_bibtex8' };
const ENGINE_NAME = { pdf: 'pdfLaTeX', xe: 'XeLaTeX', lua: 'LuaLaTeX' };

// ---- what to compile and how ----
export function plan(rawFiles) {
  const files = normalizePaths(rawFiles.filter((f) => !isJunk(f.path)));
  const text = new Map(files.filter((f) => isText(f.path)).map((f) => [f.path, dec.decode(f.bytes)]));
  const clean = new Map([...text].map(([p, t]) => [p, /\.(tex|ltx)$/i.test(p) ? stripComments(t).text : t]));
  const roots = [...clean].filter(([p, t]) => /\.(tex|ltx)$/i.test(p) && /^[^%\n]*\\documentclass/m.test(t) && /\\begin\s*\{document\}/.test(t)).map(([p]) => p);
  const rank = (p) => (/(^|\/)(main|ms|paper|root|arxiv)\.tex$/i.test(p) ? 0 : 1);
  const main = roots.sort((a, b) => rank(a) - rank(b) || a.split('/').length - b.split('/').length || a.localeCompare(b))[0] || null;
  const code = [...clean].filter(([p]) => /\.(tex|ltx|sty|cls)$/i.test(p)).map(([, t]) => t).join('\n');
  const mainText = clean.get(main) || '';
  let engine = 'pdf';
  const magic = /^\s*%\s*!TEX\s+(?:TS-)?program\s*=\s*(\w+)/im.exec(text.get(main) || '');
  if (magic && /^xe/i.test(magic[1])) engine = 'xe'; else if (magic && /^lua/i.test(magic[1])) engine = 'lua';
  else if (/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\b(?:fontspec|polyglossia|xeCJK|unicode-math)\b/.test(code)) engine = 'xe';
  else if (/\\directlua|\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:luacode|luatexja|lualatex-math)\b/.test(code)) engine = 'lua';
  const stem = main ? main.replace(/\.(tex|ltx)$/i, '') : '';
  const hasBib = files.some((f) => /\.bib$/i.test(f.path));
  let bib = { bibtex: false, biber: false, why: 'no bibliography run needed' };
  if (main && files.some((f) => f.path === stem + '.bbl')) bib = { bibtex: false, biber: false, why: 'uses the ready-made .bbl, as arXiv expects' };
  else if (/\\usepackage(?:\[[^\]]*\])?\{[^}]*biblatex[^}]*\}/.test(code) && hasBib) bib = /backend\s*=\s*bibtex/.test(code) ? { bibtex: true, biber: false, why: 'biblatex with the bibtex backend' } : { bibtex: true, biber: true, why: 'biblatex with biber' };
  else if (/\\bibliography\s*\{/.test(mainText) && hasBib) bib = { bibtex: true, biber: false, why: 'BibTeX' };
  const packages = new Set();
  for (const [p, t] of clean) if (/\.(tex|ltx|sty|cls)$/i.test(p)) for (const m of t.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)) for (const n of m[1].split(',')) if (n.trim()) packages.add(n.trim().toLowerCase());
  return { files, main, engine, engineName: ENGINE_NAME[engine], bib, packages };
}

// ---- reading the TeX log ----
export function parseLog(r) {
  const logs = (r && r.logs) || [];
  const tex = [...logs].reverse().find((l) => l.log && !/^(bibtex|makeindex|xdvipdfmx|biber)/.test(l.cmd));
  const text = (tex && tex.log) || '';
  const lines = text.split('\n');
  const errors = [], stack = [];
  const fileRe = /\(((?:\.\/)?[\w./@+-]+\.(?:tex|sty|cls|def|cfg|clo|fd|bbl|aux|ltx|cbx|bbx|lbx))(?=[\s)]|$)/g;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    let m; fileRe.lastIndex = 0;
    const opens = []; while ((m = fileRe.exec(ln))) opens.push(m.index);
    for (const ch of ln) if (ch === ')' && stack.length) stack.pop();
    if (opens.length) { fileRe.lastIndex = 0; while ((m = fileRe.exec(ln))) stack.push(m[1].replace(/^\.\//, '')); }
    if (ln.startsWith('!')) {
      let line = null;
      for (let k = i + 1; k < Math.min(lines.length, i + 8); k++) { const lm = /^l\.(\d+)/.exec(lines[k]); if (lm) { line = Number(lm[1]); break; } }
      if (/^!\s*==> Fatal error/.test(ln)) continue; // TeX's closing line, not a cause
      errors.push({ msg: ln.replace(/^!\s*/, ''), line, file: [...stack].reverse().find((f) => !/\.aux$/.test(f)) || null });
    }
  }
  const warn = lines.filter((l) => /Warning:/.test(l));
  const undefinedRefs = warn.filter((l) => /(Reference|Citation) .*undefined/.test(l) && !/There were undefined/.test(l)).length;
  const pages = (() => { const m = /Output written on .*\((\d+) pages?/.exec(text); return m ? Number(m[1]) : null; })();
  return { errors, warnings: warn.length, undefinedRefs, pages, tail: lines.slice(-25).join('\n') };
}

// ---- the worker ----
class Engine {
  constructor(onNet, onNote) {
    const base = assetsBase();
    this.base = base; this.onNet = onNet; this.onNote = onNote; this.net = 0;
    const url = new URL('compile-worker.js', import.meta.url);
    if (base !== ASSETS) url.searchParams.set('assets', base);
    this.worker = new Worker(url);
    this.pending = null;
    this.worker.onmessage = ({ data }) => {
      if (data.mt_net != null) { this.net = data.mt_net; this.onNet(this.net); return; }
      if (typeof data.print === 'string') { this.onNote(data.print); }
      if (this.pending) this.pending(data);
    };
    this.worker.onerror = (e) => { e.preventDefault(); if (this.pending) this.pending({ exception: 'The TeX worker stopped: ' + (e.message || 'unknown error') }); };
  }
  send(msg, accept, timeoutMs) {
    return new Promise((resolve, reject) => {
      let t;
      const arm = () => { clearTimeout(t); t = setTimeout(() => { this.pending = null; reject(new Error('Timed out waiting for TeX')); }, timeoutMs); };
      arm();
      this.pending = (data) => {
        if (typeof data.print === 'string' || data.mt_net != null) { arm(); return; } // progress keeps the clock alive
        if (data.exception) { clearTimeout(t); this.pending = null; reject(new Error(data.exception)); }
        else if (accept(data)) { clearTimeout(t); this.pending = null; resolve(data); }
      };
      this.worker.postMessage(msg);
    });
  }
  init() {
    const b = this.base;
    return this.send({ busytex_js: b + 'core/busytex.js', busytex_wasm: b + 'core/busytex.wasm', biber_js: b + 'core/biber.js', biber_wasm: b + 'core/biber.wasm', biber_data: b + 'core/biber.data',
      preload_data_packages_js: [b + 'core/texlive-recommended.js'], data_packages_js: [b + 'core/texlive-recommended.js', b + 'core/texlive-extra.js'], texmf_local: [], preload: true }, (d) => d.initialized, 10 * 60_000);
  }
  compile(p, useExtra) {
    const b = this.base;
    const files = p.files.map((f) => ({ path: f.path, contents: isText(f.path) ? dec.decode(f.bytes) : f.bytes }));
    return this.send({ files, main_tex_path: p.main, bibtex: p.bib.bibtex, biber: p.bib.biber, verbose: 'silent', driver: DRIVER[p.engine], makeindex: null, rerun: true, shell_escape: false,
      data_packages_js: useExtra ? [b + 'core/texlive-recommended.js', b + 'core/texlive-extra.js'] : [b + 'core/texlive-recommended.js'] }, (d) => 'logs' in d, 5 * 60_000);
  }
  async needsExtra(p) {
    try {
      const get = async (n) => new Set([...(await (await fetch(this.base + 'core/texlive-' + n + '.js.providespackage.txt')).text()).matchAll(/\\ProvidesPackage\{([^}]+)\}/g)].map((m) => m[1].toLowerCase().trim()));
      const [extra, rec, basic] = await Promise.all([get('extra'), get('recommended'), get('basic')]);
      for (const n of p.packages) if (extra.has(n) && !rec.has(n) && !basic.has(n)) return true;
    } catch { /* fall through: the retry below covers it */ }
    return false;
  }
  stop() { try { this.worker.terminate(); } catch { /* already gone */ } }
}

// Runs one compile. rawFiles: [{ path, bytes }]. Returns { ok, ... }; never throws for a TeX failure, only for a stopped worker.
export class Check {
  constructor({ onStatus = () => {}, onNet = () => {} } = {}) { this.onStatus = onStatus; this.onNet = onNet; this.engine = null; this.stopped = false; }
  async start() {
    const t0 = performance.now();
    this.engine = new Engine(this.onNet, (m) => { const d = /^(?:Preparing|Downloading data)\.\.\. \((\d+)\/(\d+)\)$/.exec(m); if (d) this.onStatus(`Getting TeX Live (${d[1]} of ${d[2]} files)`); });
    this.onStatus('Starting TeX in this tab');
    await this.engine.init();
    this.initMs = Math.round(performance.now() - t0);
  }
  async build(rawFiles, label = 'zip') {
    const p = plan(rawFiles);
    if (!p.main) return { ok: false, label, noMain: true, engine: p.engineName, errors: [], tail: '' };
    let useExtra = this.useExtra || (await this.engine.needsExtra(p));
    this.onStatus(`Building ${p.main} with ${p.engineName}`);
    const t0 = performance.now();
    let r, error = null, retried = false;
    const attempt = async () => { try { r = await this.engine.compile(p, useExtra); error = null; } catch (e) { error = String(e && e.message || e); r = null; } };
    await attempt();
    if (!useExtra && !this.stopped && !(r && r.exit_code === 0 && r.pdf)) { retried = true; useExtra = true; this.onStatus('Needs more of TeX Live, getting the larger set'); await attempt(); }
    this.useExtra = useExtra;
    const ok = !!(r && r.exit_code === 0 && r.pdf && r.pdf.length);
    const log = parseLog(r ? { logs: r.logs } : null);
    return { ok, label, engine: p.engineName, main: p.main, bib: p.bib.why, pdf: ok ? r.pdf : null, pdfBytes: ok ? r.pdf.length : 0, ms: Math.round(performance.now() - t0), usedExtra: useExtra, retried, error, exception: error,
      passes: ((r && r.logs) || []).map((l) => l.cmd).filter(Boolean), ...log, netBytes: this.engine.net, initMs: this.initMs };
  }
  stop() { this.stopped = true; if (this.engine) this.engine.stop(); }
}
