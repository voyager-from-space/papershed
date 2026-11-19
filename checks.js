// Pre-upload checks against arXiv's published rules: the abstract field and submission size.
// Pure functions over text and { path, bytes } files; they run in the browser and in Node.
// Every limit below has a source URL next to it. Where arXiv does not say something, the code says so
// instead of picking a number.

export const SRC = {
  abstract: 'https://info.arxiv.org/help/prep.html',
  sizes: 'https://info.arxiv.org/help/sizes.html',
  size50: 'https://arxiv-org.atlassian.net/wiki/spaces/AUS/pages/13041666/What+to+do+if+my+submission+is+Oversized',
};
export const ABSTRACT_MAX = 1920;     // prep.html: "abstracts longer than 1920 characters will not be accepted"
export const SIZE_LIMIT = 50_000_000; // support page: "The current submission size limit is 50MB" (not stated whether 10^6 or 2^20; the stricter one is used)
export const FILE_SUGGESTION = 2_000_000; // support page: "We generally suggest each file be reduced in size to 2MB or less"
export const MEGAPIXEL_WARN = 34;     // sizes.html: warning "if images larger than 34 Megapixel are found" (from Feb 2026)

// ---------- abstract ----------

// text between \begin{abstract} and \end{abstract}, or the braces after \abstract. Input is already comment-free.
export function findAbstracts(files) {
  const found = [];
  for (const f of files) {
    if (!/\.(tex|ltx)$/i.test(f.path)) continue;
    const t = typeof f.text === 'string' ? f.text : new TextDecoder().decode(f.bytes);
    for (const m of t.matchAll(/\\begin\s*\{abstract\*?\}([\s\S]*?)\\end\s*\{abstract\*?\}/gi)) found.push({ path: f.path, text: m[1], at: m.index });
    for (const m of t.matchAll(/\\abstract\s*(?:\[[^\]]*\])?\s*\{/g)) {
      let depth = 1, i = m.index + m[0].length;
      for (; i < t.length && depth; i++) { const c = t[i]; if (c === '\\') { i++; continue; } if (c === '{') depth++; else if (c === '}') depth--; }
      if (!depth) found.push({ path: f.path, text: t.slice(m.index + m[0].length, i - 1), at: m.index });
    }
  }
  return found;
}

// what arXiv's page says about line breaks: "Carriage returns will be stripped unless they are followed by leading white spaces."
// arXiv does not publish exactly how it counts, so this is the closest reading: a line break not followed by a space becomes one space.
export function pastedForm(text) {
  return text.replace(/\r\n?/g, '\n').trim().replace(/[ \t]+$/gm, '').replace(/\n(?![ \t])/g, ' ');
}

// accent and letter forms from arXiv's own table (prep.html, "Note on LaTeX accent commands")
const ACCENT = { '\u0300': (b) => '\\`' + b, '\u0301': (b) => "\\'" + b, '\u0302': (b) => '\\^' + b, '\u0303': (b) => '\\~' + b, '\u0304': (b) => '\\=' + b, '\u0307': (b) => '\\.' + b,
  '\u0308': (b) => '\\"' + b, '\u030a': (b) => `\\r{${b}}`, '\u030b': (b) => `\\H{${b}}`, '\u030c': (b) => `\\v{${b}}`, '\u0306': (b) => `\\u{${b}}`, '\u0327': (b) => `\\c{${b}}`, '\u0328': (b) => `\\k{${b}}` };
const LETTER = { 'å': '{\\aa}', 'Å': '{\\AA}', 'æ': '{\\ae}', 'Æ': '{\\AE}', 'ð': '{\\dh}', 'Ð': '{\\DH}', 'đ': '{\\dj}', 'Đ': '{\\DJ}', 'ı': '{\\i}', 'ł': '{\\l}', 'Ł': '{\\L}', 'ŋ': '{\\ng}', 'Ŋ': '{\\NG}',
  'ø': '{\\o}', 'Ø': '{\\O}', 'œ': '{\\oe}', 'Œ': '{\\OE}', 'ß': '{\\ss}', 'þ': '{\\th}', 'Þ': '{\\TH}' };
// the "common culprits" arXiv names: curved quotes, long hyphens, fi/ff as one character
const PUNCT = { '\u201c': '``', '\u201d': "''", '\u2018': '`', '\u2019': "'", '\u2013': '--', '\u2014': '---', '\u2212': '$-$', '\u00a0': '~', '\u2026': '...',
  '\ufb00': 'ff', '\ufb01': 'fi', '\ufb02': 'fl', '\ufb03': 'ffi', '\ufb04': 'ffl', '\u00d7': '$\\times$', '\u00b1': '$\\pm$' };
export function asciiFor(ch) {
  if (PUNCT[ch]) return PUNCT[ch];
  if (LETTER[ch]) return LETTER[ch];
  const d = ch.normalize('NFD');
  if (d.length === 2 && ACCENT[d[1]] && /^[A-Za-z]$/.test(d[0])) return ACCENT[d[1]](d[0]);
  return null;
}

const FONT_CMDS = /\\(?:em|it|bf|sc|sl|tt|rm|sf|itshape|bfseries|scshape|slshape|ttfamily|rmfamily|sffamily|mdseries|upshape|normalfont|textit|textbf|textsc|textsl|texttt|textrm|textsf|textup|textmd|emph)(?![A-Za-z@])/g;
const REF_CMDS = /\\(?:cite[a-zA-Z]*|ref|eqref|autoref|cref|Cref|pageref|label|footnote|thanks)(?![A-Za-z@])/g;

export function definedMacros(files) {
  const names = new Set();
  for (const f of files) {
    if (!/\.(tex|ltx|sty|cls)$/i.test(f.path)) continue;
    const t = typeof f.text === 'string' ? f.text : new TextDecoder().decode(f.bytes);
    for (const m of t.matchAll(/\\(?:(?:re|provide)?newcommand\*?|DeclareMathOperator\*?|gdef|edef|xdef|def)\s*\{?\\([A-Za-z@]+)/g)) names.add(m[1]);
  }
  return names;
}

const sample = (arr, n = 4) => [...new Set(arr)].slice(0, n);
const showCh = (ch) => `${ch} (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`;

// issues: { id, level: 'problem' | 'advice' | 'note', from: 'arXiv' | 'papershed', title, detail, examples? }
// 'problem' means arXiv's own page says the field is refused or reports an error; 'advice' means the page asks you to change it;
// 'note' is papershed's own observation, not an arXiv rule.
export function analyzeAbstract(raw, { macros = new Set() } = {}) {
  const form = pastedForm(raw);
  const chars = [...form].length;
  const issues = [];
  if (chars > ABSTRACT_MAX) issues.push({ id: 'length', level: 'problem', from: 'arXiv', title: `${chars - ABSTRACT_MAX} characters over the limit`, detail: `arXiv: "abstracts longer than ${ABSTRACT_MAX} characters will not be accepted; abridge your abstract if necessary." The full abstract in your paper can stay as it is; the limit applies to the Abstract box in the submission form.` });
  const bad = [...new Set([...form].filter((c) => c.codePointAt(0) > 126 || (c.codePointAt(0) < 32 && c !== '\n' && c !== '\t')))];
  if (bad.length) issues.push({ id: 'ascii', level: 'problem', from: 'arXiv', title: `${bad.length} non-ASCII ${bad.length === 1 ? 'character' : 'characters'}`, detail: 'arXiv: "Our metadata fields only accept ASCII input" and unicode characters should be converted to TeX. The form stops with "Bad character(s) in field". Typical causes are curved quotes, long dashes and fi/ff ligatures pasted from a PDF.',
    examples: bad.slice(0, 12).map((c) => ({ ch: showCh(c), fix: asciiFor(c) })) });
  if (/^\s*(?:\\(?:textbf|textit|emph|textsc)\s*\{\s*|\{\\(?:bf|bfseries|it|itshape|sc|scshape)\s+)?abstract\b/i.test(raw)) issues.push({ id: 'word', level: 'advice', from: 'arXiv', title: 'Starts with the word "Abstract"', detail: 'arXiv: "Do not include the word "Abstract"."' });
  const tilde = (form.match(/(^|[^\\])~/g) || []).length, comma = (form.match(/\\,/g) || []).length, space = (form.match(/\\ /g) || []).length;
  if (tilde + comma + space) issues.push({ id: 'texisms', level: 'advice', from: 'arXiv', title: `${tilde + comma + space} TeX spacing ${tilde + comma + space === 1 ? 'command' : 'commands'}`, detail: `arXiv: "Including TeX formatting commands such as ~ \\, (backslash comma) and \\ (backslash space) makes it difficult for people to read. Please omit these TeX-isms." Found ${[tilde && `${tilde} ~`, comma && `${comma} \\,`, space && `${space} "\\ "`].filter(Boolean).join(', ')}.` });
  const fonts = form.match(FONT_CMDS) || [];
  if (fonts.length) issues.push({ id: 'fonts', level: 'advice', from: 'arXiv', title: `${fonts.length} font ${fonts.length === 1 ? 'command' : 'commands'}`, detail: 'arXiv: "omit font commands such as \\em or \\it, as these will not be processed into the display."', examples: sample(fonts).map((f) => ({ ch: f })) });
  const lines = raw.replace(/\r\n?/g, '\n').trim().split('\n').slice(1);
  const indented = lines.filter((l) => /^[ \t]+\S/.test(l)).length;
  if (indented) issues.push({ id: 'indent', level: 'advice', from: 'arXiv', title: `${indented} ${indented === 1 ? 'line starts' : 'lines start'} with a space`, detail: 'arXiv: "Do not start lines with whitespace (spaces, tabs, etc.) unless you are trying to prevent our automatic line wrapping." Indented source lines pasted as they are keep their line breaks and look ragged in the announcement.' });
  const blanks = (raw.replace(/\r\n?/g, '\n').trim().match(/\n[ \t]*\n/g) || []).length;
  if (blanks) issues.push({ id: 'blank', level: 'advice', from: 'arXiv', title: `${blanks} blank ${blanks === 1 ? 'line' : 'lines'}`, detail: 'arXiv: "Avoid unnecessary blank lines."' });
  const refs = raw.match(REF_CMDS) || [];
  const used = [...new Set([...raw.matchAll(/\\([A-Za-z@]+)/g)].map((m) => m[1]).filter((n) => macros.has(n)))];
  if (refs.length || used.length) issues.push({ id: 'macros', level: 'note', from: 'papershed', title: 'Commands the Abstract box cannot resolve', detail: 'arXiv asks you to "expand out opaque TeX macros". Citations, cross-references, footnotes and your own macros mean nothing in the form field.', examples: sample([...refs, ...used.map((n) => '\\' + n)], 6).map((f) => ({ ch: f })) });
  return { chars, max: ABSTRACT_MAX, form, issues, problems: issues.filter((i) => i.level === 'problem').length, advice: issues.filter((i) => i.level === 'advice').length };
}

// files: kept project files [{ path, bytes }] (comments already stripped); main: path of the \documentclass file
export function abstractReport(files, main) {
  const texts = files.filter((f) => /\.(tex|ltx)$/i.test(f.path)).map((f) => ({ path: f.path, text: new TextDecoder().decode(f.bytes) }));
  const found = findAbstracts(texts).sort((a, b) => (a.path === main ? -1 : 0) - (b.path === main ? -1 : 0));
  if (!found.length) return { found: false, count: 0 };
  const macros = definedMacros(files);
  return { found: true, count: found.length, path: found[0].path, raw: found[0].text.trim(), ...analyzeAbstract(found[0].text, { macros }) };
}

// ---------- size ----------

export function imageDims(path, b) {
  if (/\.png$/i.test(path) && b.length > 24 && b[1] === 0x50 && b[2] === 0x4e) return { w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 };
  if (/\.jpe?g$/i.test(path) && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + len;
    }
  }
  return null;
}

const FIGURE = /\.(pdf|png|jpe?g|eps|gif|tiff?|bmp|svg)$/i;
const mb = (n) => (n / 1_000_000).toFixed(1) + ' MB';
export { mb as fmtMB };

// before/after: { files, zipBytes }. Returns plain numbers and verdicts; the page words them.
export function sizeReport(before, after) {
  const sum = (fs) => fs.reduce((n, f) => n + f.bytes.length, 0);
  const side = (s) => {
    const unpacked = sum(s.files);
    const verdict = (n) => (n > SIZE_LIMIT ? 'over' : 'under');
    const bigFiles = s.files.filter((f) => FIGURE.test(f.path) && f.bytes.length > FILE_SUGGESTION).map((f) => ({ path: f.path, bytes: f.bytes.length })).sort((a, b) => b.bytes - a.bytes);
    const bigImages = [];
    for (const f of s.files) { const d = imageDims(f.path, f.bytes); if (d && (d.w * d.h) / 1e6 > MEGAPIXEL_WARN) bigImages.push({ path: f.path, mp: (d.w * d.h) / 1e6 }); }
    return { zip: s.zipBytes, unpacked, zipVerdict: verdict(s.zipBytes), unpackedVerdict: verdict(unpacked), bigFiles, bigImages };
  };
  const b = side(before), a = side(after);
  const over = a.zipVerdict === 'over' || a.unpackedVerdict === 'over';
  return { limit: SIZE_LIMIT, before: b, after: a, status: over ? 'over' : a.bigFiles.length || a.bigImages.length ? 'watch' : 'ok' };
}
