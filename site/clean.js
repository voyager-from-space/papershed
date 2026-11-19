// papershed cleaner. Pure functions over { path, bytes } files; runs in the browser and in Node.
// Our own implementation of the usual arXiv clean-up rules (arxiv-latex-cleaner was the inspiration; no code copied).

import { abstractReport } from './checks.js';

const dec = new TextDecoder('utf-8'), enc = new TextEncoder();
const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; };

export function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

// ---------- junk ----------
const JUNK_DIR = /(^|\/)(__MACOSX|\.git|\.svn|\.hg|\.idea|\.vscode|_minted[^/]*|\.Trash[^/]*)\//;
const JUNK_FILE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$|\.(aux|log|out|toc|lof|lot|blg|bcf|run\.xml|fls|fdb_latexmk|synctex|synctex\.gz|synctex\(busy\)|nav|snm|vrb|xdv|dvi|idx|ilg|ind|brf|glg|glo|gls|ist|acn|acr|alg|loa|thm|ptc|maf|mtc\d*|lol|xwm|bak|swp|tmp)$|~$/i;
export const isJunk = (p) => JUNK_DIR.test(p) || JUNK_FILE.test(p);

// strip one shared top-level folder (same rule as texdiet)
export function normalizePaths(files) {
  const firsts = new Set(files.map((f) => (f.path.includes('/') ? f.path.split('/')[0] : '')));
  if (firsts.size === 1 && !firsts.has('')) {
    const cut = [...firsts][0].length + 1;
    return files.map((f) => ({ ...f, path: f.path.slice(cut) }));
  }
  return files;
}

// ---------- comments ----------
const VERB_ENVS = ['verbatim', 'verbatim*', 'Verbatim', 'Verbatim*', 'lstlisting', 'minted', 'alltt', 'BVerbatim', 'LVerbatim', 'spverbatim', 'filecontents', 'filecontents*'];
const esc = (s) => s.replace(/[*]/g, '\\*');
const VERB_BEGIN = new RegExp(String.raw`\\begin\s*\{(${VERB_ENVS.map(esc).join('|')})\}`);

// index of the first unescaped %, or -1. Skips \verb|...| and escaped chars.
function commentStart(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') {
      const v = /^\\verb\*?([^a-zA-Z\s*])/.exec(line.slice(i));
      if (v) { const end = line.indexOf(v[1], i + v[0].length); if (end < 0) return -1; i = end; continue; }
      i++; continue;
    }
    if (c === '%') return i;
  }
  return -1;
}

const IF_TOKEN = /\\(if[a-zA-Z@]*|fi)(?![a-zA-Z@])/g;
const BLOCK_START = /\\begin\s*\{comment\}|\\iffalse(?![a-zA-Z@])/;

// returns { text, stats: { comments, commentEnvs, iffalse, lines }, removed: [string] }
export function stripComments(text) {
  const lines = text.split(/\r?\n/);
  const out = [], removed = [];
  const stats = { comments: 0, commentEnvs: 0, iffalse: 0, linesDropped: 0 };
  let state = 'normal', verbEnv = null, depth = 0;
  for (const line of lines) {
    if (state === 'verb') {
      out.push(line);
      if (line.includes(`\\end{${verbEnv}}`)) state = 'normal';
      continue;
    }
    // 1) % comments
    let code = line;
    const at = commentStart(line);
    if (at >= 0 && state === 'normal') {
      stats.comments++;
      removed.push(line.slice(at));
      const before = line.slice(0, at);
      code = before.trim() ? before + '%' : ''; // keep the bare % (and the space before it) so line joins don't change
    } else if (at >= 0) {
      code = line.slice(0, at);
    }
    // 2) comment env and \iffalse blocks (may start or end mid-line)
    let kept = '', rest = code;
    while (rest.length) {
      if (state === 'comment') {
        const m = /\\end\s*\{comment\}/.exec(rest);
        if (!m) { removed.push(rest); rest = ''; break; }
        removed.push(rest.slice(0, m.index));
        rest = rest.slice(m.index + m[0].length); state = 'normal';
      } else if (state === 'iffalse') {
        IF_TOKEN.lastIndex = 0;
        let m, cut = -1;
        while ((m = IF_TOKEN.exec(rest))) { depth += m[1] === 'fi' ? -1 : 1; if (depth === 0) { cut = m.index + m[0].length; break; } }
        if (cut < 0) { removed.push(rest); rest = ''; break; }
        removed.push(rest.slice(0, cut));
        rest = rest.slice(cut); state = 'normal';
      } else {
        const b = BLOCK_START.exec(rest), v = VERB_BEGIN.exec(rest);
        if (v && (!b || v.index < b.index)) {
          kept += rest;
          if (!rest.slice(v.index).includes(`\\end{${v[1]}}`)) { state = 'verb'; verbEnv = v[1]; }
          rest = '';
          break;
        }
        if (!b) { kept += rest; rest = ''; break; }
        kept += rest.slice(0, b.index);
        if (b[0].startsWith('\\begin')) { state = 'comment'; stats.commentEnvs++; rest = rest.slice(b.index + b[0].length); }
        else { state = 'iffalse'; depth = 1; stats.iffalse++; rest = rest.slice(b.index + b[0].length); }
      }
    }
    if (state === 'verb' && line === code) { out.push(kept); continue; }
    if (kept.trim() === '' && line.trim() !== '') { stats.linesDropped++; continue; }
    if (kept.trim() === '%' && kept.trim() !== line.trim()) { kept = kept.replace(/^\s*%$/, ''); if (!kept) { stats.linesDropped++; continue; } }
    out.push(kept.replace(/\s+$/, '') === '' ? '' : kept);
  }
  return { text: out.join('\n'), stats, removed: removed.filter((r) => r.trim()) };
}

// ---------- reference graph ----------
const GRAPHIC_EXTS = ['', '.pdf', '.png', '.jpg', '.jpeg', '.eps', '.PDF', '.PNG', '.JPG', '.JPEG'];
const TEXLIKE = /\.(tex|ltx|sty|cls)$/i;
const RASTER = /\.(png|jpe?g)$/i;
const ALWAYS_KEEP = /(^|\/)00README(\.XXX|\.json)?$|\.bbl$/i;

const join = (dir, p) => (dir + p).replace(/^\.\//, '').replace(/\/\.\//g, '/').replace(/^\//, '');
const args = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function findMain(texts) {
  const roots = [...texts].filter(([p, t]) => /\.(tex|ltx)$/i.test(p) && /^[^%]*\\documentclass/m.test(t)).map(([p]) => p);
  return roots.find((p) => /(^|\/)(main|ms|paper)\.tex$/i.test(p)) || roots.sort((a, b) => a.split('/').length - b.split('/').length)[0] || null;
}

// texts: Map(path -> comment-stripped text). Returns { keep: Set, macroRefs: [] }
export function referenced(paths, texts, main) {
  const has = new Set(paths);
  const keep = new Set(), macroRefs = [];
  const base = main.includes('/') ? main.slice(0, main.lastIndexOf('/') + 1) : '';
  const gp = [];
  for (const t of texts.values()) for (const m of t.matchAll(/\\graphicspath\s*\{((?:\{[^{}]*\}\s*)+)\}/g)) for (const d of m[1].matchAll(/\{([^{}]*)\}/g)) gp.push(d[1]);
  const gdirs = ['', ...gp].map((d) => base + d);
  const tryAdd = (cands) => { for (const c of cands) if (has.has(c)) { keep.add(c); return c; } return null; };
  const queue = [main];
  keep.add(main);
  const seen = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const t = texts.get(file);
    if (t == null) continue;
    const push = (p) => { if (p && TEXLIKE.test(p)) queue.push(p); };
    const ref = (name, cmd) => { if (/[#\\]/.test(name)) { macroRefs.push({ file, cmd, name }); return true; } return false; };
    for (const m of t.matchAll(/\\(input|include|subfile|loadglsentries)\s*(?:\{([^}]+)\}|\s+([^\s{}\\]+))/g)) {
      const n = (m[2] || m[3]).trim(); if (ref(n, m[1])) continue;
      push(tryAdd([join(base, n), join(base, n + '.tex'), n, n + '.tex']));
    }
    for (const m of t.matchAll(/\\(?:sub)?(?:import|inputfrom|includefrom)\*?\s*\{([^}]*)\}\s*\{([^}]+)\}/g)) {
      const n = m[1] + m[2]; if (ref(n, 'import')) continue;
      push(tryAdd([join(base, n), join(base, n + '.tex')]));
    }
    for (const m of t.matchAll(/\\(includegraphics\*?|includepdf|includesvg|lstinputlisting|verbatiminput|inputminted\s*\{[^}]*\})\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
      const n = m[2].trim(); if (ref(n, m[1])) continue;
      const exts = m[1].startsWith('includesvg') ? ['', '.svg'] : GRAPHIC_EXTS;
      const cands = [];
      for (const d of m[1].startsWith('include') ? gdirs : [base, '']) for (const e of exts) cands.push(join(d, n + e));
      tryAdd(cands);
    }
    for (const m of t.matchAll(/\\(bibliography|addbibresource|addglobalbib|bibliographystyle)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
      const ext = m[1] === 'bibliographystyle' ? '.bst' : '.bib';
      for (const n of args(m[2])) tryAdd([join(base, n), join(base, n + ext), n, n + ext]);
    }
    for (const m of t.matchAll(/\\(usepackage|RequirePackage|documentclass|LoadClass|usetheme|usecolortheme|usefonttheme|useinnertheme|useoutertheme)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
      const kind = m[1];
      for (const n of args(m[2])) {
        const cands = /class/i.test(kind) ? [n + '.cls'] : kind.startsWith('use') && kind !== 'usepackage' ? [`beamer${kind.slice(3)}${n}.sty`] : [n + '.sty'];
        push(tryAdd(cands.flatMap((c) => [join(base, c), c])));
      }
    }
  }
  return { keep, macroRefs };
}

// ---------- image metadata ----------
function readTiffGps(t) {
  // t: Uint8Array starting at TIFF header. Returns { gps: bool, lat, lon, tags } or null
  if (t.length < 8) return null;
  const le = t[0] === 0x49;
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const u16 = (o) => v.getUint16(o, le), u32 = (o) => v.getUint32(o, le);
  const ifd = (off) => {
    const out = new Map();
    if (off + 2 > t.length) return out;
    const n = u16(off);
    for (let i = 0; i < n; i++) { const e = off + 2 + i * 12; if (e + 12 > t.length) break; out.set(u16(e), { type: u16(e + 2), count: u32(e + 4), at: e + 8 }); }
    return out;
  };
  try {
    const ifd0 = ifd(u32(4));
    const ptr = ifd0.get(0x8825);
    const res = { gps: false, tags: ifd0.size };
    if (!ptr) return res;
    const g = ifd(u32(ptr.at));
    res.gps = g.size > 0;
    const rat3 = (tag) => { const e = g.get(tag); if (!e || e.type !== 5 || e.count < 3) return null; const o = u32(e.at); const r = (k) => u32(o + k * 8) / (u32(o + k * 8 + 4) || 1); return r(0) + r(1) / 60 + r(2) / 3600; };
    const ref = (tag) => { const e = g.get(tag); return e ? String.fromCharCode(t[e.at]) : ''; };
    const lat = rat3(2), lon = rat3(4);
    if (lat != null && lon != null) { res.lat = (ref(1) === 'S' ? -1 : 1) * lat; res.lon = (ref(3) === 'W' ? -1 : 1) * lon; }
    return res;
  } catch { return { gps: false, tags: 0 }; }
}

// drop APP1 (EXIF/XMP), APP12, APP13 (IPTC) and COM segments; keep APP0/APP2 (ICC) and image data
export function scrubJpeg(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const parts = [b.subarray(0, 2)];
  const found = { exif: false, xmp: false, iptc: false, comment: false, gps: null };
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xda) { parts.push(b.subarray(i)); break; }       // start of scan: rest is image data
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { parts.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    const seg = b.subarray(i, i + 2 + len);
    const id = latin1(seg.subarray(4, 4 + 30));
    let drop = false;
    if (m === 0xe1) {
      drop = true;
      if (id.startsWith('Exif\0')) { found.exif = true; const g = readTiffGps(seg.subarray(10)); if (g) found.gps = g; }
      else found.xmp = true;
    } else if (m === 0xec || m === 0xed) { drop = true; found.iptc = true; }
    else if (m === 0xfe) { drop = true; found.comment = true; }
    if (!drop) parts.push(seg);
    i += 2 + len;
  }
  const n = parts.reduce((k, p) => k + p.length, 0);
  const out = new Uint8Array(n); let k = 0;
  for (const p of parts) { out.set(p, k); k += p.length; }
  return { bytes: out, found };
}

const PNG_TEXT = new Set(['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);
export function scrubPng(b) {
  if (!(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const parts = [b.subarray(0, 8)];
  const found = { chunks: [], keys: [], gps: null };
  let i = 8;
  while (i + 12 <= b.length) {
    const len = v.getUint32(i), type = latin1(b.subarray(i + 4, i + 8));
    const chunk = b.subarray(i, i + 12 + len);
    if (PNG_TEXT.has(type)) {
      found.chunks.push(type);
      const data = chunk.subarray(8, 8 + len);
      if (type === 'eXIf') { const g = readTiffGps(data); if (g) found.gps = g; }
      else if (type !== 'tIME') found.keys.push(latin1(data.subarray(0, Math.max(0, data.indexOf(0)))));
    } else parts.push(chunk);
    i += 12 + len;
    if (type === 'IEND') break;
  }
  const n = parts.reduce((k, p) => k + p.length, 0);
  const out = new Uint8Array(n); let k = 0;
  for (const p of parts) { out.set(p, k); k += p.length; }
  return { bytes: out, found };
}

// Blank PDF Info strings and XMP packets in place (same length, so xref offsets stay valid).
// Only touches what is stored uncompressed; reports what it could not reach.
const INFO_KEYS = ['Author', 'Creator', 'Producer', 'Title', 'Subject', 'Keywords'];
export function scrubPdf(b) {
  const s = latin1(b);
  if (!s.startsWith('%PDF-')) return null;
  const out = b.slice();
  const found = { keys: [], xmp: false, compressedOnly: false };
  const re = new RegExp(String.raw`\/(${INFO_KEYS.join('|')})\s*([(<])`, 'g');
  let m;
  while ((m = re.exec(s))) {
    let i = m.index + m[0].length, end = -1;
    if (m[2] === '(') {
      let depth = 1;
      for (; i < s.length; i++) { const c = s[i]; if (c === '\\') { i++; continue; } if (c === '(') depth++; else if (c === ')' && --depth === 0) { end = i; break; } }
    } else { end = s.indexOf('>', i); if (s[i] === '<') continue; }
    if (end < 0) continue;
    const start = m.index + m[0].length;
    if (end > start) { out.fill(0x20, start, end); found.keys.push(m[1]); }
    re.lastIndex = end;
  }
  const x0 = s.indexOf('<x:xmpmeta'), x1 = s.indexOf('</x:xmpmeta>');
  if (x0 >= 0 && x1 > x0) { out.fill(0x20, x0, x1 + 12); found.xmp = true; }
  // metadata kept in compressed object streams or compressed XMP cannot be blanked in place (offsets would move)
  if (/\/ObjStm\b/.test(s) || /\/Type\s*\/XRef\b/.test(s) || (/\/Metadata\b/.test(s) && !found.xmp)) found.deep = true;
  if (found.deep && !found.keys.length) found.compressedOnly = true;
  return { bytes: out, found: { ...found, keys: [...new Set(found.keys)] } };
}

// ---------- leak scan (heuristic) ----------
export const LEAK_RULES = [
  { id: 'private-key', kind: 'credential', label: 'Private key block', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g },
  { id: 'aws-key', kind: 'credential', label: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', kind: 'credential', label: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g },
  { id: 'api-key', kind: 'credential', label: 'API key', re: /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,}|hf_[A-Za-z0-9]{30,})\b/g },
  { id: 'password', kind: 'credential', label: 'Password or secret', re: /\b(?:pass(?:word|wd)?|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*[^\s,;}]{4,}/gi },
  { id: 'url-login', kind: 'credential', label: 'Login inside a URL', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@[^\s/]+/gi },
  { id: 'cloud-link', kind: 'cloud link', label: 'Private cloud link', re: /\bhttps?:\/\/(?:(?:drive|docs)\.google\.com|(?:www\.)?dropbox\.com|dl\.dropboxusercontent\.com|(?:www\.)?overleaf\.com\/(?:project|read|\d)|onedrive\.live\.com|1drv\.ms|[a-z0-9-]+\.sharepoint\.com|(?:app\.)?box\.com\/s\/|(?:www\.)?notion\.so|wetransfer\.com|we\.tl)[^\s}\])>"']*/gi },
  { id: 'email', kind: 'email', label: 'Email address', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
  { id: 'todo', kind: 'leftover', label: 'To-do left in', re: /\\(?:todo|missingfigure|fixme|note|hl)\b|\b(?:TODO|FIXME|XXX)\b/g },
];
const TEXT_FILE = /\.(tex|ltx|sty|cls|bib|bbl|bst|txt|md|cfg|clo|def|dtx|ins|json|ya?ml|py|r|m|jl|sh|csv|tsv|ini|toml|env|xml|html?|js|lua)$|(^|\/)(00README|README|\.env)[^/]*$/i;
export const isText = (p) => TEXT_FILE.test(p);

// show a few leading chars and hide the rest; never put a whole secret in the report
export function mask(kind, s) {
  if (kind === 'email' || kind === 'leftover') return s;
  if (kind === 'cloud link') { const u = s.match(/^https?:\/\/[^/]+\/?/); return u ? u[0] + '…' : s.slice(0, 20) + '…'; }
  const eq = s.match(/^([^:=]*[:=]\s*)(.*)$/);
  if (eq && /pass|pwd|secret|key|token/i.test(eq[1])) return eq[1] + eq[2].slice(0, 2) + '…';
  return s.slice(0, 4) + '…';
}

export function scanText(path, text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const claimed = [];
    for (const r of LEAK_RULES) {
      r.re.lastIndex = 0;
      for (const m of line.matchAll(r.re)) {
        const s = m.index, e = s + m[0].length;
        if (claimed.some(([a, b]) => s < b && e > a)) continue; // one finding per span (an email inside a URL login, etc.)
        if (r.id === 'email' && /\.(png|jpe?g|pdf|tex)$/i.test(m[0])) continue;
        claimed.push([s, e]);
        const at = commentStart(line);
        hits.push({ rule: r.id, kind: r.kind, label: r.label, file: path, line: i + 1, match: m[0], inComment: at >= 0 && s > at });
      }
    }
  });
  return hits;
}

// ---------- whole pipeline ----------
// files: [{ path, bytes }] straight from the zip. opts.shrink: async (file) => { bytes, w, h, from } | null
export async function cleanProject(rawFiles, opts = {}) {
  const shrink = opts.shrink || (async () => null);
  const progress = opts.onProgress || (() => {});
  const removed = [];   // { path, size, why }
  const report = { comments: 0, commentEnvs: 0, iffalse: 0, linesDropped: 0, commentBytes: 0, images: [], pdfs: [], leaks: [], macroRefs: [], edited: [] };
  const junk = [], live = [];
  for (const f of rawFiles) (isJunk(f.path) ? junk : live).push(f);
  const files = normalizePaths(live).map((f) => ({ path: f.path, bytes: f.bytes }));
  const top = live.length && files.length && live[0].path !== files[0].path ? live[0].path.slice(0, live[0].path.length - files[0].path.length) : '';
  for (const f of junk) removed.push({ path: top && f.path.startsWith(top) ? f.path.slice(top.length) : f.path, size: f.bytes.length, why: 'build or system junk' });
  const beforeBytes = rawFiles.reduce((n, f) => n + f.bytes.length, 0);

  // leak scan on the original text (so text inside removed comments is scanned too)
  const original = new Map();
  for (const f of files) if (isText(f.path) && f.bytes.length < 8 * 1024 * 1024) original.set(f.path, dec.decode(f.bytes));
  for (const [p, t] of original) report.leaks.push(...scanText(p, t));

  // strip comments from .tex
  progress('Stripping comments');
  const texts = new Map();
  for (const [p, t] of original) {
    if (/\.(tex|ltx)$/i.test(p)) {
      const r = stripComments(t);
      for (const k of ['comments', 'commentEnvs', 'iffalse', 'linesDropped']) report[k] += r.stats[k];
      texts.set(p, r.text);
      if (r.text !== t) {
        const b = enc.encode(r.text);
        report.commentBytes += new TextEncoder().encode(t).length - b.length;
        report.edited.push({ path: p, before: t.length, after: r.text.length, comments: r.stats.comments, blocks: r.stats.commentEnvs + r.stats.iffalse });
        files.find((f) => f.path === p).bytes = b;
      }
    } else if (TEXLIKE.test(p)) texts.set(p, t.replace(/(^|[^\\])%.*$/gm, '$1'));
  }

  // prune unreferenced files
  const main = findMain(texts);
  report.main = main;
  let keep = new Set(files.map((f) => f.path));
  if (main) {
    const r = referenced(files.map((f) => f.path), texts, main);
    report.macroRefs = r.macroRefs;
    keep = r.keep;
    for (const f of files) if (ALWAYS_KEEP.test(f.path)) keep.add(f.path);
    // a figure path built from a macro can't be resolved: keep every figure rather than guess
    if (r.macroRefs.some((m) => /graphics|pdf|svg/.test(m.cmd))) for (const f of files) if (/\.(pdf|png|jpe?g|eps|svg)$/i.test(f.path)) keep.add(f.path);
  }
  const kept = [];
  for (const f of files) {
    if (keep.has(f.path)) kept.push(f);
    else removed.push({ path: f.path, size: f.bytes.length, why: 'not referenced from ' + (main || 'the main file') });
  }
  report.abstract = abstractReport(kept, main);
  for (const l of report.leaks) {
    const f = kept.find((k) => k.path === l.file);
    l.status = !f ? 'removed with the file' : l.inComment || !dec.decode(f.bytes).includes(l.match) ? 'removed with a comment' : 'still in the file';
  }

  // image and pdf metadata, then downscale
  for (const [i, f] of kept.entries()) {
    const before = f.bytes.length;
    if (/\.jpe?g$/i.test(f.path)) {
      const s = scrubJpeg(f.bytes);
      if (!s) continue;
      const found = s.found;
      f.bytes = s.bytes;
      progress(`Checking image ${f.path}`);
      const r = await shrink({ path: f.path, bytes: f.bytes });
      if (r && r.bytes.length < f.bytes.length) f.bytes = r.bytes;
      const meta = [found.exif && 'EXIF', found.xmp && 'XMP', found.iptc && 'IPTC', found.comment && 'comment'].filter(Boolean);
      report.images.push({ path: f.path, before, after: f.bytes.length, meta, gps: found.gps?.gps ? found.gps : null, resized: r ? `${r.from.w}×${r.from.h} → ${r.w}×${r.h} px` : null });
    } else if (/\.png$/i.test(f.path)) {
      const s = scrubPng(f.bytes);
      if (!s) continue;
      f.bytes = s.bytes;
      progress(`Checking image ${f.path}`);
      const r = await shrink({ path: f.path, bytes: f.bytes });
      if (r && r.bytes.length < f.bytes.length) f.bytes = r.bytes;
      const meta = [...new Set(s.found.chunks)].map((c) => c + (c === 'tEXt' || c === 'iTXt' || c === 'zTXt' ? ` (${s.found.keys.join(', ')})` : ''));
      report.images.push({ path: f.path, before, after: f.bytes.length, meta, gps: s.found.gps?.gps ? s.found.gps : null, resized: r ? `${r.from.w}×${r.from.h} → ${r.w}×${r.h} px` : null });
    } else if (/\.pdf$/i.test(f.path)) {
      const s = scrubPdf(f.bytes);
      if (!s) continue;
      f.bytes = s.bytes;
      const entry = { path: f.path, keys: s.found.keys, xmp: s.found.xmp, compressedOnly: s.found.compressedOnly };
      if (s.found.deep && opts.deepPdf) {
        progress(`Rewriting ${f.path} to remove its metadata`);
        const d = await opts.deepPdf(f.bytes);
        if (d && d.bytes) {
          Object.assign(entry, { keys: [...new Set([...entry.keys, ...d.found.keys])], xmp: entry.xmp || d.found.xmp, compressedOnly: false, deep: true, before, after: d.bytes.length });
          f.bytes = d.bytes;
        } else if (d && d.error) entry.deepError = d.error;
      }
      if (entry.keys.length || entry.xmp || entry.compressedOnly) report.pdfs.push(entry);
    }
  }
  const afterBytes = kept.reduce((n, f) => n + f.bytes.length, 0);
  return { files: kept, removed, report, beforeBytes, afterBytes, main };
}

export function reportText(name, res, zipBefore) {
  const { report: r, removed } = res;
  const L = [];
  L.push(`papershed clean report for ${name}`);
  L.push('Made in the browser by papershed. Nothing was uploaded.');
  L.push('This file lists file names and counts only, never secret values. Delete it before you upload if you do not want it in the source bundle.');
  L.push('');
  L.push(`project bytes (uncompressed): ${res.beforeBytes} -> ${res.afterBytes}${zipBefore ? `; input zip ${zipBefore} bytes` : ''}`);
  L.push(`main file: ${res.main || 'not found (nothing was pruned)'}`);
  L.push(`comments removed: ${r.comments} % comments, ${r.commentEnvs} comment environments, ${r.iffalse} \\iffalse blocks (${r.linesDropped} lines dropped)`);
  if (r.abstract) L.push(r.abstract.found ? `abstract (arXiv form): ${r.abstract.chars} of ${r.abstract.max} characters in ${r.abstract.path}; ${r.abstract.problems} would be refused, ${r.abstract.advice} requests from arXiv's page` : 'abstract (arXiv form): none found in the kept files');
  L.push('');
  L.push(`files removed (${removed.length}):`);
  for (const f of removed) L.push(`- ${f.path} (${f.size} bytes): ${f.why}`);
  L.push('');
  L.push('images:');
  for (const i of r.images) L.push(`- ${i.path}: ${i.before} -> ${i.after} bytes${i.meta.length ? `; stripped ${i.meta.join(', ')}` : ''}${i.gps ? '; HAD GPS LOCATION (removed)' : ''}${i.resized ? `; resized ${i.resized}` : ''}`);
  for (const p of r.pdfs) L.push(`- ${p.path}: ${p.compressedOnly ? `metadata is compressed, not scrubbed${p.deepError ? ` (${p.deepError})` : ''}; re-export this figure` : `${p.deep ? 'removed (file rewritten)' : 'blanked'} ${[...p.keys, p.xmp ? 'XMP' : ''].filter(Boolean).join(', ')}`}`);
  L.push('');
  L.push('possible leaks (heuristic scan; it can miss things and flag harmless text):');
  for (const l of r.leaks) L.push(`- [${l.kind}] ${l.label} at ${l.file}:${l.line}, ${l.status}`);
  if (r.macroRefs.length) { L.push(''); L.push('references built from macros (files they point to were kept):'); for (const m of r.macroRefs) L.push(`- ${m.file}: \\${m.cmd}{${m.name}}`); }
  return L.join('\n') + '\n';
}
